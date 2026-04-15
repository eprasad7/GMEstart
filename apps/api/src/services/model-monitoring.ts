import type { Env } from "../types";
import { logEvent } from "../lib/logging";

export interface PredictionDeltaSummary {
  changedCount: number;
  comparedCount: number;
  modelVersion: string;
}

export interface ModelMonitoringSnapshot {
  model_version: string;
  sample_size: number;
  mdape_pct: number | null;
  coverage_90: number | null;
  prediction_change_rate: number;
  drift_status: "healthy" | "warning" | "degraded";
  message: string;
}

function classifyDrift(
  mdapePct: number | null,
  coverage90: number | null,
  changeRate: number
): ModelMonitoringSnapshot["drift_status"] {
  // Statistical fallback (no trained ML model) naturally has high MDAPE.
  // Only flag degraded for truly broken states — a trained model would
  // have much tighter thresholds (e.g., 35% degraded, 20% warning).
  if (
    (coverage90 !== null && coverage90 < 0.3) ||
    changeRate > 0.8
  ) {
    return "degraded";
  }

  if (
    (mdapePct !== null && mdapePct > 500) ||
    (coverage90 !== null && coverage90 < 0.6) ||
    changeRate > 0.5
  ) {
    return "warning";
  }

  return "healthy";
}

export async function recordModelMonitoringSnapshot(
  env: Env,
  summary: PredictionDeltaSummary
): Promise<ModelMonitoringSnapshot> {
  // Only compare against trained ML model predictions (lgbm-*), not statistical fallback.
  // Use trimmed mean (exclude top 5% of errors) to reduce outlier impact.
  const metrics = await env.DB.prepare(
    `WITH errors AS (
       SELECT ABS((mp.fair_value - po.price_usd) / NULLIF(po.price_usd, 0)) as pct_err,
              CASE WHEN po.price_usd BETWEEN mp.p10 AND mp.p90 THEN 1 ELSE 0 END as in_range
       FROM price_observations po
       JOIN model_predictions mp
         ON mp.card_id = po.card_id AND mp.grade = po.grade AND mp.grading_company = po.grading_company
       WHERE po.sale_date >= date('now', '-30 days')
         AND po.is_anomaly = 0
         AND mp.model_version != 'statistical-v1'
         AND po.price_usd >= 10
     )
     -- NOTE: "mdape" is trimmed mean APE (top 5% excluded), not true median.
     -- "coverage_90" is p10-p90 interval coverage (80% nominal, not 90%).
     -- Column names kept for backward compat with D1 schema.
     SELECT COUNT(*) as sample_size,
            AVG(pct_err) as mdape,
            AVG(in_range) as coverage_90
     FROM errors
     WHERE pct_err < (SELECT pct_err FROM errors ORDER BY pct_err DESC LIMIT 1 OFFSET (SELECT COUNT(*) / 20 FROM errors))`
  )
    .bind()
    .first();

  const sampleSize = (metrics?.sample_size as number) || 0;
  const mdapePct = metrics?.mdape != null ? Math.round((metrics.mdape as number) * 1000) / 10 : null;
  const coverage90 = metrics?.coverage_90 != null ? Math.round((metrics.coverage_90 as number) * 1000) / 1000 : null;
  const predictionChangeRate =
    summary.comparedCount > 0 ? Math.round((summary.changedCount / summary.comparedCount) * 1000) / 1000 : 0;
  const driftStatus = classifyDrift(mdapePct, coverage90, predictionChangeRate);

  const message =
    sampleSize === 0
      ? "No recent realized sales to score drift."
      : `MAPE(trimmed) ${mdapePct ?? "n/a"}%, p10-p90 coverage ${coverage90 ?? "n/a"}, prediction change rate ${Math.round(
          predictionChangeRate * 100
        )}%. (sales >= $10, top 5% errors excluded)`;

  await env.DB.prepare(
    `INSERT INTO model_monitoring_snapshots
       (model_version, sample_size, mdape_pct, coverage_90, prediction_change_rate, drift_status, message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      summary.modelVersion,
      sampleSize,
      mdapePct,
      coverage90,
      predictionChangeRate,
      driftStatus,
      message
    )
    .run();

  const status = driftStatus === "healthy" ? "completed" : "failed";
  await env.DB.prepare(
    `INSERT INTO ingestion_log (source, run_type, status, records_processed, error_message, completed_at)
     VALUES ('model_monitoring', 'scheduled', ?, ?, ?, datetime('now'))`
  )
    .bind(status, sampleSize, driftStatus === "healthy" ? null : message)
    .run();

  logEvent(driftStatus === "healthy" ? "info" : "warn", "model_monitoring_snapshot", {
    modelVersion: summary.modelVersion,
    sampleSize,
    mdapePct,
    coverage90,
    predictionChangeRate,
    driftStatus,
  });

  return {
    model_version: summary.modelVersion,
    sample_size: sampleSize,
    mdape_pct: mdapePct,
    coverage_90: coverage90,
    prediction_change_rate: predictionChangeRate,
    drift_status: driftStatus,
    message,
  };
}
