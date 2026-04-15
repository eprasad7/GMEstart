"""
Batch scoring pipeline — the critical link between training and serving.

Loads trained LightGBM models, scores all cards from a feature export,
applies conformal calibration, computes NRV-based buy/sell thresholds,
and writes batch_predictions.json to R2 for the Worker to consume.

Usage:
    gamecards-score --model-dir models/ --features features.csv --upload
"""

import json
import logging
from pathlib import Path

import boto3
import click
import lightgbm as lgb
import numpy as np
import pandas as pd

from .config import TrainingConfig
from .conformal import ConformalPricer

logger = logging.getLogger(__name__)

# Retail economics (must match apps/api/src/services/inference.ts)
MARKETPLACE_FEE = 0.13
SHIPPING_COST = 5.00
RETURN_RATE = 0.03
REQUIRED_MARGIN = 0.20


def compute_nrv(fair_value: float) -> float:
    gross = fair_value * (1 - MARKETPLACE_FEE)
    net = gross * (1 - RETURN_RATE)
    return net - SHIPPING_COST


def load_models(model_dir: str, config: TrainingConfig) -> dict[float, lgb.Booster]:
    """Load all quantile models from disk."""
    model_path = Path(model_dir)
    meta_path = model_path / "model_meta.json"
    meta = json.loads(meta_path.read_text())

    models: dict[float, lgb.Booster] = {}
    for q_str, filename in meta["model_files"].items():
        q = float(q_str)
        model_file = model_path / filename
        if model_file.exists():
            models[q] = lgb.Booster(model_file=str(model_file))
            logger.info(f"Loaded model q={q} from {model_file}")
        else:
            logger.warning(f"Model file {model_file} not found, skipping q={q}")

    return models


def load_conformal_correction(model_dir: str) -> float:
    """Load conformal correction from model_meta.json (saved by train.py)."""
    meta_path = Path(model_dir) / "model_meta.json"
    if not meta_path.exists():
        return 0.0
    meta = json.loads(meta_path.read_text())
    correction = meta.get("conformal_correction", 0.0)
    if correction > 0:
        logger.info(f"Loaded conformal correction: {correction:.4f}")
    return float(correction)


def score_all_cards(
    models: dict[float, lgb.Booster],
    features_df: pd.DataFrame,
    config: TrainingConfig,
    conformal_correction: float = 0.0,
) -> list[dict]:
    """
    Score all cards and produce predictions with NRV-based thresholds.

    Args:
        models: Trained quantile models keyed by quantile value
        features_df: DataFrame with card_id, grade, grading_company, + feature columns
        config: Training config for feature column names
        conformal_correction: Width adjustment from conformal calibration (log-scale)

    Returns:
        List of prediction dicts ready for JSON serialization
    """
    feature_cols = [c for c in config.feature_columns if c in features_df.columns]
    X = features_df[feature_cols].fillna(0).values

    # Score all quantiles
    preds: dict[float, np.ndarray] = {}
    for q, model in models.items():
        preds[q] = model.predict(X)

    # Apply conformal correction to interval bounds
    if conformal_correction > 0 and 0.10 in preds and 0.90 in preds:
        preds[0.10] = preds[0.10] - conformal_correction
        preds[0.90] = preds[0.90] + conformal_correction

    predictions = []

    for i in range(len(features_df)):
        row = features_df.iloc[i]
        card_id = row["card_id"]
        grade = row["grade"]
        grading_company = row["grading_company"]

        # Back-transform from log-space
        p50 = float(np.expm1(preds[0.50][i])) if 0.50 in preds else 0
        p10 = float(np.expm1(preds[0.10][i])) if 0.10 in preds else p50 * 0.7
        p25 = float(np.expm1(preds[0.25][i])) if 0.25 in preds else p50 * 0.85
        p75 = float(np.expm1(preds[0.75][i])) if 0.75 in preds else p50 * 1.15
        p90 = float(np.expm1(preds[0.90][i])) if 0.90 in preds else p50 * 1.3

        # NRV-based buy threshold
        nrv = compute_nrv(p50)
        max_buy_price = max(0, nrv * (1 - REQUIRED_MARGIN))

        # Sell threshold at p80
        p80_val = float(np.expm1(preds[0.80][i])) if 0.80 in preds else p50 * 1.2

        # Volume bucket classification
        sales_90d = row.get("sales_count_90d", 0)
        volume_bucket = (
            "high" if sales_90d >= 50
            else "medium" if sales_90d >= 10
            else "low"
        )

        # Confidence based on volume + interval width
        interval_width = (p90 - p10) / max(p50, 0.01)
        if volume_bucket == "high" and interval_width < 0.30:
            confidence = "HIGH"
        elif volume_bucket == "low" or interval_width > 0.60:
            confidence = "LOW"
        else:
            confidence = "MEDIUM"

        predictions.append({
            "card_id": card_id,
            "grade": str(grade),
            "grading_company": str(grading_company),
            "model_version": "lgbm-v1",
            "fair_value": round(max(0, p50), 2),
            "p10": round(max(0, p10), 2),
            "p25": round(max(0, p25), 2),
            "p50": round(max(0, p50), 2),
            "p75": round(p75, 2),
            "p90": round(p90, 2),
            "buy_threshold": round(max_buy_price, 2),
            "sell_threshold": round(p80_val, 2),
            "confidence": confidence,
            "volume_bucket": volume_bucket,
        })

    logger.info(f"Scored {len(predictions)} cards")
    return predictions


def write_predictions(predictions: list[dict], output_path: str) -> Path:
    """Write predictions to JSON file."""
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(predictions, indent=None))
    logger.info(f"Wrote {len(predictions)} predictions to {path} ({path.stat().st_size / 1024:.1f} KB)")
    return path


def upload_predictions_to_r2(file_path: Path, config: TrainingConfig, model_dir: str):
    """
    Upload batch_predictions.json to R2 with versioning.

    Writes:
    - models/batch_predictions.json (latest — Worker reads this)
    - models/versions/{timestamp}_predictions.json (versioned backup)
    - models/predictions_meta.json (freshness + version metadata)
    """
    from datetime import datetime, timezone

    s3 = boto3.client(
        "s3",
        endpoint_url=config.r2_endpoint,
        aws_access_key_id=config.r2_access_key,
        aws_secret_access_key=config.r2_secret_key,
        region_name="auto",
    )

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    # Upload versioned copy
    versioned_key = f"models/versions/{timestamp}_predictions.json"
    s3.upload_file(str(file_path), config.r2_bucket, versioned_key)
    logger.info(f"Uploaded versioned: r2://{config.r2_bucket}/{versioned_key}")

    # Upload as latest (the key the Worker reads)
    s3.upload_file(str(file_path), config.r2_bucket, "models/batch_predictions.json")
    logger.info(f"Uploaded latest: r2://{config.r2_bucket}/models/batch_predictions.json")

    # Read model metadata for version info
    meta_path = Path(model_dir) / "model_meta.json"
    model_meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}

    # Write freshness metadata
    predictions = json.loads(file_path.read_text())
    freshness_meta = {
        "version": timestamp,
        "model_version": model_meta.get("version", "unknown"),
        "conformal_correction": model_meta.get("conformal_correction", 0),
        "cards_scored": len(predictions),
        "scored_at": datetime.now(timezone.utc).isoformat(),
        "versioned_key": versioned_key,
    }
    meta_tmp = file_path.parent / "predictions_meta.json"
    meta_tmp.write_text(json.dumps(freshness_meta, indent=2))
    s3.upload_file(str(meta_tmp), config.r2_bucket, "models/predictions_meta.json")
    logger.info(f"Uploaded metadata: {freshness_meta['cards_scored']} cards, version {timestamp}")


@click.command()
@click.option("--model-dir", required=True, help="Directory with trained LightGBM models")
@click.option("--features", required=True, help="CSV with card_id, grade, grading_company, + feature columns")
@click.option("--output", default="batch_predictions.json", help="Output JSON file")
@click.option("--conformal-correction", default=None, type=float, help="Conformal width correction (log-scale). Auto-loaded from model_meta.json if omitted.")
@click.option("--upload", is_flag=True, help="Upload to R2 after scoring")
@click.option("--r2-endpoint", envvar="R2_ENDPOINT")
@click.option("--r2-access-key", envvar="R2_ACCESS_KEY")
@click.option("--r2-secret-key", envvar="R2_SECRET_KEY")
def cli(
    model_dir: str,
    features: str,
    output: str,
    conformal_correction: float,
    upload: bool,
    r2_endpoint: str | None,
    r2_access_key: str | None,
    r2_secret_key: str | None,
):
    """Batch-score all cards and write predictions to JSON / R2."""
    logging.basicConfig(level=logging.INFO)

    config = TrainingConfig()
    if r2_endpoint:
        config.r2_endpoint = r2_endpoint
    if r2_access_key:
        config.r2_access_key = r2_access_key
    if r2_secret_key:
        config.r2_secret_key = r2_secret_key

    models = load_models(model_dir, config)
    if not models:
        raise click.ClickException("No models found")

    # Auto-load conformal correction from model_meta.json if not specified
    if conformal_correction is None:
        conformal_correction = load_conformal_correction(model_dir)

    features_df = pd.read_csv(features)
    logger.info(f"Loaded {len(features_df)} feature rows from {features}")

    predictions = score_all_cards(models, features_df, config, conformal_correction)
    out_path = write_predictions(predictions, output)

    if upload:
        if not config.r2_endpoint:
            raise click.ClickException("R2_ENDPOINT required for upload")
        upload_predictions_to_r2(out_path, config, model_dir)


if __name__ == "__main__":
    cli()
