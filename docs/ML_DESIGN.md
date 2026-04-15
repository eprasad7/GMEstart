# ML Design

## Problem Statement

Predict fair market value and confidence intervals for collectible trading cards. The problem is characterized by:
- **Sparse, irregular observations.** Most cards sell 1-10x per month.
- **Fat-tailed price distributions.** A card can 10x overnight on social virality.
- **Heterogeneous volume.** The same model must handle cards with 100+ monthly sales and cards with 2 sales per quarter.
- **Grade sensitivity.** The same card at PSA 9 vs PSA 10 can differ 5-50x in price.

## Model Architecture

**LightGBM quantile regression** with separate models per quantile.

7 quantile models: p10, p20, p25, p50, p75, p80, p90.

Each model is trained independently with `objective: "quantile"` and `alpha: <quantile>`. The p50 model provides the fair value estimate. The p10-p90 range forms the 80% prediction interval.

### Why LightGBM

- Fast inference (<1ms per card).
- Handles mixed feature types (categorical grades, continuous prices, boolean flags).
- Native quantile regression support.
- Captures nonlinear relationships (e.g., PSA 10 pop 5 vs pop 500) without feature engineering.
- Interpretable via SHAP feature importance.
- Not enough data to justify deep learning.

### Why Not Time Series Models

Standard time series approaches (ARIMA, Prophet, etc.) assume regular observations at fixed intervals. Collectibles sales are irregular and vary widely in frequency. Tree-based models with engineered lag features handle this naturally.

## Feature Store Payload

Computed daily in `services/features.ts` and stored as a JSON blob in `feature_store`.

The `feature_store` row contains a broader operational payload than the model consumes:
- **26 stored fields** for routing, inspection, and downstream heuristics.
- **22 model input columns** from `packages/ml-training/src/gamecards_ml/config.py`.

Fields currently stored but **not** used by the LightGBM model are:
- `grading_company`
- `pop_growth_rate_90d`
- `social_mention_trend`
- `day_of_week`
- `volume_bucket`

### Grade and Population (9 features)

| Feature             | Type    | Source                  | Description |
|---------------------|---------|-------------------------|-------------|
| `grade_numeric`     | float   | price_observations      | Numeric grade (1-10), null for RAW |
| `is_gem_mint`       | bool    | derived                 | grade >= 9.5 |
| `is_perfect_10`     | bool    | derived                 | grade >= 10 |
| `pop_at_grade`      | int     | population_reports      | Count of cards graded at this level |
| `pop_higher`        | int     | population_reports      | Count graded higher |
| `pop_ratio`         | float   | derived                 | pop_at_grade / total_population |
| `is_pop_1`          | bool    | derived                 | pop_at_grade == 1 (unique) |
| `pop_growth_rate_90d`| float  | population_reports      | **Stubbed (returns 0)** — needs historical pop comparison |
| `grading_company`   | string  | price_observations      | Categorical: PSA, BGS, CGC, SGC, RAW |

### Demand Signals (9 features)

| Feature               | Type  | Source             | Description |
|-----------------------|-------|--------------------|-------------|
| `sales_count_7d`      | int   | price_observations | Sales in last 7 days |
| `sales_count_30d`     | int   | price_observations | Sales in last 30 days |
| `sales_count_90d`     | int   | price_observations | Sales in last 90 days |
| `velocity_trend`      | float | derived            | (sales_7d / 7) / (sales_30d / 30). >1 = accelerating demand |
| `price_momentum`      | float | derived            | avg_price_7d / avg_price_30d. >1 = rising prices |
| `avg_price_7d`        | float | price_observations | Non-anomalous average, last 7 days |
| `avg_price_30d`       | float | price_observations | Non-anomalous average, last 30 days |
| `avg_price_90d`       | float | price_observations | Non-anomalous average, last 90 days |
| `price_volatility_30d`| float | derived            | Coefficient of variation (stddev / mean) over 30 days |

### Sentiment (3 features)

| Feature                  | Type  | Source           | Description |
|--------------------------|-------|------------------|-------------|
| `social_sentiment_score` | float | sentiment_scores | 7d engagement-weighted score, range -1 to 1 |
| `social_mention_count_7d`| int   | sentiment_scores | Total mentions in last 7 days |
| `social_mention_trend`   | float | derived          | **Stubbed (returns 0)** — needs 7d/30d ratio |

### Seasonality (5 features)

| Feature              | Type  | Source  | Description |
|----------------------|-------|---------|-------------|
| `month_sin`          | float | derived | sin(2pi * month / 12) — cyclical encoding |
| `month_cos`          | float | derived | cos(2pi * month / 12) — cyclical encoding |
| `day_of_week`        | int   | derived | 0 (Sunday) - 6 (Saturday) |
| `is_holiday_season`  | bool  | derived | November or December |
| `is_tax_refund_season`| bool | derived | February through April |

### Volume Classification

| Feature         | Type   | Source  | Description |
|-----------------|--------|---------|-------------|
| `volume_bucket` | string | derived | `high` (90d sales >= 50), `medium` (>= 10), `low` (< 10) |

## Training Flow

### Data Preparation

1. Load CSV with features + `price_usd` target.
2. Log-transform target: `log_price = log1p(price_usd)`. Prices are log-normally distributed; this stabilizes variance.
3. Sort by `sale_date`.
4. Classify volume buckets per card+grade.

### Walk-Forward Validation

```
|--- Train (12 months) ---|--- Test (1 month) ---|
                          |--- Train (13 months) ---|--- Test (1 month) ---|
```

- Expanding window: train set grows with each fold.
- Minimum 1000 training samples per fold.
- Final production model uses the most recent split.

### Hyperparameters

| Parameter            | Value | Notes |
|----------------------|-------|-------|
| `learning_rate`      | 0.03  | Conservative for small datasets |
| `num_leaves`         | 63    | Moderate complexity |
| `min_data_in_leaf`   | 20    | Prevents overfitting on rare cards |
| `feature_fraction`   | 0.8   | Column subsampling |
| `bagging_fraction`   | 0.8   | Row subsampling |
| `bagging_freq`       | 5     | Subsample every 5 iterations |
| `lambda_l1`          | 0.1   | L1 regularization |
| `lambda_l2`          | 1.0   | L2 regularization |
| `num_boost_round`    | 2000  | Max iterations |
| `early_stopping`     | 50    | Stop if validation loss doesn't improve |

### ONNX Export

Each quantile model is exported separately to ONNX format via `onnxmltools`. A metadata JSON (`lightgbm_quantile_latest.json`) maps quantile → ONNX filename and lists the expected feature column order.

All artifacts are uploaded to the `gamecards-models` R2 bucket under the `models/` prefix.

## Serving

### Batch Pre-Scoring via R2 (current primary path)

The current implementation serves prices as **"batch predictions via R2 + statistical fallback"** rather than real-time ONNX inference. The flow:

1. Python training pipeline trains LightGBM quantile models.
2. Writes `batch_predictions.json` to the `gamecards-models` R2 bucket.
3. Worker reads pre-scored predictions from R2 at inference time.
4. Falls back to statistical estimation for cards not in the batch file.

**Status:** Implemented in code. `packages/ml-training/src/gamecards_ml/batch_score.py` writes `batch_predictions.json`, and `apps/api/src/services/inference.ts` loads it into an in-memory lookup map per isolate. The remaining operational gap is automation: the scorer is still run externally rather than by a repo-managed workflow.

**Training compute:** The spec suggests Modal or Railway for running the training pipeline, rather than self-hosted infrastructure.

### ONNX Path (deferred)

The original plan was direct per-quantile ONNX inference on Workers:
1. Worker loads model metadata from R2.
2. Reads feature vector from `feature_store`.
3. Runs per-quantile ONNX inference via `onnxruntime-web`.

**Status:** Deferred by design. ONNX export still exists for artifact portability, but the Worker does not attempt runtime ONNX inference. Serving currently relies on `batch_predictions.json` or the statistical fallback.

### Statistical Fallback (secondary path)

When ONNX models are unavailable, `statisticalEstimation()` runs:

1. **Base price** = 70% × avg_price_30d + 30% × avg_price_90d.
2. **Momentum adjustment** = base_price × price_momentum.
3. **Interval width** by volume bucket:
   - High volume: max(10%, volatility × 1.5). Confidence = HIGH if volatility < 15%, else MEDIUM.
   - Medium volume: max(20%, volatility × 2.0). Confidence = MEDIUM.
   - Low volume: max(35%, volatility × 3.0). Confidence = LOW.
4. **Quantile estimates:**
   - p10 = p50 × (1 - interval × 1.5)
   - p25 = p50 × (1 - interval × 0.8)
   - p75 = p50 × (1 + interval × 0.8)
   - p90 = p50 × (1 + interval × 1.5)
5. **NRV-based thresholds:**
   - NRV = p50 × (1 - 0.13) × (1 - 0.03) - $5.00
   - buy_threshold = NRV × (1 - 0.20)
   - sell_threshold = p50 × (1 + interval)

### Batch Prediction Materialization

Daily cron at 6am iterates all rows in `feature_store`, calls `predictPrice()`, inserts into `model_predictions`, and invalidates the KV cache entry for that card.

In practice this means:
- If `batch_predictions.json` exists in R2, `model_predictions` becomes a D1 materialization of the latest ML batch output.
- If it does not exist, the same cron writes heuristic predictions from `statisticalEstimation()`.

## Evaluation Metrics

All metrics are computed during walk-forward backtesting, stratified by volume bucket.

| Metric                     | Description                                         | Target |
|----------------------------|-----------------------------------------------------|--------|
| MdAPE (overall)            | Median Absolute Percentage Error of p50 predictions | < 15% (aspirational), < 45% (current gate) |
| MdAPE (high volume)        | MdAPE for cards with 90d sales >= 50                | < 10%  |
| MdAPE (medium volume)      | MdAPE for cards with 90d sales 10-49                | < 15%  |
| MdAPE (low volume)         | MdAPE for cards with 90d sales < 10                 | < 25%  |
| Coverage (p10-p90)         | % of actuals within p10-p90 interval (80% nominal)  | > 75%  |
| Interval width             | Average (p90 - p10) / p50 as percentage             | Minimize while maintaining coverage |
| Rank correlation           | Pearson correlation between predicted and actual prices | > 0.7 |
| Simulated P&L              | Trading profits (note: uses target as offer, see Section 6.4 of spec) | > $0 |

## Known Limitations

1. **Median approximated as mean in aggregates.** SQLite has no PERCENTILE_CONT. Daily `median_price` in `price_aggregates` is actually the mean. This affects features indirectly.

2. **No cross-card learning.** Each card+grade is predicted independently. There's no embedding that captures "Base Set cards tend to move together." This would require a more complex architecture.

3. **Sentiment extraction is LLM-based.** Card mention extraction uses Llama 3.1 8B via Workers AI to parse card names from Reddit post text. JSON parsing from LLM output is fragile and may miss mentions or hallucinate card names.

4. **Population growth rate is stubbed.** `pop_growth_rate_90d` returns 0 because it requires comparing population snapshots 90 days apart — the system needs 90+ days of population data before this feature becomes active.

5. **Conformal calibration exists, but artifact handoff is manual.** `conformal.py` is in the repo and training computes conformal metrics, but the correction is not automatically persisted from training into `batch_score.py`. The scorer accepts `--conformal-correction`, so production use still depends on an external handoff step.

6. **Best-offer bias.** Accepted best-offer prices are adjusted to 80% of listed price (per spec section 5.2), but the true acceptance rate varies by card and seller. This introduces systematic noise.
