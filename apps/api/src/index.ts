import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { routeAgentRequest } from "agents";
import type { Env } from "./types";
import { priceRoutes } from "./routes/prices";
import { historyRoutes } from "./routes/history";
import { sentimentRoutes } from "./routes/sentiment";
import { evaluateRoutes } from "./routes/evaluate";
import { alertRoutes } from "./routes/alerts";
import { marketRoutes } from "./routes/market";
import { cardRoutes } from "./routes/cards";
import { agentRoutes } from "./routes/agents";
import { systemRoutes } from "./routes/system";
import { handleScheduled } from "./services/scheduler";
import { handleIngestionQueue, handleSentimentQueue } from "./services/queue-consumer";
import { apiKeyAuth, rateLimiter } from "./middleware/auth";

// Export agent classes (required for Durable Object bindings)
export { PriceMonitorAgent } from "./agents/price-monitor";
export { MarketIntelligenceAgent } from "./agents/market-intelligence";
export { CompetitorTrackerAgent } from "./agents/competitor-tracker";
export { PricingRecommendationAgent } from "./agents/pricing-recommendation";

const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use("*", cors());
app.use("*", logger());
app.use("/v1/*", apiKeyAuth);
app.use("/v1/*", rateLimiter);

// Health check — always public, shows environment info
app.get("/", (c) =>
  c.json({
    service: "GameCards Dynamic Pricing Engine",
    version: "1.0.0",
    status: "healthy",
    environment: c.env.ENVIRONMENT || "unknown",
    auth: c.env.ENVIRONMENT === "development" ? "bypassed" : "required",
    agents: ["price-monitor", "market-intelligence", "competitor-tracker", "pricing-recommendation"],
  })
);

// API routes
const api = app.basePath("/v1");
api.route("/cards", cardRoutes);
api.route("/price", priceRoutes);
api.route("/history", historyRoutes);
api.route("/sentiment", sentimentRoutes);
api.route("/evaluate", evaluateRoutes);
api.route("/alerts", alertRoutes);
api.route("/market", marketRoutes);
api.route("/agents", agentRoutes);
api.route("/system", systemRoutes);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    // Auth gate for /agents/* — same rules as /v1/*
    if (url.pathname.startsWith("/agents/") && env.ENVIRONMENT !== "development") {
      if (request.method !== "OPTIONS") {
        const apiKey = request.headers.get("X-API-Key");
        if (!apiKey || apiKey !== env.API_KEY) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: apiKey ? 403 : 401,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
    }

    // Route agent WebSocket/HTTP requests
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    // Fall through to Hono API routes
    return app.fetch(request, env, ctx);
  },

  // Cron Triggers — scheduled data ingestion
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleScheduled(event, env));
  },

  // Queue consumers — async processing
  async queue(batch: MessageBatch, env: Env) {
    const queueName = batch.queue;
    if (queueName === "gamecards-ingestion") {
      await handleIngestionQueue(batch, env);
    } else if (queueName === "gamecards-sentiment") {
      await handleSentimentQueue(batch, env);
    } else {
      console.error(`Unknown queue: ${queueName}. Acking ${batch.messages.length} messages to prevent retry loop.`);
      batch.ackAll();
    }
  },
};
