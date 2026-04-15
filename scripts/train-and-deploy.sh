#!/usr/bin/env bash
set -euo pipefail

echo "=== GMEstart ML Training Pipeline ==="
echo "Running inside Cloudflare Container"
echo ""

# Step 1: Export features from D1
echo "Step 1: Exporting features from D1..."
gamecards-export-features \
  --output-features features.csv \
  --output-training training_data.csv

TRAIN_ROWS=$(wc -l < training_data.csv)
echo "Exported $TRAIN_ROWS training rows"

if [ "$TRAIN_ROWS" -lt 50 ]; then
  echo "WARNING: Only $TRAIN_ROWS rows — insufficient for training. Skipping."
  exit 0
fi

# Step 2: Train LightGBM quantile models
echo ""
echo "Step 2: Training LightGBM quantile regression..."
gamecards-train \
  --data training_data.csv \
  --output models/

# Step 3: Batch score all cards
echo ""
echo "Step 3: Batch scoring all cards..."
gamecards-score \
  --model-dir models/ \
  --features features.csv \
  --output batch_predictions.json \
  --upload

echo ""
echo "=== Pipeline complete ==="
echo "Predictions uploaded to R2. Worker will pick them up within 10 minutes."
