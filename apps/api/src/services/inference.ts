import type { Env } from "../types";

/**
 * ML inference service.
 *
 * Serving strategy (in priority order):
 * 1. Batch predictions from R2 (batch_predictions.json, written by batch_score.py)
 * 2. Statistical fallback from feature store (if no ML predictions available)
 *
 * The batch_score.py pipeline (run externally) loads trained LightGBM models,
 * scores all cards, applies conformal calibration + NRV-based buy/sell thresholds,
 * and uploads batch_predictions.json to R2. This file is the working ML serving path.
 */

interface PredictionResult {
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
  model_version: string;
}

interface BatchPrediction {
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
}

// In-memory cache of batch predictions (keyed by "cardId:gradingCompany:grade")
let predictionCache: Map<string, BatchPrediction> | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // re-check R2 every 10 minutes

function predictionKey(cardId: string, gradingCompany: string, grade: string): string {
  return `${cardId}:${gradingCompany}:${grade}`;
}

/**
 * Load batch predictions from R2 into an in-memory lookup map.
 * Cached per isolate with a 10-minute TTL.
 */
async function loadBatchPredictions(env: Env): Promise<Map<string, BatchPrediction> | null> {
  if (predictionCache && Date.now() - cacheLoadedAt < CACHE_TTL_MS) {
    return predictionCache;
  }

  const obj = await env.MODELS.get("models/batch_predictions.json");
  if (!obj) return null;

  const predictions = (await obj.json()) as BatchPrediction[];
  const map = new Map<string, BatchPrediction>();
  for (const p of predictions) {
    map.set(predictionKey(p.card_id, p.grading_company, p.grade), p);
  }

  predictionCache = map;
  cacheLoadedAt = Date.now();
  return map;
}

/**
 * Generate price predictions for a card.
 * Checks batch predictions first, falls back to statistical estimation.
 */
export async function predictPrice(
  env: Env,
  cardId: string,
  gradingCompany: string,
  grade: string
): Promise<PredictionResult | null> {
  // Try batch predictions from R2 (ML model output)
  const batch = await loadBatchPredictions(env);
  if (batch) {
    const key = predictionKey(cardId, gradingCompany, grade);
    const bp = batch.get(key);
    if (bp) {
      return {
        fair_value: bp.fair_value,
        p10: bp.p10,
        p25: bp.p25,
        p50: bp.p50,
        p75: bp.p75,
        p90: bp.p90,
        buy_threshold: bp.buy_threshold,
        sell_threshold: bp.sell_threshold,
        confidence: bp.confidence,
        volume_bucket: bp.volume_bucket,
        model_version: bp.model_version,
      };
    }
  }

  // Fallback: statistical estimation from feature store
  const featureRow = await env.DB.prepare(
    `SELECT features FROM feature_store
     WHERE card_id = ? AND grade = ? AND grading_company = ?`
  )
    .bind(cardId, grade, gradingCompany)
    .first();

  if (!featureRow) return null;

  const features = JSON.parse(featureRow.features as string);
  return statisticalEstimation(features);
}

/**
 * Statistical fallback estimation when batch predictions are unavailable.
 * Produces NRV-based buy thresholds matching the spec (Section 3.5).
 */
function statisticalEstimation(
  features: Record<string, number | boolean | string>
): PredictionResult {
  const volumeBucket = (features.volume_bucket as "high" | "medium" | "low") || "low";
  const avgPrice30d = (features.avg_price_30d as number) || 0;
  const avgPrice90d = (features.avg_price_90d as number) || 0;
  const volatility = (features.price_volatility_30d as number) || 0;
  const momentum = (features.price_momentum as number) || 1;

  const basePrice = avgPrice30d > 0
    ? avgPrice30d * 0.7 + avgPrice90d * 0.3
    : avgPrice90d > 0
      ? avgPrice90d
      : 0;

  if (basePrice === 0) {
    return {
      fair_value: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0,
      buy_threshold: 0, sell_threshold: 0,
      confidence: "LOW", volume_bucket: volumeBucket,
      model_version: "statistical-v1",
    };
  }

  const adjustedPrice = basePrice * (momentum > 0 ? momentum : 1);

  let intervalMultiplier: number;
  let confidence: "HIGH" | "MEDIUM" | "LOW";

  switch (volumeBucket) {
    case "high":
      intervalMultiplier = Math.max(0.10, volatility * 1.5);
      confidence = volatility < 0.15 ? "HIGH" : "MEDIUM";
      break;
    case "medium":
      intervalMultiplier = Math.max(0.20, volatility * 2.0);
      confidence = "MEDIUM";
      break;
    case "low":
    default:
      intervalMultiplier = Math.max(0.35, volatility * 3.0);
      confidence = "LOW";
      break;
  }

  const p50 = adjustedPrice;
  const p10 = p50 * (1 - intervalMultiplier * 1.5);
  const p25 = p50 * (1 - intervalMultiplier * 0.8);
  const p75 = p50 * (1 + intervalMultiplier * 0.8);
  const p90 = p50 * (1 + intervalMultiplier * 1.5);

  // NRV-based buy threshold (Section 3.5)
  const nrv = p50 * (1 - 0.13) * (1 - 0.03) - 5.00;
  const maxBuyPrice = nrv * (1 - 0.20);

  return {
    fair_value: round2(p50),
    p10: round2(Math.max(0, p10)),
    p25: round2(Math.max(0, p25)),
    p50: round2(p50),
    p75: round2(p75),
    p90: round2(p90),
    buy_threshold: round2(Math.max(0, maxBuyPrice)),
    sell_threshold: round2(p50 * (1 + intervalMultiplier)),
    confidence,
    volume_bucket: volumeBucket,
    model_version: "statistical-v1",
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Batch predict prices for all cards with features.
 * Called by the daily "0 6 * * *" cron via scheduler.
 * Writes to model_predictions that the serving layer reads.
 */
export async function batchPredict(env: Env): Promise<number> {
  // Prune predictions older than 7 days to prevent unbounded growth
  await env.DB.prepare(
    `DELETE FROM model_predictions WHERE predicted_at < datetime('now', '-7 days')`
  ).bind().run();

  const featureRows = await env.DB.prepare(
    `SELECT card_id, grade, grading_company FROM feature_store`
  )
    .bind()
    .all();

  const BATCH_SIZE = 50;
  let count = 0;
  const stmts: D1PreparedStatement[] = [];
  const keysToInvalidate: string[] = [];

  for (const row of featureRows.results) {
    const cardId = row.card_id as string;
    const grade = row.grade as string;
    const gradingCompany = row.grading_company as string;

    const prediction = await predictPrice(env, cardId, gradingCompany, grade);
    if (!prediction || prediction.fair_value === 0) continue;

    stmts.push(
      env.DB.prepare(
        `INSERT INTO model_predictions
           (card_id, grade, grading_company, model_version,
            fair_value, p10, p25, p50, p75, p90,
            buy_threshold, sell_threshold, confidence, volume_bucket)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        cardId, grade, gradingCompany, prediction.model_version,
        prediction.fair_value, prediction.p10, prediction.p25,
        prediction.p50, prediction.p75, prediction.p90,
        prediction.buy_threshold, prediction.sell_threshold,
        prediction.confidence, prediction.volume_bucket
      )
    );

    keysToInvalidate.push(`price:${cardId}:${gradingCompany}:${grade}`);
    count++;

    // Flush batch at BATCH_SIZE to avoid D1 100-statement limit
    if (stmts.length >= BATCH_SIZE) {
      await env.DB.batch(stmts);
      stmts.length = 0;
    }
  }

  // Flush remaining
  if (stmts.length > 0) {
    await env.DB.batch(stmts);
  }

  // Invalidate KV cache
  for (const key of keysToInvalidate) {
    await env.PRICE_CACHE.delete(key);
  }

  return count;
}
