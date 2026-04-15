import { Hono } from "hono";
import type { Env } from "../types";

/**
 * REST API endpoints for agent @callable methods.
 *
 * The Agents SDK expects x-partykit-namespace and x-partykit-room headers
 * when calling stub.fetch(). These identify the agent class and instance.
 */
export const agentRoutes = new Hono<{ Bindings: Env }>();

async function callAgent(
  ns: DurableObjectNamespace,
  className: string,
  instanceName: string,
  method: string,
  args: unknown[] = []
): Promise<unknown> {
  const id = ns.idFromName(instanceName);
  const stub = ns.get(id);

  // The Agent SDK's fetch handler requires PartyKit-style headers
  const resp = await stub.fetch(new Request("https://agent/rpc", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-partykit-namespace": className,
      "x-partykit-room": instanceName,
    },
    body: JSON.stringify({ method, args }),
  }));

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Agent ${className}/${instanceName}.${method} failed: ${text}`);
  }

  return resp.json();
}

// ─── Price Monitor ───
agentRoutes.get("/monitor/status", async (c) => {
  return c.json(await callAgent(c.env.PriceMonitorAgent, "PriceMonitorAgent", "default", "getStatus"));
});

agentRoutes.post("/monitor/check", async (c) => {
  return c.json(await callAgent(c.env.PriceMonitorAgent, "PriceMonitorAgent", "default", "runMonitoringCheck"));
});

// ─── Market Intelligence ───
agentRoutes.get("/intelligence/latest", async (c) => {
  const report = await callAgent(c.env.MarketIntelligenceAgent, "MarketIntelligenceAgent", "default", "getLatestReport");
  if (!report) return c.json({ error: "No reports yet" }, 404);
  return c.json(report);
});

agentRoutes.post("/intelligence/generate", async (c) => {
  return c.json(await callAgent(c.env.MarketIntelligenceAgent, "MarketIntelligenceAgent", "default", "generateDailyReport"));
});

// ─── Competitor Tracker ───
agentRoutes.get("/competitors/status", async (c) => {
  return c.json(await callAgent(c.env.CompetitorTrackerAgent, "CompetitorTrackerAgent", "default", "getStatus"));
});

agentRoutes.get("/competitors/gaps", async (c) => {
  return c.json({ gaps: await callAgent(c.env.CompetitorTrackerAgent, "CompetitorTrackerAgent", "default", "getAllGaps") });
});

agentRoutes.post("/competitors/scan", async (c) => {
  return c.json(await callAgent(c.env.CompetitorTrackerAgent, "CompetitorTrackerAgent", "default", "scanCompetitorPrices"));
});

// ─── Pricing Recommendations ───
agentRoutes.get("/recommendations/pending", async (c) => {
  const action = c.req.query("action") as "BUY" | "SELL" | "REPRICE" | undefined;
  return c.json({ recommendations: await callAgent(c.env.PricingRecommendationAgent, "PricingRecommendationAgent", "default", "getPending", action ? [action] : []) });
});

agentRoutes.get("/recommendations/status", async (c) => {
  return c.json(await callAgent(c.env.PricingRecommendationAgent, "PricingRecommendationAgent", "default", "getStatus"));
});

agentRoutes.post("/recommendations/generate", async (c) => {
  return c.json(await callAgent(c.env.PricingRecommendationAgent, "PricingRecommendationAgent", "default", "generateRecommendations"));
});

agentRoutes.post("/recommendations/:id/approve", async (c) => {
  const recId = c.req.param("id");
  let body: { approvedBy?: string } = {};
  try { body = await c.req.json(); } catch { /* ok */ }
  const result = await callAgent(c.env.PricingRecommendationAgent, "PricingRecommendationAgent", "default", "approveRecommendation", [recId, body.approvedBy || "api"]);
  if (!result) return c.json({ error: "Not found" }, 404);
  return c.json(result);
});

agentRoutes.post("/recommendations/:id/reject", async (c) => {
  const recId = c.req.param("id");
  let body: { rejectedBy?: string } = {};
  try { body = await c.req.json(); } catch { /* ok */ }
  const result = await callAgent(c.env.PricingRecommendationAgent, "PricingRecommendationAgent", "default", "rejectRecommendation", [recId, body.rejectedBy || "api"]);
  if (!result) return c.json({ error: "Not found" }, 404);
  return c.json(result);
});
