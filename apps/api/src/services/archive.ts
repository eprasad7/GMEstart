import type { Env } from "../types";
import { logEvent } from "../lib/logging";

const DEFAULT_RETENTION_DAYS = 180;
const DEFAULT_BATCH_SIZE = 500;
const D1_DELETE_BATCH = 90;

interface ArchiveRow {
  id: number;
  card_id: string;
  source: string;
  price_usd: number;
  sale_date: string;
  grade: string | null;
  grading_company: string | null;
  grade_numeric: number | null;
  sale_type: string | null;
  listing_url: string | null;
  seller_id: string | null;
  bid_count: number | null;
  is_anomaly: number;
  anomaly_reason: string | null;
  created_at: string;
}

export async function archiveOldObservations(
  env: Env,
  retentionDays = DEFAULT_RETENTION_DAYS,
  batchSize = DEFAULT_BATCH_SIZE
): Promise<{ archived: number; archive_key: string | null }> {
  const startedAt = new Date().toISOString();
  const run = await env.DB.prepare(
    `INSERT INTO data_archive_runs (archive_type, status, retention_days, started_at)
     VALUES ('price_observations', 'started', ?, datetime('now'))
     RETURNING id`
  )
    .bind(retentionDays)
    .first();

  const runId = (run?.id as number) || 0;

  try {
    const rows = await env.DB.prepare(
      `SELECT *
       FROM price_observations
       WHERE sale_date < date('now', '-' || ? || ' days')
       ORDER BY sale_date ASC
       LIMIT ?`
    )
      .bind(retentionDays, batchSize)
      .all();

    const archivedRows = rows.results as unknown as ArchiveRow[];

    if (!archivedRows.length) {
      await env.DB.prepare(
        `UPDATE data_archive_runs
         SET status = 'completed', rows_archived = 0, completed_at = datetime('now')
         WHERE id = ?`
      )
        .bind(runId)
        .run();
      return { archived: 0, archive_key: null };
    }

    const archiveKey = `archive/price_observations/${startedAt.replace(/[:.]/g, "-")}.json`;
    await env.DATA_ARCHIVE.put(archiveKey, JSON.stringify(archivedRows, null, 2), {
      httpMetadata: { contentType: "application/json" },
    });

    const deleteStmt = env.DB.prepare(`DELETE FROM price_observations WHERE id = ?`);
    for (let i = 0; i < archivedRows.length; i += D1_DELETE_BATCH) {
      const chunk = archivedRows.slice(i, i + D1_DELETE_BATCH).map((row) => deleteStmt.bind(row.id));
      await env.DB.batch(chunk);
    }

    await env.DB.prepare(
      `UPDATE data_archive_runs
       SET status = 'completed', rows_archived = ?, archive_key = ?, completed_at = datetime('now')
       WHERE id = ?`
    )
      .bind(archivedRows.length, archiveKey, runId)
      .run();

    logEvent("info", "price_observations_archived", {
      archived: archivedRows.length,
      archiveKey,
      retentionDays,
    });

    return { archived: archivedRows.length, archive_key: archiveKey };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(
      `UPDATE data_archive_runs
       SET status = 'failed', error_message = ?, completed_at = datetime('now')
       WHERE id = ?`
    )
      .bind(message, runId)
      .run();
    logEvent("error", "price_observations_archive_failed", { message, retentionDays });
    throw error;
  }
}
