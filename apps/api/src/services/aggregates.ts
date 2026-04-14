import type { Env } from "../types";

/**
 * Compute daily/weekly/monthly price aggregates.
 * Runs daily at 5am (after anomaly detection at 4am).
 */
export async function computeAggregates(env: Env): Promise<void> {
  // Daily aggregates for yesterday
  await env.DB.prepare(
    `INSERT INTO price_aggregates
       (card_id, grade, grading_company, period, period_start,
        avg_price, median_price, min_price, max_price, sale_count, volume_bucket)
     SELECT
       card_id,
       COALESCE(grade, 'RAW') as grade,
       COALESCE(grading_company, 'RAW') as grading_company,
       'daily' as period,
       date('now', '-1 day') as period_start,
       AVG(price_usd) as avg_price,
       AVG(price_usd) as median_price,
       MIN(price_usd) as min_price,
       MAX(price_usd) as max_price,
       COUNT(*) as sale_count,
       CASE
         WHEN COUNT(*) >= 5 THEN 'high'
         WHEN COUNT(*) >= 2 THEN 'medium'
         ELSE 'low'
       END as volume_bucket
     FROM price_observations
     WHERE sale_date = date('now', '-1 day')
       AND is_anomaly = 0
     GROUP BY card_id, grade, grading_company
     ON CONFLICT(card_id, grade, grading_company, period, period_start) DO UPDATE SET
       avg_price = excluded.avg_price,
       median_price = excluded.median_price,
       min_price = excluded.min_price,
       max_price = excluded.max_price,
       sale_count = excluded.sale_count,
       volume_bucket = excluded.volume_bucket`
  )
    .bind()
    .run();

  // Weekly aggregates (on Mondays)
  if (new Date().getDay() === 1) {
    await env.DB.prepare(
      `INSERT INTO price_aggregates
         (card_id, grade, grading_company, period, period_start,
          avg_price, median_price, min_price, max_price, sale_count, volume_bucket)
       SELECT
         card_id,
         COALESCE(grade, 'RAW'),
         COALESCE(grading_company, 'RAW'),
         'weekly',
         date('now', '-7 days'),
         AVG(price_usd),
         AVG(price_usd),
         MIN(price_usd),
         MAX(price_usd),
         COUNT(*),
         CASE WHEN COUNT(*) >= 15 THEN 'high' WHEN COUNT(*) >= 5 THEN 'medium' ELSE 'low' END
       FROM price_observations
       WHERE sale_date >= date('now', '-7 days') AND is_anomaly = 0
       GROUP BY card_id, grade, grading_company
       ON CONFLICT(card_id, grade, grading_company, period, period_start) DO UPDATE SET
         avg_price = excluded.avg_price, median_price = excluded.median_price,
         min_price = excluded.min_price, max_price = excluded.max_price,
         sale_count = excluded.sale_count, volume_bucket = excluded.volume_bucket`
    )
      .bind()
      .run();
  }

  // Monthly aggregates (on the 1st)
  if (new Date().getDate() === 1) {
    await env.DB.prepare(
      `INSERT INTO price_aggregates
         (card_id, grade, grading_company, period, period_start,
          avg_price, median_price, min_price, max_price, sale_count, volume_bucket)
       SELECT
         card_id,
         COALESCE(grade, 'RAW'),
         COALESCE(grading_company, 'RAW'),
         'monthly',
         date('now', '-1 month'),
         AVG(price_usd),
         AVG(price_usd),
         MIN(price_usd),
         MAX(price_usd),
         COUNT(*),
         CASE WHEN COUNT(*) >= 50 THEN 'high' WHEN COUNT(*) >= 10 THEN 'medium' ELSE 'low' END
       FROM price_observations
       WHERE sale_date >= date('now', '-1 month') AND is_anomaly = 0
       GROUP BY card_id, grade, grading_company
       ON CONFLICT(card_id, grade, grading_company, period, period_start) DO UPDATE SET
         avg_price = excluded.avg_price, median_price = excluded.median_price,
         min_price = excluded.min_price, max_price = excluded.max_price,
         sale_count = excluded.sale_count, volume_bucket = excluded.volume_bucket`
    )
      .bind()
      .run();
  }
}
