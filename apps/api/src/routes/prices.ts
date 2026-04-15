import { Hono } from "hono";
import type { Env, PriceResponse } from "../types";

export const priceRoutes = new Hono<{ Bindings: Env }>();

// GET /v1/price/:cardId?grade=PSA10&grading_company=PSA
priceRoutes.get("/:cardId", async (c) => {
  const cardId = c.req.param("cardId");
  const grade = c.req.query("grade") || "RAW";
  const gradingCompany = c.req.query("grading_company") || "RAW";

  // Check KV cache first
  const cacheKey = `price:${cardId}:${gradingCompany}:${grade}`;
  const cached = await c.env.PRICE_CACHE.get(cacheKey, "json");
  if (cached) {
    return c.json(cached as PriceResponse);
  }

  // Get latest model prediction
  const prediction = await c.env.DB.prepare(
    `SELECT * FROM model_predictions
     WHERE card_id = ? AND grade = ? AND grading_company = ?
     ORDER BY predicted_at DESC LIMIT 1`
  )
    .bind(cardId, grade, gradingCompany)
    .first();

  // Get recent sales stats
  const salesStats = await c.env.DB.prepare(
    `SELECT
       COUNT(*) as sales_30d,
       MAX(sale_date) as last_sale
     FROM price_observations
     WHERE card_id = ? AND grading_company = ? AND grade = ?
       AND sale_date >= date('now', '-30 days')
       AND is_anomaly = 0`
  )
    .bind(cardId, gradingCompany, grade)
    .first();

  // Get price trend (compare 7d MA to 30d MA)
  const trendData = await c.env.DB.prepare(
    `SELECT
       AVG(CASE WHEN sale_date >= date('now', '-7 days') THEN price_usd END) as ma_7d,
       AVG(CASE WHEN sale_date >= date('now', '-30 days') THEN price_usd END) as ma_30d
     FROM price_observations
     WHERE card_id = ? AND grading_company = ? AND grade = ?
       AND sale_date >= date('now', '-30 days')
       AND is_anomaly = 0`
  )
    .bind(cardId, gradingCompany, grade)
    .first();

  // Get card name
  const card = await c.env.DB.prepare(
    `SELECT name FROM card_catalog WHERE id = ?`
  )
    .bind(cardId)
    .first();

  // Check if we actually have data — COUNT(*) always returns a row, so check the count
  const hasSales = (salesStats?.sales_30d as number) > 0;
  if (!prediction && !hasSales) {
    if (!card) {
      return c.json({ error: "Card not found" }, 404);
    }
    return c.json({ error: "No pricing data available for this card/grade combination" }, 404);
  }

  const ma7d = (trendData?.ma_7d as number) || 0;
  const ma30d = (trendData?.ma_30d as number) || 0;
  const trend =
    ma7d && ma30d
      ? ma7d > ma30d * 1.05
        ? "rising"
        : ma7d < ma30d * 0.95
          ? "falling"
          : "stable"
      : "stable";

  const hasPrediction = !!prediction;
  const fairValue = (prediction?.fair_value as number) || ma30d;

  const response: PriceResponse = {
    card_id: cardId,
    card_name: (card?.name as string) || cardId,
    grade,
    grading_company: gradingCompany,
    price: fairValue,
    lower: (prediction?.p10 as number) || ma30d * 0.8,
    upper: (prediction?.p90 as number) || ma30d * 1.2,
    buy_threshold: (prediction?.buy_threshold as number) || 0,
    sell_threshold: (prediction?.sell_threshold as number) || 0,
    confidence: (prediction?.confidence as "HIGH" | "MEDIUM" | "LOW") || "LOW",
    last_sale: (salesStats?.last_sale as string) || null,
    sales_30d: (salesStats?.sales_30d as number) || 0,
    trend: trend as "rising" | "stable" | "falling",
    updated_at: (prediction?.predicted_at as string) || null,
    has_prediction: hasPrediction,
  };

  // Cache for 5 minutes
  await c.env.PRICE_CACHE.put(cacheKey, JSON.stringify(response), {
    expirationTtl: 300,
  });

  return c.json(response);
});

// GET /v1/price/:cardId/all — all grades for a card
priceRoutes.get("/:cardId/all", async (c) => {
  const cardId = c.req.param("cardId");

  const predictions = await c.env.DB.prepare(
    `SELECT mp.*, cc.name as card_name
     FROM model_predictions mp
     JOIN card_catalog cc ON cc.id = mp.card_id
     WHERE mp.card_id = ?
       AND mp.predicted_at = (
         SELECT MAX(predicted_at) FROM model_predictions
         WHERE card_id = mp.card_id AND grade = mp.grade AND grading_company = mp.grading_company
       )
     ORDER BY mp.grading_company, mp.grade`
  )
    .bind(cardId)
    .all();

  return c.json({ card_id: cardId, grades: predictions.results });
});
