-- Model monitoring snapshots
CREATE TABLE IF NOT EXISTS model_monitoring_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_version TEXT NOT NULL,
  sample_size INTEGER NOT NULL DEFAULT 0,
  mdape_pct REAL,
  coverage_90 REAL,
  prediction_change_rate REAL NOT NULL DEFAULT 0,
  drift_status TEXT NOT NULL CHECK (drift_status IN ('healthy', 'warning', 'degraded')),
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_model_monitoring_created_at
  ON model_monitoring_snapshots(created_at DESC);

-- Archived D1 data bookkeeping
CREATE TABLE IF NOT EXISTS data_archive_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  retention_days INTEGER NOT NULL,
  rows_archived INTEGER NOT NULL DEFAULT 0,
  archive_key TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_data_archive_runs_type
  ON data_archive_runs(archive_type, started_at DESC);

-- GameStop internal demand / inventory signals
CREATE TABLE IF NOT EXISTS gamestop_internal_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES card_catalog(id),
  snapshot_date TEXT NOT NULL,
  trade_in_count INTEGER NOT NULL DEFAULT 0,
  avg_trade_in_price REAL NOT NULL DEFAULT 0,
  inventory_units INTEGER NOT NULL DEFAULT 0,
  store_views INTEGER NOT NULL DEFAULT 0,
  foot_traffic_index REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(card_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_gamestop_internal_card
  ON gamestop_internal_metrics(card_id, snapshot_date DESC);

-- Lightweight live experiment registry
CREATE TABLE IF NOT EXISTS model_experiments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  challenger_version_key TEXT NOT NULL,
  sample_rate REAL NOT NULL DEFAULT 0.1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'paused', 'completed')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  ended_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_model_experiments_status
  ON model_experiments(status, created_at DESC);

CREATE TABLE IF NOT EXISTS model_experiment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  experiment_id INTEGER NOT NULL REFERENCES model_experiments(id),
  assignment_key TEXT NOT NULL,
  card_id TEXT NOT NULL REFERENCES card_catalog(id),
  grade TEXT NOT NULL,
  grading_company TEXT NOT NULL,
  variant TEXT NOT NULL CHECK (variant IN ('control', 'challenger')),
  model_version TEXT,
  fair_value REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_model_experiment_events_experiment
  ON model_experiment_events(experiment_id, created_at DESC);
