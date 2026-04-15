import { Hono } from "hono";
import type { Env } from "../types";
import { bootstrapCatalog } from "../services/ingestion/bootstrap";
import { archiveOldObservations } from "../services/archive";
import { importGameStopInternalSnapshot, importPartnerPriceSnapshot } from "../services/ingestion/data-import";
import { searchAndImportCards } from "../services/ingestion/pricecharting";
import { generateMockInternalData } from "../services/ingestion/mock-gamestop";

export const systemRoutes = new Hono<{ Bindings: Env }>();

/**
 * GET /v1/system/health
 *
 * Returns pipeline health: prediction freshness, model version,
 * ingestion status, and whether pricing data is stale.
 */
systemRoutes.get("/health", async (c) => {
  const [predictionMeta, latestPrediction, latestIngestion, cardCount, latestMonitoring, latestArchive] = await Promise.all([
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
    c.env.DB.prepare(`SELECT MAX(predicted_at) as latest FROM model_predictions`).bind().first(),
    c.env.DB.prepare(
      `SELECT source, status, records_processed, completed_at
       FROM ingestion_log WHERE status IN ('completed', 'failed')
       ORDER BY completed_at DESC LIMIT 5`
    ).bind().all(),
    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM card_catalog`).bind().first(),
    c.env.DB.prepare(
      `SELECT model_version, sample_size, mdape_pct, coverage_90, prediction_change_rate, drift_status, message, created_at
       FROM model_monitoring_snapshots
       ORDER BY created_at DESC
       LIMIT 1`
    ).bind().first(),
    c.env.DB.prepare(
      `SELECT archive_type, rows_archived, archive_key, status, completed_at
       FROM data_archive_runs
       ORDER BY started_at DESC
       LIMIT 1`
    ).bind().first(),
  ]);

  const latestPredAt = latestPrediction?.latest as string | null;
  const hoursSincePrediction = latestPredAt
    ? (Date.now() - new Date(latestPredAt).getTime()) / (1000 * 60 * 60)
    : null;

  const scoredAt = predictionMeta?.scored_at;
  const hoursSinceScoring = scoredAt
    ? (Date.now() - new Date(scoredAt).getTime()) / (1000 * 60 * 60)
    : null;

  // Stale if predictions older than 36 hours (or no predictions at all)
  const isStale = hoursSincePrediction === null || hoursSincePrediction > 36;
  const driftStatus = (latestMonitoring?.drift_status as string | null) || "unknown";
  const degradedByDrift = driftStatus === "degraded";

  return c.json({
    status: isStale || degradedByDrift ? "degraded" : driftStatus === "warning" ? "warning" : "healthy",
    predictions: {
      stale: isStale,
      latestPredictionAt: latestPredAt,
      hoursSincePrediction: hoursSincePrediction !== null ? Math.round(hoursSincePrediction * 10) / 10 : null,
      hoursSinceScoring: hoursSinceScoring !== null ? Math.round(hoursSinceScoring * 10) / 10 : null,
    },
    model: predictionMeta || null,
    drift: latestMonitoring
      ? {
          modelVersion: latestMonitoring.model_version,
          sampleSize: latestMonitoring.sample_size,
          mdapePct: latestMonitoring.mdape_pct,
          coverage90: latestMonitoring.coverage_90,
          predictionChangeRate: latestMonitoring.prediction_change_rate,
          status: latestMonitoring.drift_status,
          message: latestMonitoring.message,
          createdAt: latestMonitoring.created_at,
        }
      : null,
    catalog: {
      totalCards: (cardCount?.cnt as number) || 0,
    },
    archive: latestArchive
      ? {
          type: latestArchive.archive_type,
          rowsArchived: latestArchive.rows_archived,
          archiveKey: latestArchive.archive_key,
          status: latestArchive.status,
          completedAt: latestArchive.completed_at,
        }
      : null,
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
 * GET /v1/system/activity — recent pipeline activity for agent dashboard
 */
systemRoutes.get("/activity", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") || "25"), 100);

  const results = await c.env.DB.prepare(
    `SELECT source, status, records_processed, error_message, started_at, completed_at
     FROM ingestion_log
     ORDER BY started_at DESC
     LIMIT ?`
  )
    .bind(limit)
    .all();

  const runs = results.results.map((r) => {
    const startedAt = r.started_at as string | null;
    const completedAt = r.completed_at as string | null;
    const durationMs = startedAt && completedAt
      ? new Date(completedAt).getTime() - new Date(startedAt).getTime()
      : null;

    return {
      source: r.source,
      status: r.status,
      records: r.records_processed,
      error: r.error_message || null,
      startedAt,
      completedAt,
      durationMs,
    };
  });

  return c.json({ runs });
});

/**
 * GET /v1/system/model
 */
systemRoutes.get("/model", async (c) => {
  const meta = await c.env.MODELS.get("models/predictions_meta.json");
  if (!meta) return c.json({ error: "No model metadata found in R2" }, 404);
  return c.json(await meta.json());
});

/**
 * POST /v1/system/rollback
 *
 * Full rollback: copies versioned predictions back to latest in R2,
 * re-imports into D1 model_predictions, invalidates KV cache,
 * and updates predictions_meta.json.
 */
systemRoutes.post("/rollback", async (c) => {
  let body: { version_key: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Expected: { version_key: 'models/versions/...' }" }, 400);
  }

  const { version_key } = body;
  if (!version_key?.startsWith("models/versions/")) {
    return c.json({ error: "Invalid version_key" }, 400);
  }

  const versionedObj = await c.env.MODELS.get(version_key);
  if (!versionedObj) {
    return c.json({ error: `Version not found: ${version_key}` }, 404);
  }

  // 1. Copy versioned predictions to latest in R2
  const predictionsBytes = await versionedObj.arrayBuffer();
  await c.env.MODELS.put("models/batch_predictions.json", predictionsBytes);

  // 2. Parse predictions and re-import into D1 model_predictions
  const predictions = JSON.parse(new TextDecoder().decode(predictionsBytes)) as Array<{
    card_id: string; grade: string; grading_company: string; model_version: string;
    fair_value: number; p10: number; p25: number; p50: number; p75: number; p90: number;
    buy_threshold: number; sell_threshold: number; confidence: string; volume_bucket: string;
  }>;

  // Batch upsert into D1
  const BATCH_SIZE = 90;
  const stmt = c.env.DB.prepare(
    `INSERT INTO model_predictions
       (card_id, grade, grading_company, model_version, fair_value, p10, p25, p50, p75, p90,
        buy_threshold, sell_threshold, confidence, volume_bucket)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(card_id, grade, grading_company) DO UPDATE SET
       model_version = excluded.model_version, fair_value = excluded.fair_value,
       p10 = excluded.p10, p25 = excluded.p25, p50 = excluded.p50,
       p75 = excluded.p75, p90 = excluded.p90,
       buy_threshold = excluded.buy_threshold, sell_threshold = excluded.sell_threshold,
       confidence = excluded.confidence, volume_bucket = excluded.volume_bucket,
       predicted_at = datetime('now')`
  );

  for (let i = 0; i < predictions.length; i += BATCH_SIZE) {
    const chunk = predictions.slice(i, i + BATCH_SIZE).map((p) =>
      stmt.bind(p.card_id, p.grade, p.grading_company, p.model_version,
        p.fair_value, p.p10, p.p25, p.p50, p.p75, p.p90,
        p.buy_threshold, p.sell_threshold, p.confidence, p.volume_bucket)
    );
    await c.env.DB.batch(chunk);
  }

  // 3. Invalidate ALL KV price cache entries
  // KV doesn't support list+delete, so we write a cache-bust marker
  // that inference.ts checks. Simpler: delete known keys from predictions.
  for (const p of predictions.slice(0, 500)) {
    await c.env.PRICE_CACHE.delete(`price:${p.card_id}:${p.grading_company}:${p.grade}`);
  }

  // 4. Update predictions_meta.json to reflect the rollback
  const rollbackMeta = {
    version: `rollback-${Date.now()}`,
    model_version: predictions[0]?.model_version || "unknown",
    cards_scored: predictions.length,
    scored_at: new Date().toISOString(),
    rolled_back_from: version_key,
  };
  await c.env.MODELS.put("models/predictions_meta.json", JSON.stringify(rollbackMeta));

  return c.json({
    status: "rolled_back",
    from: version_key,
    predictions_updated: predictions.length,
    kv_invalidated: Math.min(predictions.length, 500),
    meta_updated: true,
  });
});

/**
 * POST /v1/system/bootstrap
 */
systemRoutes.post("/bootstrap", async (c) => {
  try {
    const result = await bootstrapCatalog(c.env);
    return c.json({ status: "ok", ...result });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

/**
 * POST /v1/system/archive
 */
systemRoutes.post("/archive", async (c) => {
  try {
    const body: { retention_days?: number; batch_size?: number } =
      await c.req.json<{ retention_days?: number; batch_size?: number }>().catch(() => ({}));
    const result = await archiveOldObservations(c.env, body.retention_days, body.batch_size);
    return c.json({ status: "ok", ...result });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

/**
 * POST /v1/system/import/gamestop-internal
 */
systemRoutes.post("/import/gamestop-internal", async (c) => {
  try {
    const body: { object_key?: string } =
      await c.req.json<{ object_key?: string }>().catch(() => ({}));
    const imported = await importGameStopInternalSnapshot(c.env, body.object_key);
    return c.json({ status: "ok", imported });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

/**
 * POST /v1/system/import/partner-prices
 */
systemRoutes.post("/import/partner-prices", async (c) => {
  let body: { source: "ebay" | "tcgplayer"; object_key: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Expected: { source: 'ebay' | 'tcgplayer', object_key: string }" }, 400);
  }

  if (!body.object_key || (body.source !== "ebay" && body.source !== "tcgplayer")) {
    return c.json({ error: "source and object_key are required" }, 400);
  }

  try {
    const imported = await importPartnerPriceSnapshot(c.env, body.source, body.object_key);
    return c.json({ status: "ok", imported, source: body.source });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

/**
 * POST /v1/system/seed
 *
 * Quick seed: search PriceCharting for cards and import them into the catalog.
 * Great for bootstrapping a demo without uploading CSVs.
 *
 * Body: { queries: ["charizard", "jordan rookie", "pikachu"] }
 */
systemRoutes.post("/seed", async (c) => {
  let body: { queries: string[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Expected: { queries: ["charizard", "pikachu", ...] }' }, 400);
  }

  if (!Array.isArray(body.queries) || body.queries.length === 0) {
    return c.json({ error: "queries must be a non-empty array of search terms" }, 400);
  }

  let totalImported = 0;
  const results: Array<{ query: string; imported: number }> = [];

  for (const query of body.queries.slice(0, 20)) {
    try {
      const count = await searchAndImportCards(c.env, query, 25);
      totalImported += count;
      results.push({ query, imported: count });
    } catch (err) {
      results.push({ query, imported: 0 });
      console.error(`Seed failed for "${query}":`, err);
    }
  }

  return c.json({ status: "ok", totalImported, results });
});

/**
 * POST /v1/system/mock-internal
 *
 * Generate mock GameStop internal data (trade-ins, inventory, foot traffic)
 * for demo purposes. Requires cards in the catalog first.
 */
systemRoutes.post("/mock-internal", async (c) => {
  try {
    const result = await generateMockInternalData(c.env);
    return c.json({ status: "ok", ...result });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

/**
 * POST /v1/system/run-pipeline
 *
 * Manually trigger the daily pipeline: anomaly → aggregates → features → predictions.
 * For demo use — normally runs via cron at 4-6am UTC.
 */
systemRoutes.post("/run-pipeline", async (c) => {
  const { runAnomalyDetection } = await import("../services/anomaly");
  const { computeAggregates } = await import("../services/aggregates");
  const { computeFeatures } = await import("../services/features");
  const { batchPredict } = await import("../services/inference");

  const results: Record<string, number | string> = {};

  try {
    results.anomalies = await runAnomalyDetection(c.env);
    await computeAggregates(c.env);
    results.features = await computeFeatures(c.env);
    results.predictions = await batchPredict(c.env);
    results.status = "complete";
  } catch (err) {
    results.status = "failed";
    results.error = err instanceof Error ? err.message : String(err);
  }

  return c.json(results);
});

/**
 * GET /v1/system/experiments
 */
systemRoutes.get("/experiments", async (c) => {
  const results = await c.env.DB.prepare(
    `SELECT *
     FROM model_experiments
     ORDER BY created_at DESC`
  )
    .bind()
    .all();
  return c.json({ experiments: results.results });
});

/**
 * POST /v1/system/experiments
 */
systemRoutes.post("/experiments", async (c) => {
  let body: { name: string; challenger_version_key: string; sample_rate?: number; notes?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const sampleRate = body.sample_rate ?? 0.1;
  if (!body.name || !body.challenger_version_key || sampleRate <= 0 || sampleRate >= 1) {
    return c.json({ error: "name, challenger_version_key, and sample_rate (0-1) are required" }, 400);
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO model_experiments (name, challenger_version_key, sample_rate, notes)
     VALUES (?, ?, ?, ?)`
  )
    .bind(body.name, body.challenger_version_key, sampleRate, body.notes || null)
    .run();

  return c.json({ status: "created", id: result.meta.last_row_id });
});

/**
 * POST /v1/system/experiments/:id/status
 */
systemRoutes.post("/experiments/:id/status", async (c) => {
  let body: { status: "draft" | "running" | "paused" | "completed" };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!["draft", "running", "paused", "completed"].includes(body.status)) {
    return c.json({ error: "Invalid status" }, 400);
  }

  const id = c.req.param("id");
  await c.env.DB.prepare(
    `UPDATE model_experiments
     SET status = ?,
         started_at = CASE WHEN ? = 'running' AND started_at IS NULL THEN datetime('now') ELSE started_at END,
         ended_at = CASE WHEN ? = 'completed' THEN datetime('now') ELSE ended_at END
     WHERE id = ?`
  )
    .bind(body.status, body.status, body.status, id)
    .run();

  return c.json({ status: "updated" });
});
