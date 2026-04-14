# Data Model

Database: Cloudflare D1 (SQLite). Schema lives in `apps/api/migrations/0001_initial_schema.sql` with follow-up changes in `0002_sentiment_raw_and_dedup.sql`.

## Tables

### card_catalog

Master registry of all tracked cards. Every other table references `card_catalog.id`.

| Column              | Type    | Constraints                          | Description |
|---------------------|---------|--------------------------------------|-------------|
| `id`                | TEXT    | PRIMARY KEY                          | Deterministic slug: `{category}-{set_name}-{card_number}` lowercased |
| `name`              | TEXT    | NOT NULL                             | Card name (e.g., "Charizard") |
| `set_name`          | TEXT    | NOT NULL                             | Set (e.g., "Base Set") |
| `set_year`          | INTEGER | NOT NULL                             | Year of set release |
| `card_number`       | TEXT    | NOT NULL                             | Card number within set |
| `category`          | TEXT    | NOT NULL, CHECK enum                 | `pokemon`, `sports_baseball`, `sports_basketball`, `sports_football`, `sports_hockey`, `tcg_mtg`, `tcg_yugioh`, `other` |
| `player_character`  | TEXT    | nullable                             | Player name or character name |
| `team`              | TEXT    | nullable                             | Team (sports cards) |
| `rarity`            | TEXT    | nullable                             | Card rarity level |
| `image_url`         | TEXT    | nullable                             | Card image URL |
| `pricecharting_id`  | TEXT    | nullable                             | PriceCharting product ID (required for PC ingestion) |
| `psa_cert_lookup_id`| TEXT    | nullable                             | PSA cert lookup ID (required for population ingestion) |
| `created_at`        | TEXT    | DEFAULT datetime('now')              | |
| `updated_at`        | TEXT    | DEFAULT datetime('now')              | Updated on upsert |

**Indexes:** `category`, `(set_name, set_year)`, `name`, `pricecharting_id`

### price_observations

Every individual price data point from any source. The core raw data table.

| Column           | Type    | Constraints              | Description |
|------------------|---------|--------------------------|-------------|
| `id`             | INTEGER | PRIMARY KEY AUTOINCREMENT| |
| `card_id`        | TEXT    | FK → card_catalog        | |
| `source`         | TEXT    | CHECK enum               | `ebay`, `soldcomps`, `pricecharting`, `cardhedger`, `tcgplayer`, `gamestop_internal` |
| `price_usd`      | REAL    | NOT NULL                 | Sale price in USD. Best-offer prices are stored at 80% of listed price. |
| `sale_date`      | TEXT    | NOT NULL                 | Date of sale (YYYY-MM-DD) |
| `grade`          | TEXT    | nullable                 | Grade value (e.g., "10", "9.5", "RAW") |
| `grading_company`| TEXT    | CHECK enum               | `PSA`, `BGS`, `CGC`, `SGC`, `RAW` |
| `grade_numeric`  | REAL    | nullable                 | Parsed numeric grade for ML features |
| `sale_type`      | TEXT    | CHECK enum               | `auction`, `buy_it_now`, `best_offer`, `fixed` |
| `listing_url`    | TEXT    | nullable                 | Link to original listing |
| `seller_id`      | TEXT    | nullable                 | Seller identifier (from SoldComps/eBay) |
| `bid_count`      | INTEGER | nullable                 | Number of bids (auctions) |
| `is_anomaly`     | INTEGER | NOT NULL, DEFAULT 0      | 1 = flagged by anomaly detection |
| `anomaly_reason` | TEXT    | nullable                 | Human-readable reason for flagging |
| `created_at`     | TEXT    | DEFAULT datetime('now')  | When this record was ingested |

**Indexes:** `(card_id, sale_date DESC)`, `(card_id, grading_company, grade)`, `(source, sale_date DESC)`, `(sale_date DESC)`, partial index on `is_anomaly = 1`, unique partial index on `(card_id, source, listing_url)` when `listing_url IS NOT NULL`

**Invariants:**
- Anomalous observations (`is_anomaly = 1`) are excluded from all downstream computation: aggregates, features, predictions, and API responses (except raw history).
- Best-offer prices are pre-adjusted (×0.80) at ingestion time before insertion.
- Lot/bundle sales are filtered at ingestion and never inserted.
- Queue inserts use `INSERT OR IGNORE`, so the dedup index on `listing_url` is part of the current ingestion contract.

### price_aggregates

Pre-computed rollups per card+grade at daily, weekly, and monthly granularity.

| Column           | Type    | Constraints                                              |
|------------------|---------|----------------------------------------------------------|
| `id`             | INTEGER | PRIMARY KEY AUTOINCREMENT                                |
| `card_id`        | TEXT    | FK → card_catalog                                        |
| `grade`          | TEXT    | NOT NULL                                                 |
| `grading_company`| TEXT    | NOT NULL                                                 |
| `period`         | TEXT    | CHECK: `daily`, `weekly`, `monthly`                      |
| `period_start`   | TEXT    | NOT NULL — start of the period                           |
| `avg_price`      | REAL    | NOT NULL                                                 |
| `median_price`   | REAL    | NOT NULL — approximated as mean (SQLite has no percentile function) |
| `min_price`      | REAL    | NOT NULL                                                 |
| `max_price`      | REAL    | NOT NULL                                                 |
| `sale_count`     | INTEGER | NOT NULL                                                 |
| `volume_bucket`  | TEXT    | CHECK: `high`, `medium`, `low`                           |
| `created_at`     | TEXT    | DEFAULT datetime('now')                                  |

**Unique:** `(card_id, grade, grading_company, period, period_start)`

**Population schedule:**
- Daily: runs every day for yesterday's data.
- Weekly: runs on Mondays.
- Monthly: runs on the 1st.

### population_reports

Daily snapshots of PSA/CGC/BGS/SGC population counts per card+grade.

| Column           | Type    | Constraints                                     |
|------------------|---------|-------------------------------------------------|
| `id`             | INTEGER | PRIMARY KEY AUTOINCREMENT                       |
| `card_id`        | TEXT    | FK → card_catalog                               |
| `grading_company`| TEXT    | NOT NULL                                        |
| `grade`          | TEXT    | NOT NULL                                        |
| `population`     | INTEGER | NOT NULL — count of cards graded at this level  |
| `pop_higher`     | INTEGER | DEFAULT 0 — count graded higher                |
| `total_population`| INTEGER| DEFAULT 0 — total across all grades            |
| `snapshot_date`  | TEXT    | NOT NULL                                        |
| `created_at`     | TEXT    | DEFAULT datetime('now')                         |

**Unique:** `(card_id, grading_company, grade, snapshot_date)`

### sentiment_raw

Individual sentiment observations from the queue consumer. Pruned after 35 days.

| Column       | Type    | Constraints                |
|--------------|---------|----------------------------|
| `id`         | INTEGER | PRIMARY KEY AUTOINCREMENT  |
| `card_id`    | TEXT    | FK → card_catalog          |
| `source`     | TEXT    | CHECK: `reddit`, `twitter` |
| `score`      | REAL    | NOT NULL, range -1 to 1    |
| `post_url`   | TEXT    | nullable                   |
| `engagement` | INTEGER | DEFAULT 0 — upvotes+comments |
| `observed_at`| TEXT    | DEFAULT datetime('now')    |

**Unique:** `(card_id, source, post_url)` when `post_url IS NOT NULL`

**Retention:** rows older than 35 days are deleted by the hourly rollup job.

### sentiment_scores

Rolled-up sentiment per card+source+period, refreshed hourly.

| Column        | Type    | Constraints                          |
|---------------|---------|--------------------------------------|
| `id`          | INTEGER | PRIMARY KEY AUTOINCREMENT            |
| `card_id`     | TEXT    | FK → card_catalog                    |
| `source`      | TEXT    | CHECK: `reddit`, `twitter`           |
| `score`       | REAL    | NOT NULL — engagement-weighted avg, range -1 to 1 |
| `mention_count`| INTEGER| DEFAULT 0                            |
| `period`      | TEXT    | CHECK: `24h`, `7d`, `30d`           |
| `top_posts`   | TEXT    | nullable — JSON array of up to 5 URLs |
| `rollup_date` | TEXT    | NOT NULL — calendar date of rollup   |
| `computed_at` | TEXT    | DEFAULT datetime('now')              |

**Unique:** `(card_id, source, period, rollup_date)` — stable key for upsert.

### model_predictions

ML model outputs with full quantile prediction intervals.

| Column           | Type    | Constraints                          |
|------------------|---------|--------------------------------------|
| `id`             | INTEGER | PRIMARY KEY AUTOINCREMENT            |
| `card_id`        | TEXT    | FK → card_catalog                    |
| `grade`          | TEXT    | NOT NULL                             |
| `grading_company`| TEXT    | NOT NULL                             |
| `model_version`  | TEXT    | NOT NULL — e.g., `lgbm-v1`, `statistical-v1` |
| `fair_value`     | REAL    | NOT NULL — p50 estimate              |
| `p10`            | REAL    | NOT NULL                             |
| `p25`            | REAL    | NOT NULL                             |
| `p50`            | REAL    | NOT NULL                             |
| `p75`            | REAL    | NOT NULL                             |
| `p90`            | REAL    | NOT NULL                             |
| `buy_threshold`  | REAL    | NOT NULL — max buy price at 20% margin |
| `sell_threshold`  | REAL   | NOT NULL — price at which to sell    |
| `confidence`     | TEXT    | CHECK: `HIGH`, `MEDIUM`, `LOW`       |
| `volume_bucket`  | TEXT    | CHECK: `high`, `medium`, `low`       |
| `predicted_at`   | TEXT    | DEFAULT datetime('now')              |

**Indexes:** `(card_id, grading_company, grade, predicted_at DESC)`, `(model_version)`

API and evaluate routes always read the latest `predicted_at` row for a given card+grade+company.

### price_alerts

Triggered alerts from anomaly detection or sentiment spikes.

| Column          | Type    | Constraints                                  |
|-----------------|---------|----------------------------------------------|
| `id`            | INTEGER | PRIMARY KEY AUTOINCREMENT                    |
| `card_id`       | TEXT    | FK → card_catalog                            |
| `alert_type`    | TEXT    | CHECK: `price_spike`, `price_crash`, `viral_social`, `anomaly_detected`, `new_high`, `new_low` |
| `magnitude`     | REAL    | NOT NULL — % change or severity score        |
| `trigger_source`| TEXT    | NOT NULL — which system created the alert    |
| `message`       | TEXT    | NOT NULL — human-readable description        |
| `is_active`     | INTEGER | DEFAULT 1                                    |
| `created_at`    | TEXT    | DEFAULT datetime('now')                      |
| `resolved_at`   | TEXT    | nullable — set when resolved via API         |

**Deduplication:** anomaly detection checks for existing active alert of same card+type within 24h before creating a new one.

### feature_store

Pre-computed feature vectors for ML inference. One row per card+grade+company.

| Column           | Type    | Constraints                   |
|------------------|---------|-------------------------------|
| `id`             | INTEGER | PRIMARY KEY AUTOINCREMENT     |
| `card_id`        | TEXT    | FK → card_catalog             |
| `grade`          | TEXT    | NOT NULL                      |
| `grading_company`| TEXT    | NOT NULL                      |
| `features`       | TEXT    | NOT NULL — JSON blob of the feature-store payload |
| `computed_at`    | TEXT    | DEFAULT datetime('now')       |

**Unique:** `(card_id, grade, grading_company)` — upserted daily.

See [ML_DESIGN.md](ML_DESIGN.md) for the full list of stored fields and the 22 model input columns used by training.

### ingestion_log

Pipeline monitoring table. Every scheduled job logs start, completion, and failures.

| Column             | Type    | Constraints                      |
|--------------------|---------|----------------------------------|
| `id`               | INTEGER | PRIMARY KEY AUTOINCREMENT        |
| `source`           | TEXT    | NOT NULL — job name              |
| `run_type`         | TEXT    | NOT NULL — `scheduled`, `daily`, `hourly` |
| `status`           | TEXT    | CHECK: `started`, `completed`, `failed` |
| `records_processed`| INTEGER | DEFAULT 0                        |
| `error_message`    | TEXT    | nullable                         |
| `started_at`       | TEXT    | DEFAULT datetime('now')          |
| `completed_at`     | TEXT    | nullable                         |

## Entity Relationships

```
card_catalog (1) ──< (N) price_observations
card_catalog (1) ──< (N) price_aggregates
card_catalog (1) ──< (N) population_reports
card_catalog (1) ──< (N) sentiment_raw
card_catalog (1) ──< (N) sentiment_scores
card_catalog (1) ──< (N) model_predictions
card_catalog (1) ──< (N) price_alerts
card_catalog (1) ──< (N) feature_store
```

All tables reference `card_catalog.id` via foreign key. The `ingestion_log` table is standalone.
