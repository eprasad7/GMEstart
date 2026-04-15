import { Hono } from "hono";
import type { Env } from "../types";

export const systemRoutes = new Hono<{ Bindings: Env }>();

/**
 * GET /v1/system/health
 *
 * Returns pipeline health: prediction freshness, model version,
 * ingestion status, and whether pricing data is stale.
 */
systemRoutes.get("/health", async (c) => {
  const [predictionMeta, latestPrediction, latestIngestion, cardCount] = await Promise.all([
    // Model metadata from R2
    c.env.MODELS.get("models/predictions_meta.json").then(async (obj) => {
      if (!obj) return null;
      return obj.json() as Promise<{
        version: string;
        model_version: string;
        conformal_correction: number;
        cards_scored: number;
        scored_at: string;
      }>;
    }),

    // Latest prediction timestamp from D1
    c.env.DB.prepare(
      `SELECT MAX(predicted_at) as latest FROM model_predictions`
    ).bind().first(),

    // Latest ingestion run
    c.env.DB.prepare(
      `SELECT source, status, records_processed, completed_at
       FROM ingestion_log
       WHERE status IN ('completed', 'failed')
       ORDER BY completed_at DESC LIMIT 5`
    ).bind().all(),

    // Total cards in catalog
    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM card_catalog`).bind().first(),
  ]);

  // Determine freshness
  const latestPredAt = latestPrediction?.latest as string | null;
  const hoursSincePrediction = latestPredAt
    ? (Date.now() - new Date(latestPredAt).getTime()) / (1000 * 60 * 60)
    : null;

  const scoredAt = predictionMeta?.scored_at;
  const hoursSinceScoring = scoredAt
    ? (Date.now() - new Date(scoredAt).getTime()) / (1000 * 60 * 60)
    : null;

  // Stale if predictions are older than 36 hours
  const isStale = hoursSincePrediction === null || hoursSincePrediction > 36;

  return c.json({
    status: isStale ? "degraded" : "healthy",
    predictions: {
      stale: isStale,
      latestPredictionAt: latestPredAt,
      hoursSincePrediction: hoursSincePrediction ? Math.round(hoursSincePrediction * 10) / 10 : null,
      r2Meta: predictionMeta || null,
    },
    catalog: {
      totalCards: (cardCount?.cnt as number) || 0,
    },
    ingestion: {
      recentRuns: latestIngestion.results.map((r) => ({
        source: r.source,
        status: r.status,
        records: r.records_processed,
        at: r.completed_at,
      })),
    },
  });
});

/**
 * GET /v1/system/model
 *
 * Returns current model version and prediction metadata.
 */
systemRoutes.get("/model", async (c) => {
  const meta = await c.env.MODELS.get("models/predictions_meta.json");
  if (!meta) {
    return c.json({ error: "No model metadata found in R2" }, 404);
  }
  return c.json(await meta.json());
});

/**
 * POST /v1/system/rollback
 *
 * Rollback to a previous version of batch_predictions.json.
 * Copies the versioned file back to the latest key.
 */
systemRoutes.post("/rollback", async (c) => {
  let body: { version_key: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON. Expected: { version_key: 'models/versions/...' }" }, 400);
  }

  const { version_key } = body;
  if (!version_key || !version_key.startsWith("models/versions/")) {
    return c.json({ error: "Invalid version_key" }, 400);
  }

  // Check if versioned file exists
  const versionedObj = await c.env.MODELS.get(version_key);
  if (!versionedObj) {
    return c.json({ error: `Version not found: ${version_key}` }, 404);
  }

  // Copy to latest
  const body2 = await versionedObj.arrayBuffer();
  await c.env.MODELS.put("models/batch_predictions.json", body2);

  return c.json({ status: "rolled_back", from: version_key, to: "models/batch_predictions.json" });
});
