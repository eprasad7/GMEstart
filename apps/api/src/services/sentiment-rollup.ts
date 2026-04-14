import type { Env } from "../types";

/**
 * Sentiment rollup service.
 * Runs hourly via "0 * * * *" cron.
 *
 * Aggregates raw sentiment observations (sentiment_raw) into
 * the sentiment_scores table for 24h, 7d, and 30d periods.
 *
 * This fixes the gap where the queue consumer only inserts raw observations
 * but the feature pipeline and API read rolled-up period scores.
 */
export async function rollUpSentiment(env: Env): Promise<number> {
  const today = new Date().toISOString().split("T")[0];
  let count = 0;

  // Get all card+source combinations with recent raw data
  const activeCards = await env.DB.prepare(
    `SELECT DISTINCT card_id, source FROM sentiment_raw
     WHERE observed_at >= datetime('now', '-30 days')`
  )
    .bind()
    .all();

  for (const row of activeCards.results) {
    const cardId = row.card_id as string;
    const source = row.source as string;

    // Compute rollups for each period
    for (const period of ["24h", "7d", "30d"] as const) {
      const interval = period === "24h" ? "-1 day" : period === "7d" ? "-7 days" : "-30 days";

      const agg = await env.DB.prepare(
        `SELECT
           AVG(score) as avg_score,
           COUNT(*) as mention_count,
           SUM(score * engagement) / NULLIF(SUM(engagement), 0) as weighted_score
         FROM sentiment_raw
         WHERE card_id = ? AND source = ?
           AND observed_at >= datetime('now', ?)`
      )
        .bind(cardId, source, interval)
        .first();

      if (!agg || (agg.mention_count as number) === 0) continue;

      // Use engagement-weighted score if available, else plain average
      const score = (agg.weighted_score as number) ?? (agg.avg_score as number);
      const mentionCount = agg.mention_count as number;

      // Get top posts by engagement for this period
      const topPosts = await env.DB.prepare(
        `SELECT post_url FROM sentiment_raw
         WHERE card_id = ? AND source = ?
           AND observed_at >= datetime('now', ?)
           AND post_url IS NOT NULL
         ORDER BY engagement DESC
         LIMIT 5`
      )
        .bind(cardId, source, interval)
        .all();

      const topPostUrls = topPosts.results.map((r) => r.post_url as string);

      // Upsert with stable rollup_date key
      await env.DB.prepare(
        `INSERT INTO sentiment_scores
           (card_id, source, score, mention_count, period, top_posts, rollup_date, computed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(card_id, source, period, rollup_date) DO UPDATE SET
           score = excluded.score,
           mention_count = excluded.mention_count,
           top_posts = excluded.top_posts,
           computed_at = datetime('now')`
      )
        .bind(
          cardId,
          source,
          Math.round(score * 1000) / 1000,
          mentionCount,
          period,
          JSON.stringify(topPostUrls),
          today
        )
        .run();

      count++;
    }
  }

  // Prune raw observations older than 35 days (keep a buffer past 30d rollup window)
  await env.DB.prepare(
    `DELETE FROM sentiment_raw WHERE observed_at < datetime('now', '-35 days')`
  )
    .bind()
    .run();

  return count;
}
