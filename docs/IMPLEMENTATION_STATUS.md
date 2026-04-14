# Implementation Status

Last updated: 2026-04-14

## Summary

The core data pipeline (ingestion, anomaly detection, feature computation, prediction, and serving) is implemented for the prototype. The Python ML pipeline now includes training, backtesting, conformal evaluation, ONNX export, and batch scoring to R2. Runtime serving uses **batch predictions from R2 with statistical fallback**, while the dashboard is functional but still prototype-grade.

## Status Key

- **Implemented** — code complete, wired into the system, ready for production testing
- **Partially implemented** — core logic exists but has gaps or untested paths
- **Stubbed** — function signatures and data flow exist, body is placeholder or TODO
- **Not started** — mentioned in spec but no code exists

---

## API Layer

| Component                     | Status          | File                        | Notes |
|-------------------------------|-----------------|-----------------------------|-------|
| Health check endpoint         | Implemented     | `src/index.ts`              | |
| Price lookup (GET /v1/price)  | Implemented     | `src/routes/prices.ts`      | KV cached 5 min, falls back to moving average if no prediction |
| All grades (GET /v1/price/:id/all) | Implemented | `src/routes/prices.ts`     | |
| Price history                 | Implemented     | `src/routes/history.ts`     | Supports grade, source, days filters |
| Price aggregates              | Implemented     | `src/routes/history.ts`     | daily/weekly/monthly |
| Evaluate (POST /v1/evaluate)  | Implemented     | `src/routes/evaluate.ts`    | NRV-based with full decision logic |
| Sentiment score               | Implemented     | `src/routes/sentiment.ts`   | Weighted composite (24h=0.5, 7d=0.3, 30d=0.2) |
| Trending sentiment            | Implemented     | `src/routes/sentiment.ts`   | Cards with >5 mentions in 24h |
| Active alerts                 | Implemented     | `src/routes/alerts.ts`      | Filterable by category and type |
| Resolve alert                 | Implemented     | `src/routes/alerts.ts`      | |
| Alert history                 | Implemented     | `src/routes/alerts.ts`      | |
| Market index                  | Implemented     | `src/routes/market.ts`      | KV cached 15 min |
| Market movers                 | Implemented     | `src/routes/market.ts`      | Configurable direction, days, limit |
| Card search                   | Implemented     | `src/routes/cards.ts`       | LIKE-based search on name, player, set |
| Card CRUD                     | Implemented     | `src/routes/cards.ts`       | Single + bulk upsert |
| CORS + logging middleware     | Implemented     | `src/index.ts`              | |
| API authentication            | Not started     |                             | No auth — open endpoints |
| Rate limiting                 | Not started     |                             | |

## Data Ingestion

| Component                        | Status               | File                                   | Notes |
|----------------------------------|-----------------------|----------------------------------------|-------|
| SoldComps ingestion              | Implemented           | `services/ingestion/soldcomps.ts`      | 10 cards/run, LRU priority, lot filtering, grade parsing |
| PriceCharting ingestion          | Implemented           | `services/ingestion/pricecharting.ts`  | 100 cards/run, cents-to-dollars conversion |
| Reddit sentiment ingestion       | Implemented           | `services/ingestion/reddit.ts`         | 7 subreddits, OAuth token cached in KV |
| Population reports (GemRate)     | Partially implemented | `services/ingestion/population.ts`     | Code complete, but GemRate API contract is assumed — needs validation |
| eBay Marketplace Insights API    | Not started           |                                        | Requires negotiation with eBay via GameStop business relationship |
| CardHedger API                   | Not started           |                                        | Mentioned in types.ts, no ingestion code |
| TCGPlayer API                    | Not started           |                                        | Spec P2, requires application for access |
| Twitter/X sentiment              | Not started           |                                        | Schema supports it, pipeline does not |
| GameStop internal trade-in data  | Not started           |                                        | Spec P3, requires internal DB access |

## Queue Processing

| Component                           | Status      | File                          | Notes |
|-------------------------------------|-------------|-------------------------------|-------|
| Ingestion queue consumer            | Implemented | `services/queue-consumer.ts`  | Data quality filters, best-offer 80% adjustment |
| Sentiment queue consumer            | Implemented | `services/queue-consumer.ts`  | Workers AI distilbert sentiment classification |
| Card mention extraction (NER)       | Partially implemented | `services/ingestion/reddit.ts` | Uses Llama 3.1 8B via Workers AI — JSON parsing from LLM output is fragile |

## Feature Engineering & Aggregation

| Component                    | Status               | File                      | Notes |
|------------------------------|-----------------------|---------------------------|-------|
| Daily price aggregates       | Implemented           | `services/aggregates.ts`  | Median approximated as mean (SQLite has no PERCENTILE_CONT) |
| Weekly aggregates            | Implemented           | `services/aggregates.ts`  | Runs on Mondays |
| Monthly aggregates           | Implemented           | `services/aggregates.ts`  | Runs on 1st of month |
| Feature store payload        | Implemented           | `services/features.ts`    | 26 stored fields, 22 current model inputs |
| `pop_growth_rate_90d`        | Stubbed               | `services/features.ts:199`| Returns 0 — needs historical population comparison |
| `social_mention_trend`       | Stubbed               | `services/features.ts:213`| Returns 0 — needs 7d/30d mention ratio |
| Sentiment hourly rollup      | Implemented           | `services/sentiment-rollup.ts` | 24h/7d/30d periods, engagement-weighted, prunes raw data >35d |

## ML Inference & Prediction

| Component                          | Status               | File                       | Notes |
|------------------------------------|-----------------------|----------------------------|-------|
| Statistical fallback estimation    | Implemented           | `services/inference.ts`    | Volume-aware intervals, NRV thresholds |
| ONNX runtime on Workers            | Not started           |                            | ONNX export exists, but runtime serving does not use it |
| Pre-scored batch predictions (R2)  | Implemented           | `services/inference.ts` + `batch_score.py` | Worker loads `batch_predictions.json`; batch scorer writes and uploads it |
| Batch prediction cron              | Implemented           | `services/inference.ts`    | Iterates feature_store, writes model_predictions, invalidates KV |
| KV cache invalidation              | Implemented           | `services/inference.ts`    | Deletes cache key per card after new prediction |

## ML Training Pipeline (Python)

| Component                        | Status      | File                           | Notes |
|----------------------------------|-------------|--------------------------------|-------|
| LightGBM quantile training       | Implemented | `train.py`                     | 7 quantile models, walk-forward split |
| Walk-forward backtesting         | Implemented | `backtest.py`                  | Stratified by volume bucket, simulated P&L |
| ONNX export                      | Implemented | `export_onnx.py`               | Per-quantile ONNX files + metadata JSON |
| R2 upload                        | Implemented | `export_onnx.py`               | boto3 S3-compatible upload |
| MLflow integration               | Implemented | `train.py`                     | Logs params, metrics, iterations |
| Conformal calibration            | Partially implemented | `conformal.py` + `train.py` | In repo and used during evaluation, but correction is not auto-persisted into scoring |
| Batch scoring to R2              | Implemented | `batch_score.py`               | Writes `batch_predictions.json` for Worker serving |
| Training data export from D1     | Not started |                                | Need a script to export feature_store + prices to CSV |
| Automated retraining pipeline    | Not started |                                | Spec calls for weekly retrain via Airflow; no automation exists |

## Anomaly Detection

| Component                     | Status      | File                   | Notes |
|-------------------------------|-------------|------------------------|-------|
| Price outlier detection       | Implemented | `services/anomaly.ts`  | 3x range from 30d mean, requires >= 5 observations |
| Seller concentration          | Implemented | `services/anomaly.ts`  | avg > 1.5x market, 3+ sales; skips if no seller_id data |
| Data quality issues           | Implemented | `services/anomaly.ts`  | Graded (>= 8) under $1 |
| Price spikes/crashes          | Implemented | `services/anomaly.ts`  | 7d vs 30d MA >30% divergence, alert deduplication |

## Dashboard (React)

| Component         | Status               | File                      | Notes |
|-------------------|-----------------------|---------------------------|-------|
| App shell + nav   | Implemented           | `App.tsx`                 | 4-tab layout, mobile nav, category tabs |
| API client        | Implemented           | `lib/api.ts`              | Type-safe fetch wrapper for all endpoints |
| SearchBar         | Implemented           | `components/SearchBar.tsx`| Debounced search, combobox behavior, loading states |
| MarketOverview    | Implemented           | `components/MarketOverview.tsx` | Market index, movers, trending cards |
| CardDetail        | Implemented           | `components/CardDetail.tsx` | Grade/company selectors, charts, sentiment |
| EvaluateCard      | Implemented           | `components/EvaluateCard.tsx` | Search-driven evaluator with validation and results |
| AlertsList        | Implemented           | `components/AlertsList.tsx` | Resolve actions, empty state |
| PriceChart        | Implemented           | `components/PriceChart.tsx` | Recharts visualization with thresholds |
| SentimentGauge    | Implemented           | `components/SentimentGauge.tsx` | Sentiment bar and trend stats |
| StatCard          | Implemented           | `components/StatCard.tsx` | Shared summary card component |

## Infrastructure & Operations

| Component                          | Status       | Notes |
|------------------------------------|--------------|-------|
| D1 schema + forward migration      | Implemented  | `migrations/0001_initial_schema.sql` + `0002_sentiment_raw_and_dedup.sql` |
| Wrangler config (all bindings)     | Implemented  | `wrangler.jsonc` — needs real IDs before deploy |
| Cron trigger routing               | Implemented  | All 8 crons routed in `scheduler.ts` |
| Ingestion logging                  | Implemented  | `ingestion_log` table, started/completed/failed |
| CI/CD pipeline                     | Not started  | |
| Monitoring / alerting              | Not started  | Spec calls for Cloudflare Analytics Engine; Workers built-in analytics available but no custom dashboards or paging |
| Structured logging                 | Not started  | Uses `console.error` |
| D1 data archival to R2             | Not started  | Spec notes 10GB D1 limit — plan for archival at ~6 months. Old observations → R2 as Parquet/CSV |
| Backup / disaster recovery         | Not started  | D1 has automatic backups; no tested restore process |

## Security (Spec Section 7.1.1)

All items below are listed as **required before production deployment** in the updated spec.

| Requirement                         | Status      | Notes |
|-------------------------------------|-------------|-------|
| API authentication (Cloudflare Access or API key) | Not started | All `/v1/*` endpoints are open |
| GameStop SSO for dashboard          | Not started | |
| CORS lockdown to GameStop domains   | Not started | Currently `cors("*")` in `src/index.ts` |
| Rate limiting                       | Not started | Spec suggests Cloudflare rate limiting rules or KV-based throttling |
| `seller_id` hashing before storage  | Not started | Currently stored as plaintext from SoldComps |
| Secrets management                  | Implemented | All API keys configured via `wrangler secret put` |
| D1 access restriction               | Implemented | Only accessible via Worker bindings, no public endpoint |

---

## Biggest Gaps

1. **Security and authentication.** The updated spec (section 7.1.1) lists API auth, CORS lockdown, rate limiting, and `seller_id` hashing as required before production. None are implemented. Currently all endpoints are open with `cors("*")`.

2. **Operationalizing the batch-scoring path.** The R2 serving path now works in code, but producing and uploading `batch_predictions.json` is still an external/manual step. Production needs a scheduled scorer job and artifact promotion flow.

3. **Historical data backfill.** The database is empty. Need to bootstrap `card_catalog` and backfill `price_observations` from PriceCharting CSV exports or SoldComps historical queries.

4. **Training data pipeline.** No script exists to export D1 data → CSV for the Python training pipeline. This is the bridge between the ingested data and model training. Spec notes Modal/Railway as training compute options.

5. **Conformal correction handoff.** Conformal evaluation exists, but the correction is not automatically persisted from training into `batch_score.py`.

6. **D1 data archival.** The spec notes the 10GB D1 limit and calls for archiving old observations to R2 (Parquet/CSV) at approximately the 6-month mark. No archival logic exists.

7. **Source-specific dedup/data contracts.** The prototype now deduplicates by `listing_url` and `post_url`, but production needs per-source rules so sold listings, aggregated daily prices, and sentiment events are not conflated.

## Spec vs. Code Discrepancy: Cron Schedule Order

The updated spec and the code now match on daily job order:

1. anomaly detection (`0 4 * * *`)
2. aggregates + features (`0 5 * * *`)
3. predictions (`0 6 * * *`)

This keeps anomalous observations out of downstream features and predictions.
