# Operations Runbook

## Deployment

### Deploy API

```bash
cd apps/api
wrangler deploy
```

This deploys the Worker, cron triggers, and queue consumers in one step. Wrangler reads `wrangler.jsonc` for all bindings.

### Deploy Dashboard

```bash
cd apps/web
pnpm build
# Deploy to Cloudflare Pages or any static host
wrangler pages deploy dist/
```

### First-Time Setup

1. **Create D1 database:**
   ```bash
   wrangler d1 create gamecards-db
   ```
   Copy the `database_id` into `wrangler.jsonc`.

2. **Create KV namespace:**
   ```bash
   wrangler kv:namespace create PRICE_CACHE
   ```
   Copy the `id` into `wrangler.jsonc`.

3. **Create R2 buckets:**
   ```bash
   wrangler r2 bucket create gamecards-models
   wrangler r2 bucket create gamecards-data
   ```

4. **Create Queues:**
   ```bash
   wrangler queues create gamecards-ingestion
   wrangler queues create gamecards-sentiment
   ```

5. **Run migrations:**
   ```bash
   pnpm --filter api db:migrate:prod
   ```

6. **Set secrets:**
   ```bash
   cd apps/api
   wrangler secret put SOLDCOMPS_API_KEY
   wrangler secret put PRICECHARTING_API_KEY
   wrangler secret put REDDIT_CLIENT_ID
   wrangler secret put REDDIT_CLIENT_SECRET
   ```

7. **Deploy:**
   ```bash
   pnpm deploy:api
   ```

8. **Verify cron triggers** in the Cloudflare dashboard under Workers > Triggers.

## Database Migrations

### Apply Locally

```bash
pnpm db:migrate
# Equivalent to: wrangler d1 migrations apply gamecards-db --local
```

### Apply to Production

```bash
pnpm --filter api db:migrate:prod
# Equivalent to: wrangler d1 migrations apply gamecards-db --remote
```

### Create a New Migration

```bash
cd apps/api
wrangler d1 migrations create gamecards-db "description_of_change"
# Edit the generated SQL file in migrations/
```

### Check Migration Status

```bash
wrangler d1 migrations list gamecards-db --local
wrangler d1 migrations list gamecards-db --remote
```

## Backfill Data

### Bootstrap Card Catalog

Cards must exist in `card_catalog` before any ingestion runs. Use the bulk upsert endpoint:

```bash
curl -X POST https://<worker>.workers.dev/v1/cards/bulk \
  -H "Content-Type: application/json" \
  -d '{
    "cards": [
      {
        "name": "Charizard",
        "set_name": "Base Set",
        "set_year": 1999,
        "card_number": "4",
        "category": "pokemon",
        "player_character": "Charizard",
        "rarity": "Holo Rare",
        "pricecharting_id": "12345",
        "psa_cert_lookup_id": "67890"
      }
    ]
  }'
```

### Backfill Historical Prices

If you have PriceCharting CSV data or other historical price data:

1. Parse the CSV into the `price_observation` shape.
2. POST to the bulk upsert endpoint (if built) or insert via D1 directly:

```bash
wrangler d1 execute gamecards-db --remote --command="INSERT INTO price_observations (card_id, source, price_usd, sale_date, grade, grading_company) VALUES ('pokemon-base-set-4', 'pricecharting', 245.00, '2026-01-15', '10', 'PSA')"
```

For bulk inserts, write a script that generates SQL and uses `wrangler d1 execute`.

### Force Feature Recomputation

Features are computed daily at 5am. To force a recompute:

```bash
# Trigger the cron manually via curl (if you have a manual trigger endpoint)
# Or: delete existing features and wait for the next cron cycle
wrangler d1 execute gamecards-db --remote --command="DELETE FROM feature_store"
```

### Force Prediction Regeneration

```bash
# Delete existing predictions to force fresh generation at next 6am cron
wrangler d1 execute gamecards-db --remote --command="DELETE FROM model_predictions WHERE model_version = 'statistical-v1'"
```

The next daily cron at 6am will regenerate all predictions.

## Rotate Secrets

```bash
cd apps/api

# Rotate a secret
wrangler secret put SOLDCOMPS_API_KEY
# Enter new value when prompted

# Verify the worker picks up the new secret
wrangler tail  # Watch logs for next cron execution
```

No restart is needed — Workers pick up secret changes automatically on the next invocation.

## Inspect Queues

### View Queue Status

Check the Cloudflare dashboard under Workers > Queues for:
- Message count (pending)
- Processing rate
- Error rate
- Dead-letter count

### Queue Troubleshooting

If messages are failing:

1. Check Worker logs for errors:
   ```bash
   wrangler tail --format pretty
   ```

2. Look at the `ingestion_log` table for failed runs:
   ```bash
   wrangler d1 execute gamecards-db --remote --command="SELECT * FROM ingestion_log WHERE status = 'failed' ORDER BY started_at DESC LIMIT 10"
   ```

3. Common issues:
   - **External API down:** SoldComps or PriceCharting returning non-200. Messages will retry automatically via queue retry policy.
   - **D1 write errors:** Check for unique constraint violations (duplicate observations).
   - **Workers AI errors:** Sentiment model may be rate-limited or unavailable.

## Monitor Ingestion

### Check Recent Ingestion Runs

```bash
wrangler d1 execute gamecards-db --remote --command="SELECT source, run_type, status, records_processed, error_message, started_at FROM ingestion_log ORDER BY started_at DESC LIMIT 20"
```

### Check Data Freshness

```bash
# Most recent observation per source
wrangler d1 execute gamecards-db --remote --command="SELECT source, MAX(created_at) as latest, COUNT(*) as total FROM price_observations GROUP BY source"
```

### Check Anomaly Rate

```bash
wrangler d1 execute gamecards-db --remote --command="SELECT COUNT(*) as total, SUM(is_anomaly) as anomalous, ROUND(100.0 * SUM(is_anomaly) / COUNT(*), 1) as anomaly_pct FROM price_observations WHERE created_at >= datetime('now', '-7 days')"
```

### Check Active Alerts

```bash
wrangler d1 execute gamecards-db --remote --command="SELECT alert_type, COUNT(*) as count FROM price_alerts WHERE is_active = 1 GROUP BY alert_type"
```

## ML Model Operations

### Train New Models

```bash
cd packages/ml-training

# Export training data from D1 (script needed — see IMPLEMENTATION_STATUS.md)
# For now, prepare a CSV with columns matching config.feature_columns + price_usd + sale_date

# Train
gamecards-train --data training_data.csv --output models/

# Backtest
gamecards-backtest --data training_data.csv --output backtest_results.json

# Export ONNX artifacts and upload to R2
gamecards-export --model-dir models/ --output onnx_models/ --upload \
  --r2-endpoint https://<account_id>.r2.cloudflarestorage.com \
  --r2-access-key <key> \
  --r2-secret-key <secret>

# Batch-score cards and upload serving artifact
# Note: conformal correction is currently passed in manually if used.
gamecards-score --model-dir models/ --features features.csv --upload \
  --conformal-correction <optional_log_scale_width_adjustment> \
  --r2-endpoint https://<account_id>.r2.cloudflarestorage.com \
  --r2-access-key <key> \
  --r2-secret-key <secret>
```

### Verify Model Artifacts in R2

```bash
# List files in models bucket
wrangler r2 object list gamecards-models --prefix models/
```

Expected files:
- `models/lightgbm_quantile_latest.json` — metadata
- `models/lightgbm_q0.10.onnx` through `models/lightgbm_q0.90.onnx` — per-quantile models
- `models/batch_predictions.json` — pre-scored serving artifact consumed by the Worker

### Roll Back to Statistical Fallback

If a deployed model performs poorly, delete the batch prediction artifact from R2. The Worker will fall back to statistical estimation:

```bash
wrangler r2 object delete gamecards-models --key models/batch_predictions.json
```

The in-memory cache will expire within 10 minutes and the Worker will stop using batch-scored predictions.

## D1 Data Archival

D1 has a **10 GB per-database limit**. At ~300K observations/month, the database will approach this limit in approximately 6 months. The spec calls for archiving old observations to R2 as Parquet or CSV.

**Not yet implemented.** When it is, the procedure will be:

1. Export observations older than N months to R2:
   ```bash
   # Export old data (script needed)
   wrangler d1 execute gamecards-db --remote --command="SELECT * FROM price_observations WHERE sale_date < date('now', '-6 months')" --json > archive.json
   # Upload to R2
   wrangler r2 object put gamecards-data/archive/price_observations_YYYY_MM.json --file archive.json
   ```

2. Delete archived rows from D1:
   ```bash
   wrangler d1 execute gamecards-db --remote --command="DELETE FROM price_observations WHERE sale_date < date('now', '-6 months')"
   ```

3. Verify storage reclaimed:
   ```bash
   # Check D1 database size in Cloudflare dashboard under Workers > D1
   ```

**Important:** Archived data is no longer available for feature computation or aggregate queries. Ensure aggregates (price_aggregates) are computed before archival, as they serve as the long-term record.

## Monitoring

The spec calls for Cloudflare Analytics Engine for pipeline health. Currently available:

- **Workers Analytics (built-in):** Request count, error rate, CPU time, subrequest count — visible in Cloudflare dashboard under Workers > Analytics.
- **`ingestion_log` table:** Query for pipeline health (see "Monitor Ingestion" section above).
- **`wrangler tail`:** Live log streaming for debugging.

Not yet implemented:
- Custom Analytics Engine datasets for business metrics (cards priced, anomalies flagged, prediction coverage).
- Alerting / paging on pipeline failures.
- Model drift detection.

## Recovery Procedures

### D1 Database Restore

D1 has automatic point-in-time backups. Restore via the Cloudflare dashboard:
1. Go to Workers > D1 > gamecards-db > Backups.
2. Select a restore point.
3. Restore creates a new database — update `wrangler.jsonc` with the new ID if needed.

### Queue Message Loss

If queue messages are lost, the data can be re-ingested:
1. The next cron cycle will pick up where it left off (SoldComps and Population use LRU ordering).
2. PriceCharting and Reddit ingestion process the latest data regardless of what was lost.

### KV Cache Corruption

If cached prices are stale or wrong:

```bash
# Delete all cached prices (they regenerate on next request)
# No bulk delete in KV — entries expire naturally within 5-15 minutes
# Or: force prediction regeneration (see above), which invalidates caches
```

## Useful D1 Queries

```sql
-- Card count by category
SELECT category, COUNT(*) FROM card_catalog GROUP BY category;

-- Observation count by source, last 7 days
SELECT source, COUNT(*) FROM price_observations WHERE created_at >= datetime('now', '-7 days') GROUP BY source;

-- Cards with most anomalies
SELECT card_id, COUNT(*) as anomaly_count FROM price_observations WHERE is_anomaly = 1 GROUP BY card_id ORDER BY anomaly_count DESC LIMIT 10;

-- Feature store coverage
SELECT COUNT(*) as cards_with_features FROM feature_store;

-- Latest prediction stats
SELECT model_version, confidence, COUNT(*) FROM model_predictions WHERE predicted_at >= date('now', '-1 day') GROUP BY model_version, confidence;

-- Sentiment coverage
SELECT COUNT(DISTINCT card_id) as cards_with_sentiment FROM sentiment_scores WHERE rollup_date >= date('now', '-1 day');
```
