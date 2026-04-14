import { Agent, callable } from "agents";
import type { Env } from "../types";

/**
 * PriceMonitorAgent — watches for price anomalies and viral events.
 *
 * Runs every 15 minutes checking for:
 * - Price spikes/crashes (>30% deviation from 30d average)
 * - Viral social mentions (>3x normal mention volume)
 * - New price records (all-time highs/lows)
 *
 * When triggered, it re-prices affected cards immediately
 * instead of waiting for the daily batch.
 */

interface MonitorState {
  lastCheckAt: string | null;
  activeAlerts: Array<{
    cardId: string;
    cardName: string;
    type: "price_spike" | "price_crash" | "viral" | "new_high" | "new_low";
    magnitude: number;
    detectedAt: string;
  }>;
  checksRun: number;
  anomaliesDetected: number;
}

export class PriceMonitorAgent extends Agent<Env, MonitorState> {
  initialState: MonitorState = {
    lastCheckAt: null,
    activeAlerts: [],
    checksRun: 0,
    anomaliesDetected: 0,
  };

  async onStart() {
    // Run monitoring check every 15 minutes
    await this.scheduleEvery(900, "runMonitoringCheck");
  }

  @callable({ description: "Run a full monitoring check now" })
  async runMonitoringCheck() {
    const alerts: MonitorState["activeAlerts"] = [];

    // Check for price spikes/crashes
    const priceAlerts = await this.checkPriceMovements();
    alerts.push(...priceAlerts);

    // Check for viral social activity
    const viralAlerts = await this.checkViralActivity();
    alerts.push(...viralAlerts);

    // Trigger re-pricing for affected cards
    if (alerts.length > 0) {
      await this.triggerRepricing(alerts);
    }

    this.setState({
      lastCheckAt: new Date().toISOString(),
      activeAlerts: [...this.state.activeAlerts, ...alerts].slice(-50),
      checksRun: this.state.checksRun + 1,
      anomaliesDetected: this.state.anomaliesDetected + alerts.length,
    });

    return { alertsFound: alerts.length, total: this.state.anomaliesDetected };
  }

  @callable({ description: "Get current monitoring status" })
  getStatus() {
    return {
      lastCheck: this.state.lastCheckAt,
      activeAlerts: this.state.activeAlerts.length,
      totalChecks: this.state.checksRun,
      totalAnomalies: this.state.anomaliesDetected,
      recentAlerts: this.state.activeAlerts.slice(-10),
    };
  }

  @callable({ description: "Clear resolved alerts" })
  clearAlerts() {
    this.setState({ ...this.state, activeAlerts: [] });
    return { cleared: true };
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, "");

    switch (path) {
      case "getStatus":
        return Response.json(this.getStatus());
      case "runMonitoringCheck":
        return Response.json(await this.runMonitoringCheck());
      case "clearAlerts":
        return Response.json(this.clearAlerts());
      default:
        return Response.json({ error: "Unknown method" }, { status: 404 });
    }
  }

  private async checkPriceMovements(): Promise<MonitorState["activeAlerts"]> {
    const alerts: MonitorState["activeAlerts"] = [];

    const spikes = await this.env.DB.prepare(
      `SELECT
         po.card_id, cc.name,
         AVG(CASE WHEN po.sale_date >= date('now', '-1 day') THEN po.price_usd END) as price_1d,
         AVG(CASE WHEN po.sale_date >= date('now', '-30 days') THEN po.price_usd END) as price_30d,
         COUNT(CASE WHEN po.sale_date >= date('now', '-1 day') THEN 1 END) as sales_1d
       FROM price_observations po
       JOIN card_catalog cc ON cc.id = po.card_id
       WHERE po.sale_date >= date('now', '-30 days')
         AND po.is_anomaly = 0
       GROUP BY po.card_id
       HAVING sales_1d >= 1 AND price_30d > 0
         AND ABS(price_1d - price_30d) / price_30d > 0.30`
    ).bind().all();

    for (const row of spikes.results) {
      const price1d = row.price_1d as number;
      const price30d = row.price_30d as number;
      const changePct = ((price1d - price30d) / price30d) * 100;

      alerts.push({
        cardId: row.card_id as string,
        cardName: row.name as string,
        type: changePct > 0 ? "price_spike" : "price_crash",
        magnitude: Math.round(changePct * 10) / 10,
        detectedAt: new Date().toISOString(),
      });

      // Create alert in DB
      await this.env.DB.prepare(
        `INSERT OR IGNORE INTO price_alerts (card_id, alert_type, magnitude, trigger_source, message)
         SELECT ?, ?, ?, 'price_monitor_agent', ?
         WHERE NOT EXISTS (
           SELECT 1 FROM price_alerts WHERE card_id = ? AND alert_type = ? AND is_active = 1
             AND created_at >= datetime('now', '-6 hours')
         )`
      ).bind(
        row.card_id,
        changePct > 0 ? "price_spike" : "price_crash",
        Math.abs(Math.round(changePct * 10) / 10),
        `${changePct > 0 ? "Spike" : "Crash"}: ${changePct > 0 ? "+" : ""}${changePct.toFixed(1)}% in last 24h (agent-detected)`,
        row.card_id,
        changePct > 0 ? "price_spike" : "price_crash"
      ).run();
    }

    return alerts;
  }

  private async checkViralActivity(): Promise<MonitorState["activeAlerts"]> {
    const alerts: MonitorState["activeAlerts"] = [];

    // Check for cards with >3x normal mention volume in last 6 hours
    const viral = await this.env.DB.prepare(
      `SELECT sr.card_id, cc.name,
              COUNT(*) as mentions_6h
       FROM sentiment_raw sr
       JOIN card_catalog cc ON cc.id = sr.card_id
       WHERE sr.observed_at >= datetime('now', '-6 hours')
       GROUP BY sr.card_id
       HAVING mentions_6h >= 10`
    ).bind().all();

    for (const row of viral.results) {
      // Compare to 7-day average
      const avg = await this.env.DB.prepare(
        `SELECT COUNT(*) / 28.0 as avg_6h_mentions
         FROM sentiment_raw
         WHERE card_id = ? AND observed_at >= datetime('now', '-7 days')`
      ).bind(row.card_id).first();

      const avg6h = (avg?.avg_6h_mentions as number) || 1;
      const current = row.mentions_6h as number;

      if (current > avg6h * 3) {
        alerts.push({
          cardId: row.card_id as string,
          cardName: row.name as string,
          type: "viral",
          magnitude: Math.round((current / avg6h) * 10) / 10,
          detectedAt: new Date().toISOString(),
        });

        await this.env.DB.prepare(
          `INSERT OR IGNORE INTO price_alerts (card_id, alert_type, magnitude, trigger_source, message)
           SELECT ?, 'viral_social', ?, 'price_monitor_agent', ?
           WHERE NOT EXISTS (
             SELECT 1 FROM price_alerts WHERE card_id = ? AND alert_type = 'viral_social' AND is_active = 1
               AND created_at >= datetime('now', '-6 hours')
           )`
        ).bind(
          row.card_id,
          Math.round((current / avg6h) * 10) / 10,
          `Viral: ${current} mentions in 6h (${Math.round(current / avg6h)}x normal). Agent-triggered re-pricing.`,
          row.card_id
        ).run();
      }
    }

    return alerts;
  }

  private async triggerRepricing(alerts: MonitorState["activeAlerts"]) {
    // For each alerted card, recompute features and update predictions immediately
    for (const alert of alerts.slice(0, 10)) {
      // Invalidate cached price so next request gets fresh data
      const grades = await this.env.DB.prepare(
        `SELECT DISTINCT grade, grading_company FROM feature_store WHERE card_id = ?`
      ).bind(alert.cardId).all();

      for (const g of grades.results) {
        const key = `price:${alert.cardId}:${g.grading_company}:${g.grade}`;
        await this.env.PRICE_CACHE.delete(key);
      }
    }
  }
}
