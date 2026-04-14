"""
LightGBM quantile regression training pipeline.

Trains separate models for each quantile (p10, p20, p25, p50, p75, p80, p90)
using walk-forward validation. Exports best models to ONNX for Workers inference.
"""

import json
import logging
from pathlib import Path

import click
import lightgbm as lgb
import mlflow
import numpy as np
import pandas as pd
from sklearn.model_selection import TimeSeriesSplit

from .config import TrainingConfig

logger = logging.getLogger(__name__)

# Set by evaluate_models, read by save_models
_last_conformal_correction: float = 0.0


def load_training_data(data_path: str) -> pd.DataFrame:
    """
    Load training data from CSV or database export.

    Expected columns:
    - card_id, grade, grading_company
    - sale_date, price_usd (target)
    - All feature columns from config
    """
    df = pd.read_csv(data_path, parse_dates=["sale_date"])
    df = df.sort_values("sale_date").reset_index(drop=True)

    # Log-transform target (prices are log-normal)
    df["log_price"] = np.log1p(df["price_usd"])

    # Classify volume buckets
    quarterly_sales = df.groupby(["card_id", "grading_company", "grade"]).size()
    df["volume_bucket"] = df.apply(
        lambda row: classify_volume(
            quarterly_sales.get((row["card_id"], row["grading_company"], row["grade"]), 0)
        ),
        axis=1,
    )

    logger.info(
        f"Loaded {len(df)} observations, "
        f"{df['card_id'].nunique()} unique cards, "
        f"date range: {df['sale_date'].min()} to {df['sale_date'].max()}"
    )
    return df


def classify_volume(count: int) -> str:
    if count >= 50:
        return "high"
    elif count >= 10:
        return "medium"
    return "low"


def train_quantile_models(
    df: pd.DataFrame, config: TrainingConfig
) -> dict[float, lgb.Booster]:
    """Train LightGBM models for each quantile using walk-forward validation."""

    feature_cols = [c for c in config.feature_columns if c in df.columns]
    target_col = "log_price"

    # Walk-forward split
    df["month"] = df["sale_date"].dt.to_period("M")
    months = sorted(df["month"].unique())

    if len(months) < config.train_months + config.test_months:
        logger.warning(
            f"Only {len(months)} months of data, need {config.train_months + config.test_months}. "
            f"Using all data for training."
        )
        train_df = df
        val_df = df.tail(len(df) // 5)
    else:
        # Use most recent split for final model
        train_end = months[-(config.test_months + 1)]
        test_start = months[-config.test_months]
        train_df = df[df["month"] <= train_end]
        val_df = df[df["month"] >= test_start]

    logger.info(f"Train: {len(train_df)} samples, Validation: {len(val_df)} samples")

    X_train = train_df[feature_cols].values
    y_train = train_df[target_col].values
    X_val = val_df[feature_cols].values
    y_val = val_df[target_col].values

    train_set = lgb.Dataset(X_train, label=y_train, feature_name=feature_cols)
    val_set = lgb.Dataset(X_val, label=y_val, feature_name=feature_cols, reference=train_set)

    models: dict[float, lgb.Booster] = {}

    for q in config.quantiles:
        logger.info(f"Training quantile {q}...")

        params = {
            "objective": "quantile",
            "alpha": q,
            "metric": "quantile",
            "learning_rate": config.learning_rate,
            "num_leaves": config.num_leaves,
            "min_data_in_leaf": config.min_data_in_leaf,
            "feature_fraction": config.feature_fraction,
            "bagging_fraction": config.bagging_fraction,
            "bagging_freq": config.bagging_freq,
            "lambda_l1": config.lambda_l1,
            "lambda_l2": config.lambda_l2,
            "verbose": -1,
        }

        model = lgb.train(
            params,
            train_set,
            num_boost_round=config.num_boost_round,
            valid_sets=[val_set],
            callbacks=[
                lgb.early_stopping(config.early_stopping_rounds),
                lgb.log_evaluation(100),
            ],
        )

        models[q] = model

        # Log to MLflow
        mlflow.log_metric(f"best_iteration_q{q}", model.best_iteration)

    return models


def evaluate_models(
    models: dict[float, lgb.Booster],
    df: pd.DataFrame,
    config: TrainingConfig,
) -> dict[str, float]:
    """Evaluate models on test set, stratified by volume bucket."""
    feature_cols = [c for c in config.feature_columns if c in df.columns]

    # Use last month as test
    months = sorted(df["sale_date"].dt.to_period("M").unique())
    test_df = df[df["sale_date"].dt.to_period("M") == months[-1]]

    X_test = test_df[feature_cols].values
    y_test = test_df["log_price"].values
    y_actual = np.expm1(y_test)

    # Median predictions
    y_pred_log = models[0.50].predict(X_test)
    y_pred = np.expm1(y_pred_log)

    # Overall metrics
    abs_pct_errors = np.abs(y_actual - y_pred) / np.maximum(y_actual, 1e-8)
    mdape = float(np.median(abs_pct_errors) * 100)
    mae = float(np.mean(np.abs(y_actual - y_pred)))

    # Coverage of raw 90% prediction interval (before conformal calibration)
    lower = np.expm1(models[0.10].predict(X_test))
    upper = np.expm1(models[0.90].predict(X_test))
    coverage = float(np.mean((y_actual >= lower) & (y_actual <= upper)) * 100)

    # Interval width
    interval_width = float(np.mean((upper - lower) / np.maximum(y_pred, 1e-8)) * 100)

    # Conformal calibration — guarantees coverage
    from .conformal import train_with_conformal

    conformal_pricer, conformal_metrics = train_with_conformal(
        models, None, None, X_test, y_test, alpha=0.10, cal_fraction=0.3
    )
    for k, v in conformal_metrics.items():
        mlflow.log_metric(k, v)

    # Persist conformal correction so batch_score.py can load it automatically
    global _last_conformal_correction
    _last_conformal_correction = conformal_pricer.correction

    # Directional accuracy (did we predict the right trend?)
    if len(y_actual) > 1:
        actual_direction = np.sign(np.diff(y_actual))
        pred_direction = np.sign(np.diff(y_pred))
        dir_accuracy = float(np.mean(actual_direction == pred_direction) * 100)
    else:
        dir_accuracy = 0.0

    metrics = {
        "mdape_overall": mdape,
        "mae_overall": mae,
        "coverage_90": coverage,
        "interval_width_pct": interval_width,
        "directional_accuracy": dir_accuracy,
        "test_samples": len(test_df),
    }

    # Stratified by volume bucket
    for bucket in ["high", "medium", "low"]:
        bucket_mask = test_df["volume_bucket"] == bucket
        if bucket_mask.sum() > 0:
            bucket_errors = abs_pct_errors[bucket_mask.values]
            metrics[f"mdape_{bucket}"] = float(np.median(bucket_errors) * 100)
            metrics[f"count_{bucket}"] = int(bucket_mask.sum())

    for k, v in metrics.items():
        mlflow.log_metric(k, v)

    logger.info(f"Evaluation metrics: {json.dumps(metrics, indent=2)}")
    return metrics


def save_models(
    models: dict[float, lgb.Booster],
    output_dir: str,
    config: TrainingConfig,
) -> list[Path]:
    """Save LightGBM models as native format."""
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    saved = []
    for q, model in models.items():
        path = output_path / f"lightgbm_q{q:.2f}.txt"
        model.save_model(str(path))
        saved.append(path)
        logger.info(f"Saved model q={q} to {path}")

    # Save feature names, config, and conformal correction
    meta = {
        "version": "1.0.0",
        "quantiles": config.quantiles,
        "feature_columns": config.feature_columns,
        "model_files": {str(q): f"lightgbm_q{q:.2f}.txt" for q in config.quantiles},
        "conformal_correction": _last_conformal_correction,
    }
    meta_path = output_path / "model_meta.json"
    meta_path.write_text(json.dumps(meta, indent=2))
    saved.append(meta_path)

    return saved


@click.command()
@click.option("--data", required=True, help="Path to training data CSV")
@click.option("--output", default="models/", help="Output directory for models")
@click.option("--lr", default=0.03, help="Learning rate")
@click.option("--num-leaves", default=63, help="Number of leaves")
def cli(data: str, output: str, lr: float, num_leaves: int):
    """Train LightGBM quantile regression models."""
    logging.basicConfig(level=logging.INFO)

    config = TrainingConfig(learning_rate=lr, num_leaves=num_leaves)

    mlflow.set_tracking_uri(config.mlflow_tracking_uri)
    mlflow.set_experiment(config.experiment_name)

    with mlflow.start_run():
        mlflow.log_params(
            {
                "learning_rate": config.learning_rate,
                "num_leaves": config.num_leaves,
                "min_data_in_leaf": config.min_data_in_leaf,
                "num_features": len(config.feature_columns),
            }
        )

        df = load_training_data(data)
        models = train_quantile_models(df, config)
        metrics = evaluate_models(models, df, config)
        saved_paths = save_models(models, output, config)

        logger.info(f"Training complete. Models saved to {output}")
        logger.info(f"MdAPE: {metrics['mdape_overall']:.1f}%")
        logger.info(f"Coverage (90%): {metrics['coverage_90']:.1f}%")


if __name__ == "__main__":
    cli()
