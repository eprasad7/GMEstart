"""
Conformal prediction for calibrated uncertainty quantification.

Wraps trained LightGBM quantile models to produce prediction intervals
with distribution-free coverage guarantees (Section 3.4 of spec).

The key insight: raw quantile regression intervals may not be calibrated.
A model's "90% interval" might only cover 78% of actuals. Conformal
prediction fixes this by computing nonconformity scores on a held-out
calibration set and adjusting interval widths to guarantee coverage.
"""

import logging
from dataclasses import dataclass

import lightgbm as lgb
import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class ConformalResult:
    """Conformalized prediction with coverage guarantee."""

    point: np.ndarray         # Point prediction (median)
    lower: np.ndarray         # Lower bound with guaranteed coverage
    upper: np.ndarray         # Upper bound with guaranteed coverage
    alpha: float              # Miscoverage rate (0.10 = 90% coverage)
    empirical_coverage: float # Measured coverage on calibration set
    correction: float         # Width correction applied


class ConformalPricer:
    """
    Conformal prediction wrapper for quantile regression models.

    Usage:
        pricer = ConformalPricer(alpha=0.10)
        pricer.calibrate(models, X_cal, y_cal)
        lower, point, upper = pricer.predict(models, X_test)
        # lower/upper now have guaranteed 90% coverage
    """

    def __init__(self, alpha: float = 0.10):
        """
        Args:
            alpha: Miscoverage rate. 0.10 gives 90% prediction intervals.
        """
        self.alpha = alpha
        self.calibration_scores: np.ndarray | None = None
        self.correction: float = 0.0

    def calibrate(
        self,
        models: dict[float, lgb.Booster],
        X_cal: np.ndarray,
        y_cal: np.ndarray,
    ) -> float:
        """
        Calibrate on a held-out calibration set.

        Computes nonconformity scores and determines the width correction
        needed to achieve the target coverage level.

        Args:
            models: Dict mapping quantile -> trained LightGBM booster
            X_cal: Calibration features (NOT used in training)
            y_cal: Calibration targets (log-scale)

        Returns:
            The empirical coverage before correction.
        """
        # Get raw quantile predictions on calibration set
        lower_q = self.alpha / 2         # e.g., 0.05 for 90% CI
        upper_q = 1 - self.alpha / 2     # e.g., 0.95 for 90% CI

        # Find the closest trained quantiles
        available_q = sorted(models.keys())
        lower_model_q = min(available_q, key=lambda q: abs(q - lower_q))
        upper_model_q = min(available_q, key=lambda q: abs(q - upper_q))

        pred_lower = models[lower_model_q].predict(X_cal)
        pred_upper = models[upper_model_q].predict(X_cal)
        pred_median = models[0.50].predict(X_cal)

        # Compute nonconformity scores: how much do we need to widen?
        # Score = max(lower - y, y - upper) — positive means y is outside interval
        scores = np.maximum(pred_lower - y_cal, y_cal - pred_upper)
        self.calibration_scores = np.sort(scores)

        # Empirical coverage before correction
        raw_coverage = np.mean((y_cal >= pred_lower) & (y_cal <= pred_upper))

        # Compute the conformal correction (quantile of scores)
        n = len(self.calibration_scores)
        q_idx = min(
            int(np.ceil((1 - self.alpha) * (n + 1))) - 1,
            n - 1,
        )
        self.correction = float(self.calibration_scores[q_idx])

        logger.info(
            f"Conformal calibration: raw coverage={raw_coverage:.3f}, "
            f"target={1 - self.alpha:.2f}, correction={self.correction:.4f}"
        )

        return float(raw_coverage)

    def predict(
        self,
        models: dict[float, lgb.Booster],
        X_test: np.ndarray,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Produce conformalized prediction intervals.

        Returns:
            (lower, point, upper) — all in log-scale.
            Apply np.expm1() to convert back to price-scale.
        """
        if self.calibration_scores is None:
            raise RuntimeError("Must call calibrate() before predict()")

        available_q = sorted(models.keys())
        lower_q = min(available_q, key=lambda q: abs(q - self.alpha / 2))
        upper_q = min(available_q, key=lambda q: abs(q - (1 - self.alpha / 2)))

        pred_lower = models[lower_q].predict(X_test) - self.correction
        pred_upper = models[upper_q].predict(X_test) + self.correction
        pred_median = models[0.50].predict(X_test)

        return pred_lower, pred_median, pred_upper

    def evaluate_coverage(
        self,
        models: dict[float, lgb.Booster],
        X_test: np.ndarray,
        y_test: np.ndarray,
    ) -> dict[str, float]:
        """Evaluate conformalized coverage and interval width on test data."""
        lower, point, upper = self.predict(models, X_test)

        coverage = float(np.mean((y_test >= lower) & (y_test <= upper)))
        avg_width = float(np.mean(upper - lower))
        median_width_pct = float(
            np.median((np.expm1(upper) - np.expm1(lower)) / np.maximum(np.expm1(point), 1e-8)) * 100
        )

        return {
            "conformal_coverage": coverage,
            "conformal_avg_width_log": avg_width,
            "conformal_median_width_pct": median_width_pct,
            "correction_applied": self.correction,
        }


def train_with_conformal(
    models: dict[float, lgb.Booster],
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_val: np.ndarray,
    y_val: np.ndarray,
    alpha: float = 0.10,
    cal_fraction: float = 0.3,
) -> tuple[ConformalPricer, dict[str, float]]:
    """
    Convenience function: split validation set into cal/test,
    calibrate conformal pricer, and evaluate.

    Args:
        models: Trained quantile models
        X_train: Training features (not used, for signature completeness)
        y_train: Training targets (not used)
        X_val: Validation features
        y_val: Validation targets (log-scale)
        alpha: Miscoverage rate
        cal_fraction: Fraction of validation set used for calibration

    Returns:
        (pricer, metrics) — calibrated pricer and evaluation metrics
    """
    n = len(X_val)
    cal_size = int(n * cal_fraction)

    X_cal, X_test = X_val[:cal_size], X_val[cal_size:]
    y_cal, y_test = y_val[:cal_size], y_val[cal_size:]

    pricer = ConformalPricer(alpha=alpha)
    raw_coverage = pricer.calibrate(models, X_cal, y_cal)

    metrics = pricer.evaluate_coverage(models, X_test, y_test)
    metrics["raw_coverage_before_conformal"] = raw_coverage

    logger.info(
        f"Conformal evaluation: coverage={metrics['conformal_coverage']:.3f} "
        f"(target={1 - alpha:.2f}), "
        f"median interval width={metrics['conformal_median_width_pct']:.1f}%"
    )

    return pricer, metrics
