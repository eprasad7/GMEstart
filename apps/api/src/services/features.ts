import type { Env } from "../types";

/**
 * Compute ML features for all active cards.
 * Runs daily at 4am after aggregates are computed.
 *
 * Features match the spec:
 * - Grade & population features
 * - Demand signals (velocity, momentum, inventory)
 * - Sentiment features
 * - Seasonality features
 */
export async function computeFeatures(env: Env): Promise<number> {
  // Get all active cards (have at least 1 price observation)
  const cards = await env.DB.prepare(
    `SELECT DISTINCT po.card_id, po.grading_company, po.grade
     FROM price_observations po
     WHERE po.sale_date >= date('now', '-365 days')
       AND po.is_anomaly = 0
       AND po.grade IS NOT NULL
     GROUP BY po.card_id, po.grading_company, po.grade`
  )
    .bind()
    .all();

  let count = 0;

  for (const row of cards.results) {
    const cardId = row.card_id as string;
    const gradingCompany = row.grading_company as string;
    const grade = row.grade as string;

    try {
      const features = await computeCardFeatures(env, cardId, gradingCompany, grade);
      const serializedFeatures = JSON.stringify(features);

      // Keep the hot serving snapshot in feature_store.
      await env.DB.prepare(
        `INSERT INTO feature_store (card_id, grade, grading_company, features)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(card_id, grade, grading_company) DO UPDATE SET
           features = excluded.features,
           computed_at = datetime('now')`
      )
        .bind(cardId, grade, gradingCompany, serializedFeatures)
        .run();

      // Append one snapshot per day for point-in-time training/export.
      await env.DB.prepare(
        `INSERT INTO feature_store_history (card_id, grade, grading_company, snapshot_date, features, computed_at)
         VALUES (?, ?, ?, date('now'), ?, datetime('now'))
         ON CONFLICT(card_id, grade, grading_company, snapshot_date) DO UPDATE SET
           features = excluded.features,
           computed_at = excluded.computed_at`
      )
        .bind(cardId, grade, gradingCompany, serializedFeatures)
        .run();

      count++;
    } catch (err) {
      console.error(`Feature computation failed for ${cardId}:`, err);
    }
  }

  return count;
}

interface CardFeatures {
  // Grade & population
  grade_numeric: number | null;
  grading_company: string;
  is_gem_mint: boolean;
  is_perfect_10: boolean;
  pop_at_grade: number;
  pop_higher: number;
  pop_ratio: number;
  is_pop_1: boolean;
  pop_growth_rate_90d: number;

  // Demand signals
  sales_count_7d: number;
  sales_count_30d: number;
  sales_count_90d: number;
  velocity_trend: number;
  price_momentum: number;
  avg_price_7d: number;
  avg_price_30d: number;
  avg_price_90d: number;
  price_volatility_30d: number;

  // Sentiment
  social_sentiment_score: number;
  social_mention_count_7d: number;
  social_mention_trend: number;

  // GameStop internal data
  internal_trade_in_count: number;
  internal_avg_trade_in_price: number;
  internal_inventory_units: number;
  internal_store_views: number;
  internal_foot_traffic_index: number;

  // Seasonality
  month_sin: number;
  month_cos: number;
  day_of_week: number;
  is_holiday_season: boolean;
  is_tax_refund_season: boolean;

  // Volume classification
  volume_bucket: "high" | "medium" | "low";
}

async function computeCardFeatures(
  env: Env,
  cardId: string,
  gradingCompany: string,
  grade: string
): Promise<CardFeatures> {
  const gradeNumeric = grade === "RAW" ? null : parseFloat(grade);

  // Parallel queries for all feature components
  const [salesStats, popData, sentimentData, priceHistory, popGrowth, sentimentTrend, internalMetrics] = await Promise.all([
    // Sales velocity at different windows
    env.DB.prepare(
      `SELECT
         COUNT(CASE WHEN sale_date >= date('now', '-7 days') THEN 1 END) as sales_7d,
         COUNT(CASE WHEN sale_date >= date('now', '-30 days') THEN 1 END) as sales_30d,
         COUNT(CASE WHEN sale_date >= date('now', '-90 days') THEN 1 END) as sales_90d,
         AVG(CASE WHEN sale_date >= date('now', '-7 days') THEN price_usd END) as avg_7d,
         AVG(CASE WHEN sale_date >= date('now', '-30 days') THEN price_usd END) as avg_30d,
         AVG(CASE WHEN sale_date >= date('now', '-90 days') THEN price_usd END) as avg_90d
       FROM price_observations
       WHERE card_id = ? AND grading_company = ? AND grade = ?
         AND is_anomaly = 0`
    )
      .bind(cardId, gradingCompany, grade)
      .first(),

    // Population data
    env.DB.prepare(
      `SELECT population, pop_higher, total_population
       FROM population_reports
       WHERE card_id = ? AND grading_company = ? AND grade = ?
       ORDER BY snapshot_date DESC LIMIT 1`
    )
      .bind(cardId, gradingCompany, grade)
      .first(),

    // Sentiment (from hourly rollup) — aggregate across sources
    env.DB.prepare(
      `SELECT
         AVG(score) as score,
         SUM(mention_count) as mention_count
       FROM sentiment_scores
       WHERE card_id = ? AND period = '7d'
         AND rollup_date = (SELECT MAX(rollup_date) FROM sentiment_scores WHERE card_id = ? AND period = '7d')`
    )
      .bind(cardId, cardId)
      .first(),

    // Price history for volatility
    env.DB.prepare(
      `SELECT price_usd FROM price_observations
       WHERE card_id = ? AND grading_company = ? AND grade = ?
         AND sale_date >= date('now', '-30 days')
         AND is_anomaly = 0
       ORDER BY sale_date DESC`
    )
      .bind(cardId, gradingCompany, grade)
      .all(),

    // Pop growth: compare current population to 90 days ago
    env.DB.prepare(
      `SELECT
         (SELECT population FROM population_reports
          WHERE card_id = ? AND grading_company = ? AND grade = ?
          ORDER BY snapshot_date DESC LIMIT 1) as pop_now,
         (SELECT population FROM population_reports
          WHERE card_id = ? AND grading_company = ? AND grade = ?
            AND snapshot_date <= date('now', '-90 days')
          ORDER BY snapshot_date DESC LIMIT 1) as pop_90d_ago`
    )
      .bind(cardId, gradingCompany, grade, cardId, gradingCompany, grade)
      .first(),

    // Sentiment trend: compare 7d to 30d mention counts (latest rollup only)
    env.DB.prepare(
      `SELECT
         (SELECT SUM(mention_count) FROM sentiment_scores
          WHERE card_id = ? AND period = '7d'
            AND rollup_date = (SELECT MAX(rollup_date) FROM sentiment_scores WHERE card_id = ? AND period = '7d')
         ) as mentions_7d,
         (SELECT SUM(mention_count) FROM sentiment_scores
          WHERE card_id = ? AND period = '30d'
            AND rollup_date = (SELECT MAX(rollup_date) FROM sentiment_scores WHERE card_id = ? AND period = '30d')
         ) as mentions_30d`
    )
      .bind(cardId, cardId, cardId, cardId)
      .first(),

    env.DB.prepare(
      `SELECT trade_in_count, avg_trade_in_price, inventory_units, store_views, foot_traffic_index
       FROM gamestop_internal_metrics
       WHERE card_id = ?
       ORDER BY snapshot_date DESC LIMIT 1`
    )
      .bind(cardId)
      .first(),
  ]);

  // Compute derived features
  const sales7d = (salesStats?.sales_7d as number) || 0;
  const sales30d = (salesStats?.sales_30d as number) || 0;
  const sales90d = (salesStats?.sales_90d as number) || 0;
  const avg7d = (salesStats?.avg_7d as number) || 0;
  const avg30d = (salesStats?.avg_30d as number) || 0;

  // Velocity trend: 7d rate / 30d rate (normalized)
  const rate7d = sales7d / 7;
  const rate30d = sales30d / 30;
  const velocityTrend = rate30d > 0 ? rate7d / rate30d : 0;

  // Price momentum: 7d MA / 30d MA
  const priceMomentum = avg30d > 0 ? avg7d / avg30d : 1;

  // Price volatility (coefficient of variation)
  const prices = priceHistory.results.map((r) => r.price_usd as number);
  const mean = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  const variance =
    prices.length > 1
      ? prices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / (prices.length - 1)
      : 0;
  const volatility = mean > 0 ? Math.sqrt(variance) / mean : 0;

  // Population features
  const pop = (popData?.population as number) || 0;
  const popHigher = (popData?.pop_higher as number) || 0;
  const totalPop = (popData?.total_population as number) || 1;

  // Seasonality
  const now = new Date();
  const month = now.getMonth(); // 0-indexed
  const monthRad = (2 * Math.PI * month) / 12;

  // Volume bucket classification
  const volumeBucket: "high" | "medium" | "low" =
    sales90d >= 50 ? "high" : sales90d >= 10 ? "medium" : "low";

  return {
    grade_numeric: gradeNumeric,
    grading_company: gradingCompany,
    is_gem_mint: (gradeNumeric || 0) >= 9.5,
    is_perfect_10: (gradeNumeric || 0) >= 10,
    pop_at_grade: pop,
    pop_higher: popHigher,
    pop_ratio: totalPop > 0 ? pop / totalPop : 0,
    is_pop_1: pop === 1,
    pop_growth_rate_90d: (() => {
      const popNow = (popGrowth?.pop_now as number) || 0;
      const pop90d = (popGrowth?.pop_90d_ago as number) || 0;
      return pop90d > 0 ? Math.round(((popNow - pop90d) / pop90d) * 100) / 100 : 0;
    })(),

    sales_count_7d: sales7d,
    sales_count_30d: sales30d,
    sales_count_90d: sales90d,
    velocity_trend: Math.round(velocityTrend * 100) / 100,
    price_momentum: Math.round(priceMomentum * 100) / 100,
    avg_price_7d: Math.round(avg7d * 100) / 100,
    avg_price_30d: Math.round(avg30d * 100) / 100,
    avg_price_90d: Math.round(((salesStats?.avg_90d as number) || 0) * 100) / 100,
    price_volatility_30d: Math.round(volatility * 100) / 100,

    social_sentiment_score: (sentimentData?.score as number) || 0,
    social_mention_count_7d: (sentimentData?.mention_count as number) || 0,
    social_mention_trend: (() => {
      const m7d = (sentimentTrend?.mentions_7d as number) || 0;
      const m30d = (sentimentTrend?.mentions_30d as number) || 0;
      // Normalize: 7d mentions / (30d mentions / 4.3) — >1 means spiking
      const normalized30d = m30d / 4.3;
      return normalized30d > 0 ? Math.round((m7d / normalized30d) * 100) / 100 : 0;
    })(),
    internal_trade_in_count: (internalMetrics?.trade_in_count as number) || 0,
    internal_avg_trade_in_price: Math.round((((internalMetrics?.avg_trade_in_price as number) || 0) * 100)) / 100,
    internal_inventory_units: (internalMetrics?.inventory_units as number) || 0,
    internal_store_views: (internalMetrics?.store_views as number) || 0,
    internal_foot_traffic_index: Math.round((((internalMetrics?.foot_traffic_index as number) || 0) * 100)) / 100,

    month_sin: Math.round(Math.sin(monthRad) * 1000) / 1000,
    month_cos: Math.round(Math.cos(monthRad) * 1000) / 1000,
    day_of_week: now.getDay(),
    is_holiday_season: month === 10 || month === 11, // Nov-Dec
    is_tax_refund_season: month >= 1 && month <= 3, // Feb-Apr

    volume_bucket: volumeBucket,
  };
}
