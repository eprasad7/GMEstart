#!/usr/bin/env bash
set -euo pipefail

# Full training → scoring → upload pipeline.
# Run weekly (or on-demand) to retrain models and update predictions.
#
# Prerequisites:
#   pip install -e packages/ml-training
#   Export R2 credentials: R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY
#   Provide a features CSV exported from D1 (see below)
#
# Usage:
#   ./scripts/run_pipeline.sh --data training_data.csv --features features.csv

DATA_FILE="${1:?Usage: run_pipeline.sh --data <training_data.csv> --features <features.csv>}"
shift
FEATURES_FILE="${1:?Usage: run_pipeline.sh --data <training_data.csv> --features <features.csv>}"

MODEL_DIR="models/"
ONNX_DIR="onnx_models/"
OUTPUT="batch_predictions.json"

echo "=== Step 1: Train quantile models ==="
gamecards-train --data "$DATA_FILE" --output "$MODEL_DIR"

echo ""
echo "=== Step 2: Export to ONNX ==="
gamecards-export --model-dir "$MODEL_DIR" --output "$ONNX_DIR"

echo ""
echo "=== Step 3: Batch score all cards ==="
# Conformal correction is auto-loaded from model_meta.json
gamecards-score \
  --model-dir "$MODEL_DIR" \
  --features "$FEATURES_FILE" \
  --output "$OUTPUT" \
  --upload

echo ""
echo "=== Pipeline complete ==="
echo "Predictions uploaded to R2. The Worker will pick them up within 10 minutes."
