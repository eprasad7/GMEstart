import { Agent, callable, type Connection } from "agents";
import type { Env } from "../types";
import { handleAgentRpc } from "./rpc-handler";

interface Recommendation {
  id: string;
  cardId: string;
  cardName: string;
  grade: string;
  gradingCompany: string;
  action: "BUY" | "SELL" | "REPRICE";
  currentPrice: number;
  recommendedPrice: number;
  fairValue: number;
  nrv: number;
  expectedMargin: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reasoning: string;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

interface RecommendationState {
  pending: Recommendation[];
  history: Recommendation[];
  lastGeneratedAt: string | null;
  stats: {
    totalGenerated: number;
    totalApproved: number;
    totalRejected: number;
    totalExpired: number;
  };
}

const MARKETPLACE_FEE = 0.13;
const SHIPPING_COST = 5.00;
const RETURN_RATE = 0.03;
const REQUIRED_MARGIN = 0.20;

function computeNrv(fairValue: number): number {
  return fairValue * (1 - MARKETPLACE_FEE) * (1 - RETURN_RATE) - SHIPPING_COST;
}

export class PricingRecommendationAgent extends Agent<Env, RecommendationState> {
  initialState: RecommendationState = {
    pending: [],
    history: [],
    lastGeneratedAt: null,
    stats: { totalGenerated: 0, totalApproved: 0, totalRejected: 0, totalExpired: 0 },
  };

  static options = {
    hibernate: true,
    sendIdentityOnConnect: true,
    retry: { maxAttempts: 2, baseDelayMs: 5000, maxDelayMs: 60000 },
  };

  validateStateChange(nextState: RecommendationState) {
    if (nextState.pending.length > 200) {
      throw new Error("Pending queue full — approve or reject existing recommendations");
    }
  }

  onStateChanged(state: RecommendationState, source: Connection | "server") {
    if (source !== "server") return;
    const pendingBuys = state.pending.filter((r) => r.action === "BUY").length;
    if (pendingBuys > 20) {
      console.log(`[PricingRec] ${pendingBuys} pending BUY recommendations awaiting approval`);
    }
  }

  async onStart() {
    await this.schedule("0 8 * * *", "generateRecommendations");
    await this.scheduleEvery(21600, "expireStaleRecommendations");
  }

  async onRequest(request: Request): Promise<Response> {
    return handleAgentRpc(this as unknown as Record<string, unknown>, request);
  }

  @callable({ description: "Generate pricing recommendations from latest model predictions" })
  async generateRecommendations(): Promise<{ generated: number }> {
    return await this.keepAliveWhile(async () => {
      const rows = await this.env.DB.prepare(
        `SELECT mp.card_id, mp.grade, mp.grading_company, mp.fair_value,
                mp.buy_threshold, mp.sell_threshold, mp.confidence, mp.volume_bucket,
                cc.name,
                (SELECT price_usd FROM price_observations
                 WHERE card_id = mp.card_id AND grading_company = mp.grading_company AND grade = mp.grade
                   AND is_anomaly = 0
                 ORDER BY sale_date DESC LIMIT 1) as latest_price
         FROM model_predictions mp
         JOIN card_catalog cc ON cc.id = mp.card_id
         WHERE mp.fair_value > 10 AND mp.confidence IN ('HIGH', 'MEDIUM')
         ORDER BY mp.predicted_at DESC`
      ).bind().all();

      const newRecs: Recommendation[] = [];

      for (const row of rows.results) {
        const fairValue = row.fair_value as number;
        const latestPrice = row.latest_price as number | null;
        const sellThreshold = row.sell_threshold as number;
        const confidence = row.confidence as "HIGH" | "MEDIUM" | "LOW";
        const nrv = computeNrv(fairValue);
        const maxBuyPrice = nrv * (1 - REQUIRED_MARGIN);

        if (!latestPrice) continue;

        // Skip if already pending for same card+grade+company
        if (this.state.pending.some((p) =>
          p.cardId === row.card_id && p.grade === row.grade && p.gradingCompany === row.grading_company
        )) continue;

        let action: Recommendation["action"] | null = null;
        let recommendedPrice = latestPrice;
        let reasoning = "";

        if (latestPrice < maxBuyPrice && confidence !== "LOW") {
          action = "BUY";
          recommendedPrice = latestPrice;
          reasoning = `Market $${latestPrice.toFixed(2)} < max buy $${maxBuyPrice.toFixed(2)}. NRV: $${nrv.toFixed(2)}, expected ${(((nrv - latestPrice) / nrv) * 100).toFixed(1)}% margin.`;
        } else if (latestPrice > sellThreshold) {
          action = "SELL";
          recommendedPrice = fairValue;
          reasoning = `Market $${latestPrice.toFixed(2)} > sell threshold $${sellThreshold.toFixed(2)}. Lock in gains.`;
        } else if (latestPrice > nrv * 0.95 && latestPrice < nrv * 1.05) {
          action = "REPRICE";
          recommendedPrice = fairValue;
          reasoning = `Price $${latestPrice.toFixed(2)} near breakeven (NRV: $${nrv.toFixed(2)}). Reprice to $${fairValue.toFixed(2)}.`;
        }

        if (!action) continue;

        const margin = action === "BUY"
          ? ((nrv - latestPrice) / nrv) * 100
          : action === "SELL"
            ? ((latestPrice - fairValue) / fairValue) * 100
            : 0;

        newRecs.push({
          id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          cardId: row.card_id as string,
          cardName: row.name as string,
          grade: row.grade as string,
          gradingCompany: row.grading_company as string,
          action,
          currentPrice: latestPrice,
          recommendedPrice: Math.round(recommendedPrice * 100) / 100,
          fairValue,
          nrv: Math.round(nrv * 100) / 100,
          expectedMargin: Math.round(margin * 10) / 10,
          confidence,
          reasoning,
          status: "pending",
          createdAt: new Date().toISOString(),
          resolvedAt: null,
          resolvedBy: null,
        });
      }

      const sorted = newRecs.sort((a, b) => Math.abs(b.expectedMargin) - Math.abs(a.expectedMargin)).slice(0, 50);

      this.setState({
        ...this.state,
        pending: [...sorted, ...this.state.pending].slice(0, 100),
        lastGeneratedAt: new Date().toISOString(),
        stats: { ...this.state.stats, totalGenerated: this.state.stats.totalGenerated + sorted.length },
      });

      return { generated: sorted.length };
    });
  }

  @callable({ description: "Approve a pending recommendation" })
  approveRecommendation(id: string, approvedBy: string = "dashboard"): Recommendation | null {
    const idx = this.state.pending.findIndex((r) => r.id === id);
    if (idx === -1) return null;

    const rec: Recommendation = {
      ...this.state.pending[idx],
      status: "approved",
      resolvedAt: new Date().toISOString(),
      resolvedBy: approvedBy,
    };

    this.setState({
      ...this.state,
      pending: this.state.pending.filter((_, i) => i !== idx),
      history: [rec, ...this.state.history].slice(0, 200),
      stats: { ...this.state.stats, totalApproved: this.state.stats.totalApproved + 1 },
    });

    return rec;
  }

  @callable({ description: "Reject a pending recommendation" })
  rejectRecommendation(id: string, rejectedBy: string = "dashboard"): Recommendation | null {
    const idx = this.state.pending.findIndex((r) => r.id === id);
    if (idx === -1) return null;

    const rec: Recommendation = {
      ...this.state.pending[idx],
      status: "rejected",
      resolvedAt: new Date().toISOString(),
      resolvedBy: rejectedBy,
    };

    this.setState({
      ...this.state,
      pending: this.state.pending.filter((_, i) => i !== idx),
      history: [rec, ...this.state.history].slice(0, 200),
      stats: { ...this.state.stats, totalRejected: this.state.stats.totalRejected + 1 },
    });

    return rec;
  }

  @callable({ description: "Get all pending recommendations, optionally filtered by action" })
  getPending(action?: "BUY" | "SELL" | "REPRICE"): Recommendation[] {
    if (action) return this.state.pending.filter((r) => r.action === action);
    return this.state.pending;
  }

  @callable({ description: "Get approval/rejection history" })
  getHistory(limit: number = 20): Recommendation[] {
    return this.state.history.slice(0, limit);
  }

  @callable({ description: "Get agent status and stats" })
  getStatus() {
    return {
      pendingCount: this.state.pending.length,
      pendingByAction: {
        buy: this.state.pending.filter((r) => r.action === "BUY").length,
        sell: this.state.pending.filter((r) => r.action === "SELL").length,
        reprice: this.state.pending.filter((r) => r.action === "REPRICE").length,
      },
      lastGenerated: this.state.lastGeneratedAt,
      stats: this.state.stats,
    };
  }

  async expireStaleRecommendations() {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const expired = this.state.pending.filter((r) => r.createdAt < cutoff);
    if (expired.length === 0) return;

    const expiredRecords: Recommendation[] = expired.map((r) => ({
      ...r,
      status: "expired",
      resolvedAt: new Date().toISOString(),
    }));

    this.setState({
      ...this.state,
      pending: this.state.pending.filter((r) => r.createdAt >= cutoff),
      history: [...expiredRecords, ...this.state.history].slice(0, 200),
      stats: { ...this.state.stats, totalExpired: this.state.stats.totalExpired + expired.length },
    });
  }
}
