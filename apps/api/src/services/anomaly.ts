import type { Env } from "../types";

/**
 * Anomaly detection system.
 * Runs daily at 6am via cron.
 *
 * Detects:
 * 1. Price outliers (statistical, computed from 30-day raw observations)
 * 2. Seller concentration (if seller_id available)
 * 3. Data quality issues (sub-$1 graded cards)
 * 4. Price spikes/crashes (7d vs 30d moving average divergence)
 */
export async function runAnomalyDetection(env: Env): Promise<number> {
  let totalFlagged = 0;

  totalFlagged += await detectPriceOutliers(env);
  totalFlagged += await detectSellerConcentration(env);
  totalFlagged += await detectDataQualityIssues(env);
  totalFlagged += await detectPriceSpikes(env);

  return totalFlagged;
}

/**
 * Statistical price outlier detection.
 * Computes baselines on-the-fly from 30-day raw observations
 * instead of relying on potentially stale monthly aggregates.
 */
async function detectPriceOutliers(env: Env): Promise<number> {
  // Get recent observations alongside live 30-day baselines
  const recentObs = await env.DB.prepare(
    `SELECT
       po.id, po.card_id, po.price_usd, po.grading_company, po.grade,
       baseline.avg_price, baseline.min_price, baseline.max_price, baseline.sale_count
     FROM price_observations po
     INNER JOIN (
       SELECT card_id, COALESCE(grading_company, 'RAW') as gc, COALESCE(grade, 'RAW') as g,
              AVG(price_usd) as avg_price,
              MIN(price_usd) as min_price,
              MAX(price_usd) as max_price,
              COUNT(*) as sale_count
       FROM price_observations
       WHERE sale_date >= date('now', '-30 days')
         AND is_anomaly = 0
       GROUP BY card_id, gc, g
       HAVING sale_count >= 5
     ) baseline
       ON baseline.card_id = po.card_id
       AND baseline.gc = COALESCE(po.grading_company, 'RAW')
       AND baseline.g = COALESCE(po.grade, 'RAW')
     WHERE po.is_anomaly = 0
       AND po.created_at >= datetime('now', '-1 day')`
  )
    .bind()
    .all();

  let flagged = 0;

  for (const obs of recentObs.results) {
    const price = obs.price_usd as number;
    const avgPrice = obs.avg_price as number;
    const minPrice = obs.min_price as number;
    const maxPrice = obs.max_price as number;

    // Flag if price is >3x the observed range from average
    const range = maxPrice - minPrice;
    const lowerBound = avgPrice - 3 * range;
    const upperBound = avgPrice + 3 * range;

    if (price < lowerBound || price > upperBound) {
      await env.DB.prepare(
        `UPDATE price_observations SET is_anomaly = 1, anomaly_reason = ? WHERE id = ?`
      )
        .bind(
          price > upperBound
            ? `Price $${price.toFixed(2)} exceeds upper bound $${upperBound.toFixed(2)} (30d avg: $${avgPrice.toFixed(2)})`
            : `Price $${price.toFixed(2)} below lower bound $${lowerBound.toFixed(2)} (30d avg: $${avgPrice.toFixed(2)})`,
          obs.id
        )
        .run();
      flagged++;
    }
  }

  return flagged;
}

/**
 * Detect sellers with prices consistently above 30-day market average.
 * Only runs if seller_id is populated in the data.
 */
async function detectSellerConcentration(env: Env): Promise<number> {
  // Check if we have any seller_id data at all
  const hasSellerData = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM price_observations
     WHERE seller_id IS NOT NULL AND sale_date >= date('now', '-30 days')
     LIMIT 1`
  )
    .bind()
    .first();

  if (!hasSellerData || (hasSellerData.cnt as number) === 0) {
    return 0; // seller_id not available from feeds — skip
  }

  // Compute seller averages against live 30-day baselines
  const suspectSellers = await env.DB.prepare(
    `SELECT
       po.seller_id,
       COUNT(*) as sale_count,
       AVG(po.price_usd) as seller_avg,
       AVG(baseline.avg_price) as market_avg
     FROM price_observations po
     INNER JOIN (
       SELECT card_id, COALESCE(grading_company, 'RAW') as gc, COALESCE(grade, 'RAW') as g,
              AVG(price_usd) as avg_price
       FROM price_observations
       WHERE sale_date >= date('now', '-30 days') AND is_anomaly = 0
       GROUP BY card_id, gc, g
     ) baseline
       ON baseline.card_id = po.card_id
       AND baseline.gc = COALESCE(po.grading_company, 'RAW')
       AND baseline.g = COALESCE(po.grade, 'RAW')
     WHERE po.seller_id IS NOT NULL
       AND po.sale_date >= date('now', '-30 days')
       AND po.is_anomaly = 0
     GROUP BY po.seller_id
     HAVING sale_count >= 3 AND seller_avg > market_avg * 1.5`
  )
    .bind()
    .all();

  let flagged = 0;

  for (const seller of suspectSellers.results) {
    const pctAbove = Math.round(
      (((seller.seller_avg as number) / (seller.market_avg as number)) - 1) * 100
    );
    const result = await env.DB.prepare(
      `UPDATE price_observations
       SET is_anomaly = 1, anomaly_reason = 'Seller concentration — avg ' || ? || '% above 30d market'
       WHERE seller_id = ? AND sale_date >= date('now', '-30 days') AND is_anomaly = 0`
    )
      .bind(pctAbove, seller.seller_id)
      .run();

    flagged += result.meta.changes;
  }

  return flagged;
}

/**
 * Detect data quality issues.
 */
async function detectDataQualityIssues(env: Env): Promise<number> {
  const result = await env.DB.prepare(
    `UPDATE price_observations
     SET is_anomaly = 1, anomaly_reason = 'Suspiciously low price for graded card'
     WHERE is_anomaly = 0
       AND grading_company IN ('PSA', 'BGS', 'CGC', 'SGC')
       AND grade_numeric >= 8
       AND price_usd < 1.00
       AND created_at >= datetime('now', '-1 day')`
  )
    .bind()
    .run();

  return result.meta.changes;
}

/**
 * Detect sudden price spikes/crashes and create alerts.
 * Uses live computed 7d vs 30d moving averages.
 */
async function detectPriceSpikes(env: Env): Promise<number> {
  const spikes = await env.DB.prepare(
    `SELECT
       card_id, grading_company, grade,
       AVG(CASE WHEN sale_date >= date('now', '-7 days') THEN price_usd END) as avg_7d,
       AVG(CASE WHEN sale_date >= date('now', '-30 days') THEN price_usd END) as avg_30d,
       COUNT(CASE WHEN sale_date >= date('now', '-7 days') THEN 1 END) as count_7d
     FROM price_observations
     WHERE sale_date >= date('now', '-30 days')
       AND is_anomaly = 0
     GROUP BY card_id, grading_company, grade
     HAVING count_7d >= 2 AND avg_30d > 0
       AND ABS(avg_7d - avg_30d) / avg_30d > 0.30`
  )
    .bind()
    .all();

  let alertCount = 0;

  for (const spike of spikes.results) {
    const avg7d = spike.avg_7d as number;
    const avg30d = spike.avg_30d as number;
    const changePct = ((avg7d - avg30d) / avg30d) * 100;
    const alertType = changePct > 0 ? "price_spike" : "price_crash";

    const existing = await env.DB.prepare(
      `SELECT id FROM price_alerts
       WHERE card_id = ? AND alert_type = ? AND is_active = 1
         AND created_at >= datetime('now', '-1 day')`
    )
      .bind(spike.card_id, alertType)
      .first();

    if (!existing) {
      await env.DB.prepare(
        `INSERT INTO price_alerts (card_id, alert_type, magnitude, trigger_source, message)
         VALUES (?, ?, ?, 'anomaly_detection', ?)`
      )
        .bind(
          spike.card_id,
          alertType,
          Math.round(changePct * 10) / 10,
          `${alertType === "price_spike" ? "Price spike" : "Price crash"}: ${changePct > 0 ? "+" : ""}${changePct.toFixed(1)}% (7d avg $${avg7d.toFixed(2)} vs 30d avg $${avg30d.toFixed(2)})`
        )
        .run();
      alertCount++;
    }
  }

  return alertCount;
}
