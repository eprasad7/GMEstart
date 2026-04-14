import type { Env } from "../types";
import { ingestSoldComps } from "./ingestion/soldcomps";
import { ingestPriceCharting } from "./ingestion/pricecharting";
import { ingestRedditSentiment } from "./ingestion/reddit";
import { ingestPopulationReports } from "./ingestion/population";
import { computeFeatures } from "./features";
import { runAnomalyDetection } from "./anomaly";
import { computeAggregates } from "./aggregates";
import { batchPredict } from "./inference";
import { rollUpSentiment } from "./sentiment-rollup";

/**
 * Cron Trigger handler — routes to the right ingestion job
 * based on the cron schedule that fired.
 *
 * Cron expressions from wrangler.jsonc:
 *   "* /15 * * * *"  → SoldComps/eBay ingestion
 *   "* /5 * * * *"   → Reddit sentiment
 *   "0 2 * * *"      → PriceCharting daily
 *   "0 3 * * *"      → PSA population reports
 *   "0 4 * * *"      → Feature computation + aggregates
 *   "0 5 * * *"      → Generate prices (batchPredict → model_predictions)
 *   "0 6 * * *"      → Anomaly detection
 *   "0 * * * *"       → Sentiment rollup (hourly 24h→7d→30d)
 */
export async function handleScheduled(event: ScheduledEvent, env: Env): Promise<void> {
  const cron = event.cron;

  const logStart = async (source: string, runType: string) => {
    await env.DB.prepare(
      `INSERT INTO ingestion_log (source, run_type, status) VALUES (?, ?, 'started')`
    )
      .bind(source, runType)
      .run();
  };

  const logComplete = async (source: string, count: number) => {
    await env.DB.prepare(
      `UPDATE ingestion_log SET status = 'completed', records_processed = ?, completed_at = datetime('now')
       WHERE source = ? AND status = 'started'
       ORDER BY started_at DESC LIMIT 1`
    )
      .bind(count, source)
      .run();
  };

  const logError = async (source: string, error: string) => {
    await env.DB.prepare(
      `UPDATE ingestion_log SET status = 'failed', error_message = ?, completed_at = datetime('now')
       WHERE source = ? AND status = 'started'
       ORDER BY started_at DESC LIMIT 1`
    )
      .bind(error, source)
      .run();
  };

  try {
    switch (cron) {
      case "*/15 * * * *": {
        await logStart("soldcomps", "scheduled");
        const count = await ingestSoldComps(env);
        await logComplete("soldcomps", count);
        break;
      }

      case "*/5 * * * *": {
        await logStart("reddit", "scheduled");
        const count = await ingestRedditSentiment(env);
        await logComplete("reddit", count);
        break;
      }

      case "0 2 * * *": {
        await logStart("pricecharting", "daily");
        const count = await ingestPriceCharting(env);
        await logComplete("pricecharting", count);
        break;
      }

      case "0 3 * * *": {
        await logStart("population", "daily");
        const count = await ingestPopulationReports(env);
        await logComplete("population", count);
        break;
      }

      case "0 4 * * *": {
        await logStart("features", "daily");
        await computeAggregates(env);
        const count = await computeFeatures(env);
        await logComplete("features", count);
        break;
      }

      case "0 5 * * *": {
        await logStart("predictions", "daily");
        const count = await batchPredict(env);
        await logComplete("predictions", count);
        break;
      }

      case "0 6 * * *": {
        await logStart("anomaly", "daily");
        const count = await runAnomalyDetection(env);
        await logComplete("anomaly", count);
        break;
      }

      case "0 * * * *": {
        // Hourly sentiment rollup — aggregate 24h scores into 7d and 30d
        await logStart("sentiment_rollup", "hourly");
        const count = await rollUpSentiment(env);
        await logComplete("sentiment_rollup", count);
        break;
      }
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await logError(cron, error);
    console.error(`Scheduled job ${cron} failed:`, error);
  }
}
