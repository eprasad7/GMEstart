import { Hono } from "hono";
import type { Env } from "../types";

export const marketRoutes = new Hono<{ Bindings: Env }>();

// GET /v1/market/index
marketRoutes.get("/index", async (c) => {
  // Check cache
  const cached = await c.env.PRICE_CACHE.get("market:index", "json");
  if (cached) return c.json(cached);

  // Compute market indices by category
  // Compute per-category indexes and trends
  const [pokemonData, sportsData] = await Promise.all([
    computeCategoryData(c.env.DB, "pokemon"),
    computeCategoryData(c.env.DB, "sports_baseball"),
  ]);

  // Volatility (coefficient of variation of daily averages)
  const dailyPrices = await c.env.DB.prepare(
    `SELECT sale_date, AVG(price_usd) as avg_price
     FROM price_observations
     WHERE sale_date >= date('now', '-30 days') AND is_anomaly = 0
     GROUP BY sale_date
     ORDER BY sale_date`
  )
    .bind()
    .all();

  const prices = dailyPrices.results.map((r) => r.avg_price as number);
  const mean = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  const variance =
    prices.length > 0
      ? prices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / prices.length
      : 0;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  const volatility = cv > 0.15 ? "high" : cv > 0.08 ? "moderate" : "low";

  const response = {
    pokemon_index: pokemonData.index,
    pokemon_trend_30d: pokemonData.trend,
    sports_index: sportsData.index,
    sports_trend_30d: sportsData.trend,
    volatility,
    updated_at: new Date().toISOString(),
  };

  // Cache for 15 minutes
  await c.env.PRICE_CACHE.put("market:index", JSON.stringify(response), {
    expirationTtl: 900,
  });

  return c.json(response);
});

// GET /v1/market/movers — biggest price movers
marketRoutes.get("/movers", async (c) => {
  const direction = c.req.query("direction") || "up"; // up or down
  const days = parseInt(c.req.query("days") || "7");
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 50);

  const orderDir = direction === "down" ? "ASC" : "DESC";

  const movers = await c.env.DB.prepare(
    `SELECT
       po.card_id,
       cc.name,
       cc.category,
       po.grading_company,
       po.grade,
       AVG(CASE WHEN po.sale_date >= date('now', '-' || ? || ' days') THEN po.price_usd END) as recent_avg,
       AVG(CASE WHEN po.sale_date < date('now', '-' || ? || ' days') AND po.sale_date >= date('now', '-' || (? * 2) || ' days') THEN po.price_usd END) as prior_avg
     FROM price_observations po
     JOIN card_catalog cc ON cc.id = po.card_id
     WHERE po.sale_date >= date('now', '-' || (? * 2) || ' days')
       AND po.is_anomaly = 0
     GROUP BY po.card_id, po.grading_company, po.grade
     HAVING recent_avg IS NOT NULL AND prior_avg IS NOT NULL AND prior_avg > 0
     ORDER BY (recent_avg - prior_avg) / prior_avg ${orderDir}
     LIMIT ?`
  )
    .bind(days, days, days, days, limit)
    .all();

  const results = movers.results.map((m) => ({
    ...m,
    change_pct:
      ((m.recent_avg as number) - (m.prior_avg as number)) /
      (m.prior_avg as number) *
      100,
  }));

  return c.json({ direction, days, movers: results });
});

// GET /v1/market/stale — cards with stale or missing predictions
marketRoutes.get("/stale", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 50);
  const staleHours = parseInt(c.req.query("stale_hours") || "36");

  const results = await c.env.DB.prepare(
    `SELECT
       cc.id as card_id,
       cc.name,
       cc.category,
       mp.predicted_at,
       mp.confidence,
       mp.fair_value,
       CASE
         WHEN mp.predicted_at IS NULL THEN 'no_prediction'
         WHEN mp.predicted_at < datetime('now', '-' || ? || ' hours') THEN 'stale'
         ELSE 'ok'
       END as staleness
     FROM card_catalog cc
     LEFT JOIN model_predictions mp ON mp.card_id = cc.id
       AND mp.predicted_at = (
         SELECT MAX(predicted_at) FROM model_predictions
         WHERE card_id = cc.id
       )
     WHERE mp.predicted_at IS NULL
        OR mp.predicted_at < datetime('now', '-' || ? || ' hours')
     ORDER BY
       CASE WHEN mp.predicted_at IS NULL THEN 0 ELSE 1 END,
       mp.predicted_at ASC
     LIMIT ?`
  )
    .bind(staleHours, staleHours, limit)
    .all();

  return c.json({
    stale_hours: staleHours,
    cards: results.results,
  });
});

/**
 * Compute per-category market index and 30-day trend.
 * Index = weighted average of median card prices (normalized, not scaled by catalog size).
 * Trend = 7-day average vs prior 23-day average.
 */
async function computeCategoryData(
  db: D1Database,
  category: string
): Promise<{ index: number; trend: string }> {
  const result = await db
    .prepare(
      `SELECT
         AVG(price_usd) as avg_price,
         AVG(CASE WHEN sale_date >= date('now', '-7 days') THEN price_usd END) as recent,
         AVG(CASE WHEN sale_date < date('now', '-7 days') THEN price_usd END) as older
       FROM price_observations
       WHERE card_id IN (SELECT id FROM card_catalog WHERE category = ?)
         AND sale_date >= date('now', '-30 days')
         AND is_anomaly = 0`
    )
    .bind(category)
    .first();

  const index = Math.round(((result?.avg_price as number) || 0) * 100);
  const recent = (result?.recent as number) || 0;
  const older = (result?.older as number) || 0;
  const trendPct = older > 0 ? ((recent - older) / older) * 100 : 0;
  const trend = `${trendPct >= 0 ? "+" : ""}${trendPct.toFixed(1)}%`;

  return { index, trend };
}
