import { Hono } from "hono";
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
import { authRoutes } from "./routes/auth";
import { ingestRoutes } from "./routes/ingest";
import { docsRoutes } from "./routes/docs";
import { handleScheduled } from "./services/scheduler";
import { handleIngestionQueue, handleSentimentQueue } from "./services/queue-consumer";
import { apiKeyAuth, rateLimiter } from "./middleware/auth";
import { logEvent } from "./lib/logging";
import { secureCompareStrings } from "./lib/security";

// Export agent classes (required for Durable Object bindings)
export { PriceMonitorAgent } from "./agents/price-monitor";
export { MarketIntelligenceAgent } from "./agents/market-intelligence";
export { CompetitorTrackerAgent } from "./agents/competitor-tracker";
export { PricingRecommendationAgent } from "./agents/pricing-recommendation";

const app = new Hono<{ Bindings: Env }>();

function getAllowedOrigins(env: Env): Set<string> {
  const configured = env.ALLOWED_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configured?.length) {
    return new Set(configured);
  }

  if (env.ENVIRONMENT === "development") {
    return new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);
  }

  return new Set(["https://dashboard.gamestop.com", "https://gamecards.gamestop.com"]);
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-API-Key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// Middleware
app.use("*", async (c, next) => {
  const origin = c.req.header("Origin");
  const allowedOrigins = getAllowedOrigins(c.env);
  const allowedOrigin = origin && allowedOrigins.has(origin) ? origin : null;

  if (c.req.method === "OPTIONS") {
    if (origin && !allowedOrigin && c.env.ENVIRONMENT !== "development") {
      return new Response(JSON.stringify({ error: "Origin not allowed" }), {
        status: 403,
        headers: { "Content-Type": "application/json", Vary: "Origin" },
      });
    }

    return new Response(null, {
      status: 204,
      headers: allowedOrigin ? corsHeaders(allowedOrigin) : { Vary: "Origin" },
    });
  }

  if (origin && !allowedOrigin && c.env.ENVIRONMENT !== "development") {
    return c.json({ error: "Origin not allowed" }, 403);
  }

  await next();

  if (allowedOrigin) {
    for (const [key, value] of Object.entries(corsHeaders(allowedOrigin))) {
      c.header(key, value);
    }
  } else if (origin) {
    c.header("Vary", "Origin");
  }
});
app.use("*", logger());
app.use("/v1/*", apiKeyAuth);
app.use("/v1/*", rateLimiter);

// Health check — always public, reflects pipeline status
app.get("/", async (c) => {
  // Quick freshness check — is model_predictions populated and recent?
  const latest = await c.env.DB.prepare(
    `SELECT MAX(predicted_at) as latest FROM model_predictions`
  ).bind().first();

  const latestAt = latest?.latest as string | null;
  const hoursSince = latestAt
    ? (Date.now() - new Date(latestAt).getTime()) / (1000 * 60 * 60)
    : null;
  const isStale = hoursSince === null || hoursSince > 36;

  return c.json({
    service: "GMEstart Dynamic Pricing Engine",
    version: "1.0.0",
    status: isStale ? "degraded" : "healthy",
    environment: c.env.ENVIRONMENT || "unknown",
    auth: c.env.ENVIRONMENT === "development" ? "bypassed" : "required",
    predictions: isStale ? "stale" : "fresh",
  });
});

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
api.route("/auth", authRoutes);
api.route("/ingest", ingestRoutes);

// Docs — mounted at /docs (outside /v1, no auth required)
app.route("/docs", docsRoutes);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    // Auth gate for /agents/* — same rules as /v1/*
    if (url.pathname.startsWith("/agents/") && env.ENVIRONMENT !== "development") {
      if (request.method !== "OPTIONS") {
        const apiKey = request.headers.get("X-API-Key");
        const isValid = apiKey ? await secureCompareStrings(apiKey, env.API_KEY) : false;
        if (!isValid) {
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
      logEvent("error", "unknown_queue_received", {
        queueName,
        messageCount: batch.messages.length,
      });
      batch.ackAll();
    }
  },
};
