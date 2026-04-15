import { Hono } from "hono";
import type { Env } from "../types";
import { parsePositiveInt } from "../lib/params";

export const alertRoutes = new Hono<{ Bindings: Env }>();

// GET /v1/alerts/active — excludes snoozed alerts by default
alertRoutes.get("/active", async (c) => {
  const category = c.req.query("category");
  const alertType = c.req.query("type");
  const includeSnoozed = c.req.query("include_snoozed") === "true";
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 200);

  let sql = `
    SELECT pa.*, cc.name as card_name, cc.category
    FROM price_alerts pa
    JOIN card_catalog cc ON cc.id = pa.card_id
    WHERE pa.is_active = 1`;
  const params: unknown[] = [];

  if (!includeSnoozed) {
    sql += ` AND (pa.snoozed_until IS NULL OR pa.snoozed_until < datetime('now'))`;
  }
  if (category) {
    sql += ` AND cc.category = ?`;
    params.push(category);
  }
  if (alertType) {
    sql += ` AND pa.alert_type = ?`;
    params.push(alertType);
  }

  sql += ` ORDER BY pa.magnitude DESC, pa.created_at DESC LIMIT ?`;
  params.push(limit);

  const results = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ alerts: results.results });
});

// POST /v1/alerts/:id/resolve
alertRoutes.post("/:id/resolve", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare(
    `UPDATE price_alerts SET is_active = 0, resolved_at = datetime('now') WHERE id = ?`
  )
    .bind(id)
    .run();

  return c.json({ status: "resolved" });
});

// POST /v1/alerts/:id/snooze
alertRoutes.post("/:id/snooze", async (c) => {
  const id = c.req.param("id");
  let body: { duration_minutes: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Expected: { duration_minutes: number }" }, 400);
  }

  const { duration_minutes } = body;
  if (!duration_minutes || duration_minutes <= 0 || duration_minutes > 10080) {
    return c.json({ error: "duration_minutes must be between 1 and 10080 (7 days)" }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE price_alerts SET snoozed_until = datetime('now', '+' || ? || ' minutes') WHERE id = ? AND is_active = 1`
  )
    .bind(duration_minutes, id)
    .run();

  return c.json({ status: "snoozed", duration_minutes });
});

// POST /v1/alerts/:id/assign
alertRoutes.post("/:id/assign", async (c) => {
  const id = c.req.param("id");
  let body: { assigned_to: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Expected: { assigned_to: string }" }, 400);
  }

  const { assigned_to } = body;
  if (!assigned_to || typeof assigned_to !== "string") {
    return c.json({ error: "assigned_to is required" }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE price_alerts SET assigned_to = ? WHERE id = ? AND is_active = 1`
  )
    .bind(assigned_to, id)
    .run();

  return c.json({ status: "assigned", assigned_to });
});

// GET /v1/alerts/history — resolved alerts
alertRoutes.get("/history", async (c) => {
  const days = parsePositiveInt(c.req.query("days"), 30, 365);
  const limit = Math.min(parseInt(c.req.query("limit") || "100"), 500);

  const results = await c.env.DB.prepare(
    `SELECT pa.*, cc.name as card_name, cc.category
     FROM price_alerts pa
     JOIN card_catalog cc ON cc.id = pa.card_id
     WHERE pa.created_at >= date('now', '-' || ? || ' days')
     ORDER BY pa.created_at DESC
     LIMIT ?`
  )
    .bind(days, limit)
    .all();

  return c.json({ alerts: results.results });
});
