export interface Env {
  // D1 Database
  DB: D1Database;

  // KV Namespace
  PRICE_CACHE: KVNamespace;

  // R2 Buckets
  MODELS: R2Bucket;
  DATA_ARCHIVE: R2Bucket;

  // Queues
  INGESTION_QUEUE: Queue;
  SENTIMENT_QUEUE: Queue;

  // Workers AI
  AI: Ai;

  // Environment variables
  ENVIRONMENT: string;

  // Secrets (set via `wrangler secret put`)
  SOLDCOMPS_API_KEY: string;
  PRICECHARTING_API_KEY: string;
  CARDHEDGER_API_KEY: string;
  REDDIT_CLIENT_ID: string;
  REDDIT_CLIENT_SECRET: string;
  POKEMON_PRICE_TRACKER_KEY: string;
  API_KEY: string;

  // Durable Object bindings (Agents)
  PriceMonitorAgent: DurableObjectNamespace;
  MarketIntelligenceAgent: DurableObjectNamespace;
  CompetitorTrackerAgent: DurableObjectNamespace;
  PricingRecommendationAgent: DurableObjectNamespace;
}

// ─── Domain Types ───

export interface Card {
  id: string;
  name: string;
  set_name: string;
  set_year: number;
  card_number: string;
  category: "pokemon" | "sports_baseball" | "sports_basketball" | "sports_football" | "sports_hockey" | "tcg_mtg" | "tcg_yugioh" | "other";
  player_character: string | null;
  team: string | null;
  rarity: string | null;
  image_url: string | null;
  pricecharting_id: string | null;
  psa_cert_lookup_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PriceObservation {
  id: number;
  card_id: string;
  source: "ebay" | "soldcomps" | "pricecharting" | "cardhedger" | "tcgplayer" | "gamestop_internal";
  price_usd: number;
  sale_date: string;
  grade: string | null;
  grading_company: "PSA" | "BGS" | "CGC" | "SGC" | "RAW" | null;
  grade_numeric: number | null;
  sale_type: "auction" | "buy_it_now" | "best_offer" | "fixed" | null;
  listing_url: string | null;
  seller_id: string | null;
  bid_count: number | null;
  is_anomaly: boolean;
  anomaly_reason: string | null;
  created_at: string;
}

export interface PriceAggregate {
  card_id: string;
  grade: string;
  grading_company: string;
  period: "daily" | "weekly" | "monthly";
  period_start: string;
  avg_price: number;
  median_price: number;
  min_price: number;
  max_price: number;
  sale_count: number;
  volume_bucket: "high" | "medium" | "low";
}

export interface PopulationReport {
  card_id: string;
  grading_company: string;
  grade: string;
  population: number;
  pop_higher: number;
  total_population: number;
  snapshot_date: string;
}

export interface SentimentScore {
  card_id: string;
  source: "reddit" | "twitter";
  score: number; // -1 to 1
  mention_count: number;
  period: "24h" | "7d" | "30d";
  top_posts: string | null; // JSON array
  computed_at: string;
}

export interface ModelPrediction {
  card_id: string;
  grade: string;
  grading_company: string;
  model_version: string;
  fair_value: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  buy_threshold: number;
  sell_threshold: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  volume_bucket: "high" | "medium" | "low";
  predicted_at: string;
}

export interface PriceAlert {
  id: number;
  card_id: string;
  alert_type: "price_spike" | "price_crash" | "viral_social" | "anomaly_detected" | "new_high" | "new_low";
  magnitude: number;
  trigger_source: string;
  message: string;
  is_active: boolean;
  created_at: string;
  resolved_at: string | null;
}

// ─── API Response Types ───

export interface PriceResponse {
  card_id: string;
  card_name: string;
  grade: string;
  grading_company: string;
  price: number;
  lower: number;
  upper: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  last_sale: string | null;
  sales_30d: number;
  trend: "rising" | "stable" | "falling";
  updated_at: string;
}

export interface EvaluateRequest {
  card_id: string;
  offered_price: number;
  grade?: string;
  grading_company?: string;
}

export interface EvaluateResponse {
  decision: "STRONG_BUY" | "REVIEW_BUY" | "FAIR_VALUE" | "SELL_SIGNAL";
  fair_value: number;
  margin: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reasoning: string;
}

export interface MarketIndex {
  pokemon_index: number;
  sports_index: number;
  trend_30d: string;
  volatility: "low" | "moderate" | "high";
  updated_at: string;
}
