-- Forward migration for existing D1 databases that already applied 0001.
-- Adds sentiment_raw table, migrates sentiment_scores (preserving data), and adds dedup indexes.

-- ─── New: sentiment_raw table ───
CREATE TABLE IF NOT EXISTS sentiment_raw (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES card_catalog(id),
  source TEXT NOT NULL CHECK (source IN ('reddit','twitter')),
  score REAL NOT NULL,
  post_url TEXT,
  engagement INTEGER NOT NULL DEFAULT 0,
  observed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sentiment_raw_card ON sentiment_raw(card_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_sentiment_raw_date ON sentiment_raw(observed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sentiment_raw_dedup ON sentiment_raw(card_id, source, post_url) WHERE post_url IS NOT NULL;

-- ─── Migrate sentiment_scores: preserve existing data ───
-- 1. Create new table with rollup_date column
CREATE TABLE IF NOT EXISTS sentiment_scores_new (
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

-- 2. Copy existing rows (use computed_at date as rollup_date for old data)
INSERT OR IGNORE INTO sentiment_scores_new
  (card_id, source, score, mention_count, period, top_posts, rollup_date, computed_at)
SELECT card_id, source, score, mention_count, period, top_posts,
       date(computed_at) as rollup_date, computed_at
FROM sentiment_scores;

-- 3. Swap tables
DROP TABLE IF EXISTS sentiment_scores;
ALTER TABLE sentiment_scores_new RENAME TO sentiment_scores;

CREATE INDEX IF NOT EXISTS idx_sentiment_card ON sentiment_scores(card_id, rollup_date DESC);

-- ─── New: dedup index on price_observations ───
CREATE UNIQUE INDEX IF NOT EXISTS idx_price_obs_dedup ON price_observations(card_id, source, listing_url) WHERE listing_url IS NOT NULL;
