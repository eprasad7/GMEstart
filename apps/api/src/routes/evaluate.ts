import { Hono } from "hono";
import type { Env, EvaluateRequest, EvaluateResponse } from "../types";

export const evaluateRoutes = new Hono<{ Bindings: Env }>();

// Retail economics constants (Section 3.5 of spec)
const MARKETPLACE_FEE_PCT = 0.13; // eBay ~13%
const SHIPPING_COST = 5.0;        // Average shipping + handling
const RETURN_RATE = 0.03;         // ~3% return/fraud rate
const REQUIRED_MARGIN = 0.20;     // 20% minimum gross margin

/**
 * Compute Net Realizable Value — what GameStop actually nets after a sale.
 */
function computeNrv(fairValue: number): number {
  const gross = fairValue * (1 - MARKETPLACE_FEE_PCT);
  const netAfterReturns = gross * (1 - RETURN_RATE);
  return netAfterReturns - SHIPPING_COST;
}

// POST /v1/evaluate — evaluate a card at an offered price
evaluateRoutes.post("/", async (c) => {
  const body = await c.req.json<EvaluateRequest>();
  const { card_id, offered_price, grade = "RAW", grading_company = "RAW" } = body;

  if (!card_id || offered_price == null) {
    return c.json({ error: "card_id and offered_price are required" }, 400);
  }

  // Get latest prediction
  const prediction = await c.env.DB.prepare(
    `SELECT * FROM model_predictions
     WHERE card_id = ? AND grade = ? AND grading_company = ?
     ORDER BY predicted_at DESC LIMIT 1`
  )
    .bind(card_id, grade, grading_company)
    .first();

  if (!prediction) {
    // Fallback to recent sales average
    const recentSales = await c.env.DB.prepare(
      `SELECT AVG(price_usd) as avg_price, COUNT(*) as count
       FROM price_observations
       WHERE card_id = ? AND grading_company = ? AND grade = ?
         AND sale_date >= date('now', '-90 days')
         AND is_anomaly = 0`
    )
      .bind(card_id, grading_company, grade)
      .first();

    if (!recentSales || (recentSales.count as number) === 0) {
      return c.json({ error: "Insufficient data to evaluate this card" }, 404);
    }

    const avgPrice = recentSales.avg_price as number;
    const nrv = computeNrv(avgPrice);
    const maxBuyPrice = nrv * (1 - REQUIRED_MARGIN);
    const nrvMargin = offered_price < nrv ? ((nrv - offered_price) / nrv) * 100 : ((offered_price - nrv) / nrv) * -100;

    const response: EvaluateResponse = {
      decision: offered_price < maxBuyPrice ? "REVIEW_BUY" : offered_price < nrv ? "FAIR_VALUE" : "SELL_SIGNAL",
      fair_value: Math.round(avgPrice * 100) / 100,
      margin: Math.round(nrvMargin * 100) / 100,
      confidence: "LOW",
      reasoning: `Based on ${recentSales.count} sales in last 90 days (no ML model). Fair value: $${avgPrice.toFixed(2)}, NRV after fees/shipping/returns: $${nrv.toFixed(2)}, max buy price at ${REQUIRED_MARGIN * 100}% margin: $${maxBuyPrice.toFixed(2)}.`,
    };

    return c.json(response);
  }

  const fairValue = prediction.fair_value as number;
  const p80 = prediction.p90 as number; // sell threshold from model
  const confidence = prediction.confidence as "HIGH" | "MEDIUM" | "LOW";
  const volumeBucket = prediction.volume_bucket as string;

  // NRV-based evaluation (Section 3.5)
  const nrv = computeNrv(fairValue);
  const maxBuyPrice = nrv * (1 - REQUIRED_MARGIN);
  const nrvMargin = offered_price < nrv ? ((nrv - offered_price) / nrv) * 100 : ((offered_price - nrv) / nrv) * -100;

  let decision: EvaluateResponse["decision"];
  let reasoning: string;

  if (offered_price < maxBuyPrice) {
    // Price is below max buy threshold — profitable after all costs
    if (confidence !== "LOW") {
      decision = "STRONG_BUY";
      reasoning = `Price $${offered_price.toFixed(2)} is below max buy price $${maxBuyPrice.toFixed(2)} (NRV: $${nrv.toFixed(2)}, fair value: $${fairValue.toFixed(2)}). Expected ${nrvMargin.toFixed(1)}% net margin after fees, shipping, and returns. ${confidence} confidence, ${volumeBucket} volume.`;
    } else {
      decision = "REVIEW_BUY";
      reasoning = `Price is below max buy price but confidence is LOW (${volumeBucket} volume card). NRV: $${nrv.toFixed(2)}, max buy: $${maxBuyPrice.toFixed(2)}. Recommend human review.`;
    }
  } else if (offered_price > p80) {
    decision = "SELL_SIGNAL";
    reasoning = `Price $${offered_price.toFixed(2)} exceeds p80 ($${p80.toFixed(2)}). Consider selling at this price. NRV at fair value: $${nrv.toFixed(2)}.`;
  } else if (offered_price > nrv) {
    decision = "FAIR_VALUE";
    reasoning = `Price $${offered_price.toFixed(2)} exceeds NRV $${nrv.toFixed(2)} — buying at this price would not meet the ${REQUIRED_MARGIN * 100}% margin target. Fair value: $${fairValue.toFixed(2)}.`;
  } else {
    decision = "FAIR_VALUE";
    reasoning = `Price $${offered_price.toFixed(2)} is within range but above max buy price $${maxBuyPrice.toFixed(2)}. Margin of ${nrvMargin.toFixed(1)}% is below the ${REQUIRED_MARGIN * 100}% target. Fair value: $${fairValue.toFixed(2)}.`;
  }

  const response: EvaluateResponse = {
    decision,
    fair_value: Math.round(fairValue * 100) / 100,
    margin: Math.round(nrvMargin * 100) / 100,
    confidence,
    reasoning,
  };

  return c.json(response);
});
