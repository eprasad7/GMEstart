import { Hono } from "hono";
import type { Env } from "../types";

/**
 * REST API endpoints for agent interaction.
 *
 * These provide a REST interface to the agents' methods via DO stub.fetch(),
 * complementing the WebSocket/RPC path at /agents/*.
 * Useful for the dashboard and external integrations.
 *
 * Each agent implements an onRequest(request) handler that dispatches
 * based on the URL pathname to the appropriate callable method.
 */
export const agentRoutes = new Hono<{ Bindings: Env }>();

/**
 * Helper: send a request to a Durable Object agent and return the JSON response.
 */
async function agentFetch(
  ns: DurableObjectNamespace,
  instanceName: string,
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<Response> {
  const id = ns.idFromName(instanceName);
  const stub = ns.get(id);
  const init: RequestInit = { method: options?.method ?? "GET" };
  if (options?.body !== undefined) {
    init.body = JSON.stringify(options.body);
    init.headers = { "Content-Type": "application/json" };
  }
  return stub.fetch(new Request(`https://agent${path}`, init));
}

// ─── Price Monitor Agent ───

agentRoutes.get("/monitor/status", async (c) => {
  const resp = await agentFetch(c.env.PriceMonitorAgent, "default", "/getStatus");
  const status = await resp.json();
  return c.json(status);
});

agentRoutes.post("/monitor/check", async (c) => {
  const resp = await agentFetch(c.env.PriceMonitorAgent, "default", "/runMonitoringCheck", { method: "POST" });
  const result = await resp.json();
  return c.json(result);
});

// ─── Market Intelligence Agent ───

agentRoutes.get("/intelligence/latest", async (c) => {
  const resp = await agentFetch(c.env.MarketIntelligenceAgent, "default", "/getLatestReport");
  const report = await resp.json();
  if (!report) return c.json({ error: "No reports generated yet" }, 404);
  return c.json(report);
});

agentRoutes.get("/intelligence/history", async (c) => {
  const count = parseInt(c.req.query("count") || "7");
  const resp = await agentFetch(c.env.MarketIntelligenceAgent, "default", "/getReportHistory", {
    method: "POST",
    body: { count },
  });
  const reports = await resp.json();
  return c.json({ reports });
});

agentRoutes.post("/intelligence/generate", async (c) => {
  const resp = await agentFetch(c.env.MarketIntelligenceAgent, "default", "/generateDailyReport", { method: "POST" });
  const report = await resp.json();
  return c.json(report);
});

// ─── Competitor Tracker Agent ───

agentRoutes.get("/competitors/status", async (c) => {
  const resp = await agentFetch(c.env.CompetitorTrackerAgent, "default", "/getStatus");
  const status = await resp.json();
  return c.json(status);
});

agentRoutes.get("/competitors/gaps", async (c) => {
  const resp = await agentFetch(c.env.CompetitorTrackerAgent, "default", "/getAllGaps");
  const gaps = await resp.json();
  return c.json({ gaps });
});

agentRoutes.get("/competitors/overpriced", async (c) => {
  const resp = await agentFetch(c.env.CompetitorTrackerAgent, "default", "/getOverpriced", {
    method: "POST",
    body: { limit: 20 },
  });
  const overpriced = await resp.json();
  return c.json({ overpriced });
});

agentRoutes.get("/competitors/underpriced", async (c) => {
  const resp = await agentFetch(c.env.CompetitorTrackerAgent, "default", "/getUnderpriced", {
    method: "POST",
    body: { limit: 20 },
  });
  const underpriced = await resp.json();
  return c.json({ underpriced });
});

agentRoutes.post("/competitors/scan", async (c) => {
  const resp = await agentFetch(c.env.CompetitorTrackerAgent, "default", "/scanCompetitorPrices", { method: "POST" });
  const result = await resp.json();
  return c.json(result);
});

// ─── Pricing Recommendation Agent ───

agentRoutes.get("/recommendations/pending", async (c) => {
  const action = c.req.query("action") as "BUY" | "SELL" | "REPRICE" | undefined;
  const resp = await agentFetch(c.env.PricingRecommendationAgent, "default", "/getPending", {
    method: "POST",
    body: { action },
  });
  const pending = await resp.json();
  return c.json({ recommendations: pending });
});

agentRoutes.get("/recommendations/history", async (c) => {
  const limit = parseInt(c.req.query("limit") || "20");
  const resp = await agentFetch(c.env.PricingRecommendationAgent, "default", "/getHistory", {
    method: "POST",
    body: { limit },
  });
  const history = await resp.json();
  return c.json({ history });
});

agentRoutes.get("/recommendations/status", async (c) => {
  const resp = await agentFetch(c.env.PricingRecommendationAgent, "default", "/getStatus");
  const status = await resp.json();
  return c.json(status);
});

agentRoutes.post("/recommendations/generate", async (c) => {
  const resp = await agentFetch(c.env.PricingRecommendationAgent, "default", "/generateRecommendations", {
    method: "POST",
  });
  const result = await resp.json();
  return c.json(result);
});

agentRoutes.post("/recommendations/:id/approve", async (c) => {
  const recId = c.req.param("id");
  let body: { approvedBy?: string } = {};
  try { body = await c.req.json(); } catch { /* empty body ok */ }
  const approvedBy = body.approvedBy || "api-user";

  const resp = await agentFetch(c.env.PricingRecommendationAgent, "default", "/approveRecommendation", {
    method: "POST",
    body: { id: recId, approvedBy },
  });
  const result = await resp.json();
  if (!result) return c.json({ error: "Recommendation not found" }, 404);
  return c.json(result);
});

agentRoutes.post("/recommendations/:id/reject", async (c) => {
  const recId = c.req.param("id");
  let body: { rejectedBy?: string } = {};
  try { body = await c.req.json(); } catch { /* empty body ok */ }
  const rejectedBy = body.rejectedBy || "api-user";

  const resp = await agentFetch(c.env.PricingRecommendationAgent, "default", "/rejectRecommendation", {
    method: "POST",
    body: { id: recId, rejectedBy },
  });
  const result = await resp.json();
  if (!result) return c.json({ error: "Recommendation not found" }, 404);
  return c.json(result);
});
