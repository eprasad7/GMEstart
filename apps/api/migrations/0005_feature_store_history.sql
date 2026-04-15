-- Point-in-time feature snapshots for ML training/export.
-- Keep feature_store as the latest serving snapshot and append one row per day here.

CREATE TABLE IF NOT EXISTS feature_store_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES card_catalog(id),
  grade TEXT NOT NULL,
  grading_company TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  features TEXT NOT NULL,
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(card_id, grade, grading_company, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_feature_history_lookup
  ON feature_store_history(card_id, grading_company, grade, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_feature_history_snapshot
  ON feature_store_history(snapshot_date DESC);
