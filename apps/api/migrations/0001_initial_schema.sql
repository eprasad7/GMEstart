-- GameCards Dynamic Pricing Engine — D1 Schema
-- Adapted from TimescaleDB design for SQLite/D1

-- ─── Card Catalog ───
CREATE TABLE IF NOT EXISTS card_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  set_name TEXT NOT NULL,
  set_year INTEGER NOT NULL,
  card_number TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('pokemon','sports_baseball','sports_basketball','sports_football','sports_hockey','tcg_mtg','tcg_yugioh','other')),
  player_character TEXT,
  team TEXT,
  rarity TEXT,
  image_url TEXT,
  pricecharting_id TEXT,
  psa_cert_lookup_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_card_catalog_category ON card_catalog(category);
CREATE INDEX idx_card_catalog_set ON card_catalog(set_name, set_year);
CREATE INDEX idx_card_catalog_name ON card_catalog(name);
CREATE INDEX idx_card_catalog_pricecharting ON card_catalog(pricecharting_id);

-- ─── Price Observations ───
-- Every scraped/API price point
CREATE TABLE IF NOT EXISTS price_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES card_catalog(id),
  source TEXT NOT NULL CHECK (source IN ('ebay','soldcomps','pricecharting','cardhedger','tcgplayer','gamestop_internal')),
  price_usd REAL NOT NULL,
  sale_date TEXT NOT NULL,
  grade TEXT,
  grading_company TEXT CHECK (grading_company IN ('PSA','BGS','CGC','SGC','RAW')),
  grade_numeric REAL,
  sale_type TEXT CHECK (sale_type IN ('auction','buy_it_now','best_offer','fixed')),
  listing_url TEXT,
  seller_id TEXT,
  bid_count INTEGER,
  is_anomaly INTEGER NOT NULL DEFAULT 0,
  anomaly_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_price_obs_card_date ON price_observations(card_id, sale_date DESC);
CREATE INDEX idx_price_obs_card_grade ON price_observations(card_id, grading_company, grade);
CREATE INDEX idx_price_obs_source ON price_observations(source, sale_date DESC);
CREATE INDEX idx_price_obs_date ON price_observations(sale_date DESC);
CREATE INDEX idx_price_obs_anomaly ON price_observations(is_anomaly) WHERE is_anomaly = 1;

-- ─── Price Aggregates ───
-- Daily/weekly/monthly rollups per card+grade
CREATE TABLE IF NOT EXISTS price_aggregates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES card_catalog(id),
  grade TEXT NOT NULL,
  grading_company TEXT NOT NULL,
  period TEXT NOT NULL CHECK (period IN ('daily','weekly','monthly')),
  period_start TEXT NOT NULL,
  avg_price REAL NOT NULL,
  median_price REAL NOT NULL,
  min_price REAL NOT NULL,
  max_price REAL NOT NULL,
  sale_count INTEGER NOT NULL,
  volume_bucket TEXT CHECK (volume_bucket IN ('high','medium','low')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(card_id, grade, grading_company, period, period_start)
);

CREATE INDEX idx_price_agg_card ON price_aggregates(card_id, grading_company, grade, period, period_start DESC);

-- ─── Population Reports ───
-- Daily PSA/CGC/BGS population snapshots
CREATE TABLE IF NOT EXISTS population_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES card_catalog(id),
  grading_company TEXT NOT NULL,
  grade TEXT NOT NULL,
  population INTEGER NOT NULL,
  pop_higher INTEGER NOT NULL DEFAULT 0,
  total_population INTEGER NOT NULL DEFAULT 0,
  snapshot_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(card_id, grading_company, grade, snapshot_date)
);

CREATE INDEX idx_pop_card ON population_reports(card_id, grading_company, snapshot_date DESC);

-- ─── Sentiment Raw ───
-- Individual sentiment observations from queue consumer
CREATE TABLE IF NOT EXISTS sentiment_raw (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES card_catalog(id),
  source TEXT NOT NULL CHECK (source IN ('reddit','twitter')),
  score REAL NOT NULL,
  post_url TEXT,
  engagement INTEGER NOT NULL DEFAULT 0,
  observed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sentiment_raw_card ON sentiment_raw(card_id, observed_at DESC);
CREATE INDEX idx_sentiment_raw_date ON sentiment_raw(observed_at DESC);

-- ─── Sentiment Scores ───
-- Rolled-up sentiment per card+source+period, refreshed hourly.
-- rollup_date is the calendar date the rollup covers (stable key for upsert).
CREATE TABLE IF NOT EXISTS sentiment_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES card_catalog(id),
  source TEXT NOT NULL CHECK (source IN ('reddit','twitter')),
  score REAL NOT NULL,
  mention_count INTEGER NOT NULL DEFAULT 0,
  period TEXT NOT NULL CHECK (period IN ('24h','7d','30d')),
  top_posts TEXT,
  rollup_date TEXT NOT NULL,
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(card_id, source, period, rollup_date)
);

CREATE INDEX idx_sentiment_card ON sentiment_scores(card_id, rollup_date DESC);

-- ─── Model Predictions ───
-- ML model outputs with confidence bands
CREATE TABLE IF NOT EXISTS model_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES card_catalog(id),
  grade TEXT NOT NULL,
  grading_company TEXT NOT NULL,
  model_version TEXT NOT NULL,
  fair_value REAL NOT NULL,
  p10 REAL NOT NULL,
  p25 REAL NOT NULL,
  p50 REAL NOT NULL,
  p75 REAL NOT NULL,
  p90 REAL NOT NULL,
  buy_threshold REAL NOT NULL,
  sell_threshold REAL NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('HIGH','MEDIUM','LOW')),
  volume_bucket TEXT NOT NULL CHECK (volume_bucket IN ('high','medium','low')),
  predicted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_predictions_card ON model_predictions(card_id, grading_company, grade, predicted_at DESC);
CREATE INDEX idx_predictions_version ON model_predictions(model_version);

-- ─── Price Alerts ───
CREATE TABLE IF NOT EXISTS price_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES card_catalog(id),
  alert_type TEXT NOT NULL CHECK (alert_type IN ('price_spike','price_crash','viral_social','anomaly_detected','new_high','new_low')),
  magnitude REAL NOT NULL,
  trigger_source TEXT NOT NULL,
  message TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX idx_alerts_active ON price_alerts(is_active, created_at DESC) WHERE is_active = 1;
CREATE INDEX idx_alerts_card ON price_alerts(card_id, created_at DESC);

-- ─── Feature Store ───
-- Pre-computed features for ML inference
CREATE TABLE IF NOT EXISTS feature_store (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES card_catalog(id),
  grade TEXT NOT NULL,
  grading_company TEXT NOT NULL,
  features TEXT NOT NULL, -- JSON blob of all computed features
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(card_id, grade, grading_company)
);

CREATE INDEX idx_features_card ON feature_store(card_id, grading_company, grade);

-- ─── Ingestion Log ───
-- Track data ingestion runs for monitoring
CREATE TABLE IF NOT EXISTS ingestion_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  run_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started','completed','failed')),
  records_processed INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX idx_ingestion_source ON ingestion_log(source, started_at DESC);
