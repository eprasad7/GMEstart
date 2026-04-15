import { Agent, callable, type Connection } from "agents";
import type { Env } from "../types";
import { handleAgentRpc } from "./rpc-handler";

interface MonitorAlert {
  cardId: string;
  cardName: string;
  type: "price_spike" | "price_crash" | "viral" | "new_high" | "new_low";
  magnitude: number;
  detectedAt: string;
}

interface MonitorState {
  lastCheckAt: string | null;
  activeAlerts: MonitorAlert[];
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

  static options = {
    hibernate: true,
    sendIdentityOnConnect: true,
    retry: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 30000 },
  };

  validateStateChange(nextState: MonitorState) {
    if (nextState.activeAlerts.length > 100) {
      throw new Error("Too many active alerts — clear old ones first");
    }
  }

  onStateChanged(state: MonitorState, source: Connection | "server") {
    if (source !== "server" || state.activeAlerts.length === 0) return;
    console.log(`[PriceMonitor] ${state.activeAlerts.length} active alerts after check #${state.checksRun}`);
  }

  async onStart() {
    await this.scheduleEvery(900, "runMonitoringCheck");
  }

  async onRequest(request: Request): Promise<Response> {
    return handleAgentRpc(this as unknown as Record<string, unknown>, request);
  }

  @callable({ description: "Run a full monitoring check for anomalies and viral events" })
  async runMonitoringCheck() {
    return await this.keepAliveWhile(async () => {
      const alerts: MonitorAlert[] = [];

      const priceAlerts = await this.checkPriceMovements();
      alerts.push(...priceAlerts);

      const viralAlerts = await this.checkViralActivity();
      alerts.push(...viralAlerts);

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
    });
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

  @callable({ description: "Clear all resolved alerts" })
  clearAlerts() {
    this.setState({ ...this.state, activeAlerts: [] });
    return { cleared: true };
  }

  @callable({ description: "Get all active schedules" })
  listSchedules() {
    return this.getSchedules();
  }

  @callable({ description: "Cancel a scheduled task by ID" })
  async cancelTask(scheduleId: string) {
    return await this.cancelSchedule(scheduleId);
  }

  private async checkPriceMovements(): Promise<MonitorAlert[]> {
    const alerts: MonitorAlert[] = [];

    const spikes = await this.env.DB.prepare(
      `SELECT po.card_id, cc.name,
         AVG(CASE WHEN po.sale_date >= date('now', '-1 day') THEN po.price_usd END) as price_1d,
         AVG(CASE WHEN po.sale_date >= date('now', '-30 days') THEN po.price_usd END) as price_30d,
         COUNT(CASE WHEN po.sale_date >= date('now', '-1 day') THEN 1 END) as sales_1d
       FROM price_observations po
       JOIN card_catalog cc ON cc.id = po.card_id
       WHERE po.sale_date >= date('now', '-30 days') AND po.is_anomaly = 0
       GROUP BY po.card_id
       HAVING sales_1d >= 1 AND price_30d > 0
         AND ABS(price_1d - price_30d) / price_30d > 0.30`
    ).bind().all();

    for (const row of spikes.results) {
      const changePct = (((row.price_1d as number) - (row.price_30d as number)) / (row.price_30d as number)) * 100;

      alerts.push({
        cardId: row.card_id as string,
        cardName: row.name as string,
        type: changePct > 0 ? "price_spike" : "price_crash",
        magnitude: Math.round(changePct * 10) / 10,
        detectedAt: new Date().toISOString(),
      });

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
        `${changePct > 0 ? "Spike" : "Crash"}: ${changePct > 0 ? "+" : ""}${changePct.toFixed(1)}% in 24h`,
        row.card_id,
        changePct > 0 ? "price_spike" : "price_crash"
      ).run();
    }

    return alerts;
  }

  private async checkViralActivity(): Promise<MonitorAlert[]> {
    const alerts: MonitorAlert[] = [];

    const viral = await this.env.DB.prepare(
      `SELECT sr.card_id, cc.name, COUNT(*) as mentions_6h
       FROM sentiment_raw sr
       JOIN card_catalog cc ON cc.id = sr.card_id
       WHERE sr.observed_at >= datetime('now', '-6 hours')
       GROUP BY sr.card_id
       HAVING mentions_6h >= 10`
    ).bind().all();

    for (const row of viral.results) {
      const avg = await this.env.DB.prepare(
        `SELECT COUNT(*) / 28.0 as avg_6h FROM sentiment_raw
         WHERE card_id = ? AND observed_at >= datetime('now', '-7 days')`
      ).bind(row.card_id).first();

      const avg6h = (avg?.avg_6h as number) || 1;
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
          row.card_id, Math.round((current / avg6h) * 10) / 10,
          `Viral: ${current} mentions in 6h (${Math.round(current / avg6h)}x normal)`,
          row.card_id
        ).run();
      }
    }

    return alerts;
  }

  private async triggerRepricing(alerts: MonitorAlert[]) {
    for (const alert of alerts.slice(0, 10)) {
      const grades = await this.env.DB.prepare(
        `SELECT DISTINCT grade, grading_company FROM feature_store WHERE card_id = ?`
      ).bind(alert.cardId).all();

      for (const g of grades.results) {
        await this.env.PRICE_CACHE.delete(`price:${alert.cardId}:${g.grading_company}:${g.grade}`);
      }
    }
  }
}
