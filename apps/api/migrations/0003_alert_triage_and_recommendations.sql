-- Alert triage: snooze + assign
ALTER TABLE price_alerts ADD COLUMN snoozed_until TEXT;
ALTER TABLE price_alerts ADD COLUMN assigned_to TEXT;

-- Recommendations / saved evaluations
CREATE TABLE IF NOT EXISTS recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES card_catalog(id),
  grade TEXT NOT NULL DEFAULT 'RAW',
  grading_company TEXT NOT NULL DEFAULT 'RAW',
  decision TEXT NOT NULL CHECK (decision IN ('STRONG_BUY','REVIEW_BUY','FAIR_VALUE','SELL_SIGNAL')),
  offered_price REAL NOT NULL,
  fair_value REAL NOT NULL,
  margin REAL NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('HIGH','MEDIUM','LOW')),
  channel TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  created_by TEXT,
  reviewed_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);

CREATE INDEX idx_recommendations_card ON recommendations(card_id, created_at DESC);
CREATE INDEX idx_recommendations_status ON recommendations(status, created_at DESC);
