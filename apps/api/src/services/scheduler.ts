import type { Env } from "../types";
import { ingestSoldComps } from "./ingestion/soldcomps";
import { ingestPriceCharting } from "./ingestion/pricecharting";
import { scrapeRedditSentiment } from "./ingestion/reddit-scraper";
import { ingestPopulationReports } from "./ingestion/population";
import { computeFeatures } from "./features";
import { runAnomalyDetection } from "./anomaly";
import { computeAggregates } from "./aggregates";
import { batchPredict } from "./inference";
import { rollUpSentiment } from "./sentiment-rollup";
import { archiveOldObservations } from "./archive";

// Cron Trigger handler — routes to the right ingestion job.
//
// Pipeline ordering (critical — anomaly must run before features/predictions):
//   every 15 min  → SoldComps/eBay ingestion
//   every 5 min   → Reddit sentiment ingestion
//   hourly        → Sentiment rollup (24h→7d→30d)
//   0 2 daily     → PriceCharting
//   0 3 daily     → PSA population reports
//   0 4 daily     → Anomaly detection (MUST run before features)
//   0 5 daily     → Aggregates + feature computation
//   0 6 daily     → Generate prices (batchPredict → model_predictions)
//   0 1 Sunday    → Archive old observations to R2
export async function handleScheduled(event: ScheduledEvent, env: Env): Promise<void> {
  const cron = event.cron;

  // Map cron → source name for consistent logging
  const cronSourceMap: Record<string, string> = {
    "*/15 * * * *": "soldcomps",
    "*/5 * * * *": "reddit",
    "0 * * * *": "sentiment_rollup",
    "0 2 * * *": "pricecharting",
    "0 3 * * *": "population",
    "0 4 * * *": "anomaly",
    "0 5 * * *": "features",
    "0 6 * * *": "predictions",
    "0 1 * * 0": "archive",
  };

  const source = cronSourceMap[cron];
  if (!source) return;

  const logId = await logStart(env, source);

  try {
    let count = 0;

    switch (cron) {
      case "*/15 * * * *":
        count = await ingestSoldComps(env);
        break;

      case "*/5 * * * *":
        count = await scrapeRedditSentiment(env);
        break;

      case "0 * * * *":
        count = await rollUpSentiment(env);
        break;

      case "0 2 * * *":
        count = await ingestPriceCharting(env);
        break;

      case "0 3 * * *":
        count = await ingestPopulationReports(env);
        break;

      case "0 4 * * *":
        // Anomaly detection runs BEFORE features/predictions
        // so flagged outliers are excluded from downstream computation
        count = await runAnomalyDetection(env);
        break;

      case "0 5 * * *":
        // Aggregates + features (after anomaly detection)
        await computeAggregates(env);
        count = await computeFeatures(env);
        break;

      case "0 6 * * *":
        // Predictions (after features are computed)
        count = await batchPredict(env);
        break;

      case "0 1 * * 0":
        count = (await archiveOldObservations(env)).archived;
        break;
    }

    await logComplete(env, logId, count);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await logError(env, logId, error);
    console.error(`Scheduled job ${source} (${cron}) failed:`, error);
  }
}

// ─── Logging helpers (use subquery to work on D1/SQLite) ───

async function logStart(env: Env, source: string): Promise<number> {
  const result = await env.DB.prepare(
    `INSERT INTO ingestion_log (source, run_type, status) VALUES (?, 'scheduled', 'started') RETURNING id`
  )
    .bind(source)
    .first();
  return (result?.id as number) || 0;
}

async function logComplete(env: Env, logId: number, count: number): Promise<void> {
  if (!logId) return;
  await env.DB.prepare(
    `UPDATE ingestion_log SET status = 'completed', records_processed = ?, completed_at = datetime('now')
     WHERE id = ?`
  )
    .bind(count, logId)
    .run();
}

async function logError(env: Env, logId: number, error: string): Promise<void> {
  if (!logId) return;
  await env.DB.prepare(
    `UPDATE ingestion_log SET status = 'failed', error_message = ?, completed_at = datetime('now')
     WHERE id = ?`
  )
    .bind(error, logId)
    .run();
}
