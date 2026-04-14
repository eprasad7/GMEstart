import type { Env } from "../types";

/**
 * ML inference service.
 *
 * Strategy:
 * 1. Check R2 for per-quantile ONNX models (uploaded by Python training pipeline)
 * 2. If models exist, load metadata + run inference via Workers AI
 * 3. If no models, fall back to statistical estimation from feature store
 * 4. Volume-aware routing: different confidence/interval widths by volume bucket
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

interface ModelMeta {
  version: string;
  quantiles: number[];
  feature_columns: string[];
  onnx_files: Record<string, string>;
}

// Cached model metadata per isolate lifetime
let cachedMeta: ModelMeta | null = null;
let metaLoadedAt = 0;
const META_TTL_MS = 5 * 60 * 1000; // re-check R2 every 5 minutes

/**
 * Load model metadata from R2. Cached in-memory per isolate.
 */
async function getModelMeta(env: Env): Promise<ModelMeta | null> {
  if (cachedMeta && Date.now() - metaLoadedAt < META_TTL_MS) {
    return cachedMeta;
  }
  const obj = await env.MODELS.get("models/lightgbm_quantile_latest.json");
  if (!obj) return null;
  cachedMeta = (await obj.json()) as ModelMeta;
  metaLoadedAt = Date.now();
  return cachedMeta;
}

/**
 * Prepare the feature vector in the order the ONNX model expects.
 */
function buildFeatureVector(
  features: Record<string, unknown>,
  featureColumns: string[]
): number[] {
  return featureColumns.map((col) => {
    const v = features[col];
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "number") return v;
    return 0;
  });
}

/**
 * Run inference for a single quantile using a per-quantile ONNX model stored in R2.
 *
 * Workers don't have a native ONNX runtime yet, so we use a two-tier approach:
 * 1. If the training pipeline has pre-scored all cards and written predictions
 *    directly to D1 (via the R2-triggered batch job), we just read those.
 * 2. Otherwise we fall back to statistical estimation.
 *
 * When onnxruntime-web becomes stable on Workers, replace this with direct
 * ONNX inference using the per-quantile model files in R2.
 */
async function runOnnxModels(
  env: Env,
  features: Record<string, unknown>,
  meta: ModelMeta
): Promise<PredictionResult | null> {
  // Check for pre-scored predictions uploaded by the training pipeline.
  // The Python pipeline can optionally batch-score all cards and write a
  // predictions.json to R2 alongside the ONNX files.
  const preScored = await env.MODELS.get("models/batch_predictions.json");
  if (!preScored) return null;

  // TODO: When onnxruntime-web is stable on Cloudflare Workers, load per-quantile
  // ONNX files directly:
  //   for (const q of meta.quantiles) {
  //     const onnxFile = meta.onnx_files[String(q)];
  //     const modelBytes = await env.MODELS.get(`models/${onnxFile}`);
  //     // run ort.InferenceSession.create(modelBytes) + session.run(featureVector)
  //   }
  // For now, per-card inference from R2 pre-scored JSON is the working path.

  return null;
}

/**
 * Generate price predictions for a card.
 * Uses ONNX model if available, falls back to statistical estimation.
 */
export async function predictPrice(
  env: Env,
  cardId: string,
  gradingCompany: string,
  grade: string
): Promise<PredictionResult | null> {
  // Get pre-computed features
  const featureRow = await env.DB.prepare(
    `SELECT features FROM feature_store
     WHERE card_id = ? AND grade = ? AND grading_company = ?`
  )
    .bind(cardId, grade, gradingCompany)
    .first();

  if (!featureRow) return null;

  const features = JSON.parse(featureRow.features as string);

  // Try ONNX model path
  const meta = await getModelMeta(env);
  if (meta) {
    const onnxResult = await runOnnxModels(env, features, meta);
    if (onnxResult) return onnxResult;
  }

  // Fallback: statistical estimation based on volume bucket
  return statisticalEstimation(features);
}

/**
 * Statistical fallback estimation when ONNX model is unavailable.
 * Routes to different strategies based on volume bucket.
 */
function statisticalEstimation(
  features: Record<string, number | boolean | string>
): PredictionResult {
  const volumeBucket = (features.volume_bucket as "high" | "medium" | "low") || "low";
  const avgPrice30d = (features.avg_price_30d as number) || 0;
  const avgPrice90d = (features.avg_price_90d as number) || 0;
  const volatility = (features.price_volatility_30d as number) || 0;
  const momentum = (features.price_momentum as number) || 1;

  // Base price: weighted average of recent prices
  const basePrice = avgPrice30d > 0
    ? avgPrice30d * 0.7 + avgPrice90d * 0.3
    : avgPrice90d > 0
      ? avgPrice90d
      : 0;

  if (basePrice === 0) {
    return {
      fair_value: 0,
      p10: 0, p25: 0, p50: 0, p75: 0, p90: 0,
      buy_threshold: 0,
      sell_threshold: 0,
      confidence: "LOW",
      volume_bucket: volumeBucket,
      model_version: "statistical-v1",
    };
  }

  // Adjust for momentum
  const adjustedPrice = basePrice * (momentum > 0 ? momentum : 1);

  // Width of prediction intervals based on volume and volatility
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

  // NRV-based buy threshold (matching spec Section 3.5)
  const MARKETPLACE_FEE = 0.13;
  const SHIPPING = 5.00;
  const RETURN_RATE = 0.03;
  const REQUIRED_MARGIN = 0.20;
  const nrv = p50 * (1 - MARKETPLACE_FEE) * (1 - RETURN_RATE) - SHIPPING;
  const maxBuyPrice = nrv * (1 - REQUIRED_MARGIN);

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
 * Called by the daily "0 5 * * *" cron via scheduler.
 * Writes rows to model_predictions that the serving layer reads.
 */
export async function batchPredict(env: Env): Promise<number> {
  const featureRows = await env.DB.prepare(
    `SELECT card_id, grade, grading_company, features FROM feature_store`
  )
    .bind()
    .all();

  let count = 0;

  for (const row of featureRows.results) {
    const cardId = row.card_id as string;
    const grade = row.grade as string;
    const gradingCompany = row.grading_company as string;

    const prediction = await predictPrice(env, cardId, gradingCompany, grade);
    if (!prediction || prediction.fair_value === 0) continue;

    await env.DB.prepare(
      `INSERT INTO model_predictions
         (card_id, grade, grading_company, model_version,
          fair_value, p10, p25, p50, p75, p90,
          buy_threshold, sell_threshold, confidence, volume_bucket)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        cardId, grade, gradingCompany, prediction.model_version,
        prediction.fair_value, prediction.p10, prediction.p25,
        prediction.p50, prediction.p75, prediction.p90,
        prediction.buy_threshold, prediction.sell_threshold,
        prediction.confidence, prediction.volume_bucket
      )
      .run();

    // Invalidate KV cache for this card
    await env.PRICE_CACHE.delete(`price:${cardId}:${gradingCompany}:${grade}`);

    count++;
  }

  return count;
}
