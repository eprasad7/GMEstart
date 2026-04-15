import { Hono } from "hono";
import { swaggerUI } from "@hono/swagger-ui";
import type { Env } from "../types";

export const docsRoutes = new Hono<{ Bindings: Env }>();

const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "GMEstart Dynamic Pricing Engine",
    version: "1.0.0",
    description: "Real-time collectibles pricing API with ML predictions, autonomous agents, and demand-aware dynamic pricing. Built on Cloudflare Workers.",
  },
  servers: [
    { url: "https://api.gmestart.com", description: "Production" },
  ],
  tags: [
    { name: "Cards", description: "Card catalog management" },
    { name: "Pricing", description: "ML-powered price predictions" },
    { name: "History", description: "Price history and aggregates" },
    { name: "Evaluate", description: "Buy/sell decision engine" },
    { name: "Sentiment", description: "Social sentiment analysis" },
    { name: "Market", description: "Market indices and movers" },
    { name: "Alerts", description: "Price alerts and anomalies" },
    { name: "Agents", description: "Autonomous AI agents" },
    { name: "System", description: "Pipeline operations and health" },
    { name: "Auth", description: "Authentication" },
  ],
  paths: {
    "/v1/cards/search": {
      get: {
        tags: ["Cards"],
        summary: "Search cards",
        parameters: [
          { name: "q", in: "query", schema: { type: "string" }, description: "Search query" },
          { name: "category", in: "query", schema: { type: "string", enum: ["pokemon", "sports_baseball", "sports_basketball", "sports_football", "tcg_mtg", "tcg_yugioh"] } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
        ],
        responses: { "200": { description: "Card list", content: { "application/json": { schema: { type: "object", properties: { cards: { type: "array" } } } } } } },
      },
    },
    "/v1/cards/{id}": {
      get: {
        tags: ["Cards"],
        summary: "Get card by ID",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Card details" }, "404": { description: "Not found" } },
      },
    },
    "/v1/price/{cardId}": {
      get: {
        tags: ["Pricing"],
        summary: "Get price prediction for a card",
        description: "Returns ML fair value, confidence intervals, buy/sell thresholds, and trend. Uses LightGBM quantile regression (lgbm-v1) or statistical fallback.",
        parameters: [
          { name: "cardId", in: "path", required: true, schema: { type: "string" } },
          { name: "grade", in: "query", schema: { type: "string", default: "RAW" } },
          { name: "grading_company", in: "query", schema: { type: "string", default: "RAW", enum: ["PSA", "BGS", "CGC", "SGC", "RAW"] } },
        ],
        responses: {
          "200": {
            description: "Price prediction",
            content: { "application/json": { schema: {
              type: "object",
              properties: {
                card_id: { type: "string" },
                card_name: { type: "string" },
                price: { type: "number", description: "Fair value (USD)" },
                lower: { type: "number", description: "p10 lower bound" },
                upper: { type: "number", description: "p90 upper bound" },
                buy_threshold: { type: "number", description: "NRV-based max buy price" },
                sell_threshold: { type: "number", description: "Sell signal threshold" },
                confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
                sales_30d: { type: "integer" },
                trend: { type: "string", enum: ["rising", "stable", "falling"] },
                has_prediction: { type: "boolean", description: "True if ML model prediction, false if statistical fallback" },
              },
            } } },
          },
        },
      },
    },
    "/v1/evaluate": {
      post: {
        tags: ["Evaluate"],
        summary: "Evaluate a card at an offered price",
        description: "Returns STRONG_BUY, REVIEW_BUY, FAIR_VALUE, or SELL_SIGNAL based on NRV economics (fees, shipping, returns, margin target).",
        requestBody: { content: { "application/json": { schema: {
          type: "object",
          required: ["card_id", "offered_price"],
          properties: {
            card_id: { type: "string" },
            offered_price: { type: "number" },
            grade: { type: "string", default: "RAW" },
            grading_company: { type: "string", default: "RAW" },
          },
        } } } },
        responses: { "200": { description: "Evaluation result with decision, fair value, margin, confidence, and reasoning" } },
      },
    },
    "/v1/evaluate/advanced": {
      post: {
        tags: ["Evaluate"],
        summary: "Advanced demand-aware evaluation (Level 1 dynamic pricing)",
        description: "The killer feature. Returns optimized list price, trade-in offer, risk score, expected profit, and adjustment breakdown based on inventory, demand, competition, and events.",
        requestBody: { content: { "application/json": { schema: {
          type: "object",
          required: ["card_id"],
          properties: {
            card_id: { type: "string" },
            offered_price: { type: "number", description: "Customer's offered price (optional)" },
            grade: { type: "string", default: "RAW" },
            grading_company: { type: "string", default: "RAW" },
            channel: { type: "string", enum: ["store", "online", "ebay"], default: "store" },
          },
        } } } },
        responses: { "200": { description: "Optimized pricing with list_price, trade_in_offer, adjustments[], risk_score, expected_profit, hold recommendation" } },
      },
    },
    "/v1/history/{cardId}": {
      get: {
        tags: ["History"],
        summary: "Get price history",
        parameters: [
          { name: "cardId", in: "path", required: true, schema: { type: "string" } },
          { name: "days", in: "query", schema: { type: "integer", default: 90 } },
          { name: "grade", in: "query", schema: { type: "string" } },
          { name: "grading_company", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "Sale records" } },
      },
    },
    "/v1/sentiment/{cardId}": {
      get: {
        tags: ["Sentiment"],
        summary: "Get social sentiment for a card",
        parameters: [{ name: "cardId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Sentiment score, mention count, trend, breakdown by source/period" } },
      },
    },
    "/v1/market/index": {
      get: {
        tags: ["Market"],
        summary: "Get market indices",
        responses: { "200": { description: "Pokemon and Sports indices with per-category trends and volatility" } },
      },
    },
    "/v1/market/movers": {
      get: {
        tags: ["Market"],
        summary: "Top price movers",
        parameters: [
          { name: "direction", in: "query", schema: { type: "string", enum: ["up", "down"], default: "up" } },
          { name: "days", in: "query", schema: { type: "integer", default: 7 } },
        ],
        responses: { "200": { description: "Top gainers or decliners with change percentages" } },
      },
    },
    "/v1/alerts/active": {
      get: {
        tags: ["Alerts"],
        summary: "Get active price alerts",
        responses: { "200": { description: "Active alerts (spikes, crashes, viral, anomalies)" } },
      },
    },
    "/v1/agents/monitor/status": {
      get: { tags: ["Agents"], summary: "Price Monitor agent status", responses: { "200": { description: "Active alerts, check count, anomalies detected" } } },
    },
    "/v1/agents/monitor/check": {
      post: { tags: ["Agents"], summary: "Trigger price monitoring check", responses: { "200": { description: "Alerts found" } } },
    },
    "/v1/agents/intelligence/latest": {
      get: { tags: ["Agents"], summary: "Latest AI market intelligence report", responses: { "200": { description: "Market briefing with highlights and sentiment" } } },
    },
    "/v1/agents/intelligence/generate": {
      post: { tags: ["Agents"], summary: "Generate new market intelligence report (Gemma 4 26B)", responses: { "200": { description: "Generated report" } } },
    },
    "/v1/agents/competitors/status": {
      get: { tags: ["Agents"], summary: "Competitor tracker status", responses: { "200": { description: "Overpriced/underpriced counts, scan history" } } },
    },
    "/v1/agents/competitors/scan": {
      post: { tags: ["Agents"], summary: "Trigger competitor price scan", responses: { "200": { description: "Gaps found" } } },
    },
    "/v1/agents/recommendations/status": {
      get: { tags: ["Agents"], summary: "Pricing recommendations status", responses: { "200": { description: "Pending counts by action, approval stats" } } },
    },
    "/v1/agents/recommendations/generate": {
      post: { tags: ["Agents"], summary: "Generate pricing recommendations", responses: { "200": { description: "Recommendations generated" } } },
    },
    "/v1/system/health": {
      get: { tags: ["System"], summary: "Pipeline health", description: "Returns prediction freshness, model version, drift status, catalog size, and recent ingestion runs.", responses: { "200": { description: "Health status" } } },
    },
    "/v1/system/run-pipeline": {
      post: { tags: ["System"], summary: "Manually trigger the full pipeline", description: "Runs: PriceCharting → Population → Sentiment rollup → Anomaly → Features → Predictions", responses: { "200": { description: "Pipeline results" } } },
    },
    "/v1/system/seed": {
      post: { tags: ["System"], summary: "Seed catalog from PriceCharting", requestBody: { content: { "application/json": { schema: { type: "object", properties: { queries: { type: "array", items: { type: "string" } } } } } } }, responses: { "200": { description: "Cards imported" } } },
    },
    "/v1/system/rollback": {
      post: { tags: ["System"], summary: "Rollback to previous model version", responses: { "200": { description: "Rollback status" } } },
    },
    "/v1/auth/login": {
      post: { tags: ["Auth"], summary: "Authenticate with access code", requestBody: { content: { "application/json": { schema: { type: "object", properties: { code: { type: "string" } } } } } }, responses: { "200": { description: "Session token (24h expiry)" } } },
    },
  },
  components: {
    securitySchemes: {
      apiKey: { type: "apiKey", in: "header", name: "X-API-Key", description: "API key or session token from /v1/auth/login" },
    },
  },
  security: [{ apiKey: [] }],
};

// Serve OpenAPI spec as JSON
docsRoutes.get("/openapi.json", (c) => c.json(openApiSpec));

// Serve Swagger UI
docsRoutes.get(
  "/",
  swaggerUI({ url: "/docs/openapi.json" })
);
