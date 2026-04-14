import { Agent, callable } from "agents";
import type { Env } from "../types";

/**
 * PricingRecommendationAgent — generates buy/sell recommendations
 * with a human approval queue.
 *
 * Daily workflow:
 * 1. Scan model predictions for actionable opportunities
 * 2. Generate structured recommendations with reasoning
 * 3. Queue for human approval (no auto-execution above thresholds)
 * 4. Track approval/rejection history for feedback loop
 *
 * The agent maintains a queue of pending recommendations that
 * human operators can approve or reject via the dashboard.
 */

interface Recommendation {
  id: string;
  cardId: string;
  cardName: string;
  grade: string;
  gradingCompany: string;
  action: "BUY" | "SELL" | "REPRICE" | "HOLD";
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
    stats: {
      totalGenerated: 0,
      totalApproved: 0,
      totalRejected: 0,
      totalExpired: 0,
    },
  };

  async onStart() {
    // Generate recommendations daily at 8am (after predictions at 6am, market intel at 7am)
    await this.schedule("0 8 * * *", "generateRecommendations");
    // Expire stale recommendations every 6 hours
    await this.scheduleEvery(21600, "expireStaleRecommendations");
  }

  @callable({ description: "Generate pricing recommendations from latest predictions" })
  async generateRecommendations(): Promise<{ generated: number }> {
    // Find cards with strong buy signals (price well below NRV-based threshold)
    const buyOpportunities = await this.env.DB.prepare(
      `SELECT mp.card_id, mp.grade, mp.grading_company, mp.fair_value,
              mp.buy_threshold, mp.sell_threshold, mp.confidence, mp.volume_bucket,
              cc.name,
              (SELECT price_usd FROM price_observations
               WHERE card_id = mp.card_id AND grading_company = mp.grading_company AND grade = mp.grade
                 AND is_anomaly = 0
               ORDER BY sale_date DESC LIMIT 1) as latest_price
       FROM model_predictions mp
       JOIN card_catalog cc ON cc.id = mp.card_id
       WHERE mp.fair_value > 10
         AND mp.confidence IN ('HIGH', 'MEDIUM')
       ORDER BY mp.predicted_at DESC`
    ).bind().all();

    const newRecommendations: Recommendation[] = [];

    for (const row of buyOpportunities.results) {
      const fairValue = row.fair_value as number;
      const latestPrice = row.latest_price as number | null;
      const buyThreshold = row.buy_threshold as number;
      const sellThreshold = row.sell_threshold as number;
      const confidence = row.confidence as "HIGH" | "MEDIUM" | "LOW";
      const nrv = computeNrv(fairValue);
      const maxBuyPrice = nrv * (1 - REQUIRED_MARGIN);

      if (!latestPrice) continue;

      let action: Recommendation["action"] = "HOLD";
      let recommendedPrice = latestPrice;
      let reasoning = "";

      if (latestPrice < maxBuyPrice && confidence !== "LOW") {
        action = "BUY";
        recommendedPrice = latestPrice;
        const margin = ((nrv - latestPrice) / nrv) * 100;
        reasoning = `Market price $${latestPrice.toFixed(2)} is below max buy price $${maxBuyPrice.toFixed(2)}. NRV: $${nrv.toFixed(2)}, expected ${margin.toFixed(1)}% net margin.`;
      } else if (latestPrice > sellThreshold) {
        action = "SELL";
        recommendedPrice = fairValue;
        reasoning = `Market price $${latestPrice.toFixed(2)} exceeds sell threshold $${sellThreshold.toFixed(2)}. Consider selling to lock in gains.`;
      } else if (latestPrice > nrv * 0.95 && latestPrice < nrv * 1.05) {
        // Price near NRV — might need repricing
        action = "REPRICE";
        recommendedPrice = fairValue;
        reasoning = `Current price $${latestPrice.toFixed(2)} is near breakeven (NRV: $${nrv.toFixed(2)}). Consider repricing to $${fairValue.toFixed(2)} for better margin.`;
      }

      if (action === "HOLD") continue;

      // Check if we already have a pending recommendation for this card
      const existing = this.state.pending.find(
        (p) => p.cardId === row.card_id && p.grade === row.grade && p.gradingCompany === row.grading_company
      );
      if (existing) continue;

      const margin = action === "BUY"
        ? ((nrv - latestPrice) / nrv) * 100
        : action === "SELL"
          ? ((latestPrice - fairValue) / fairValue) * 100
          : 0;

      newRecommendations.push({
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

    // Keep only the top 50 most actionable
    const sorted = newRecommendations
      .sort((a, b) => Math.abs(b.expectedMargin) - Math.abs(a.expectedMargin))
      .slice(0, 50);

    this.setState({
      ...this.state,
      pending: [...sorted, ...this.state.pending].slice(0, 100),
      lastGeneratedAt: new Date().toISOString(),
      stats: {
        ...this.state.stats,
        totalGenerated: this.state.stats.totalGenerated + sorted.length,
      },
    });

    return { generated: sorted.length };
  }

  @callable({ description: "Approve a recommendation" })
  approveRecommendation(id: string, approvedBy: string): Recommendation | null {
    const idx = this.state.pending.findIndex((r) => r.id === id);
    if (idx === -1) return null;

    const rec = {
      ...this.state.pending[idx],
      status: "approved" as const,
      resolvedAt: new Date().toISOString(),
      resolvedBy: approvedBy,
    };

    const pending = this.state.pending.filter((_, i) => i !== idx);
    const history = [rec, ...this.state.history].slice(0, 200);

    this.setState({
      ...this.state,
      pending,
      history,
      stats: {
        ...this.state.stats,
        totalApproved: this.state.stats.totalApproved + 1,
      },
    });

    return rec;
  }

  @callable({ description: "Reject a recommendation" })
  rejectRecommendation(id: string, rejectedBy: string): Recommendation | null {
    const idx = this.state.pending.findIndex((r) => r.id === id);
    if (idx === -1) return null;

    const rec = {
      ...this.state.pending[idx],
      status: "rejected" as const,
      resolvedAt: new Date().toISOString(),
      resolvedBy: rejectedBy,
    };

    const pending = this.state.pending.filter((_, i) => i !== idx);
    const history = [rec, ...this.state.history].slice(0, 200);

    this.setState({
      ...this.state,
      pending,
      history,
      stats: {
        ...this.state.stats,
        totalRejected: this.state.stats.totalRejected + 1,
      },
    });

    return rec;
  }

  @callable({ description: "Get all pending recommendations" })
  getPending(action?: "BUY" | "SELL" | "REPRICE"): Recommendation[] {
    if (action) return this.state.pending.filter((r) => r.action === action);
    return this.state.pending;
  }

  @callable({ description: "Get approval history" })
  getHistory(limit: number = 20): Recommendation[] {
    return this.state.history.slice(0, limit);
  }

  @callable({ description: "Get agent stats" })
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

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, "");

    switch (path) {
      case "getStatus":
        return Response.json(this.getStatus());
      case "getPending": {
        const body = request.method === "POST" ? await request.json() as { action?: "BUY" | "SELL" | "REPRICE" } : {};
        return Response.json(this.getPending(body.action));
      }
      case "getHistory": {
        const body = request.method === "POST" ? await request.json() as { limit?: number } : {};
        return Response.json(this.getHistory(body.limit));
      }
      case "generateRecommendations":
        return Response.json(await this.generateRecommendations());
      case "approveRecommendation": {
        const body = await request.json() as { id: string; approvedBy: string };
        return Response.json(this.approveRecommendation(body.id, body.approvedBy));
      }
      case "rejectRecommendation": {
        const body = await request.json() as { id: string; rejectedBy: string };
        return Response.json(this.rejectRecommendation(body.id, body.rejectedBy));
      }
      default:
        return Response.json({ error: "Unknown method" }, { status: 404 });
    }
  }

  async expireStaleRecommendations() {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - 48);
    const cutoffStr = cutoff.toISOString();

    const expired = this.state.pending.filter((r) => r.createdAt < cutoffStr);
    const remaining = this.state.pending.filter((r) => r.createdAt >= cutoffStr);

    if (expired.length > 0) {
      const expiredRecords = expired.map((r) => ({
        ...r,
        status: "expired" as const,
        resolvedAt: new Date().toISOString(),
      }));

      this.setState({
        ...this.state,
        pending: remaining,
        history: [...expiredRecords, ...this.state.history].slice(0, 200),
        stats: {
          ...this.state.stats,
          totalExpired: this.state.stats.totalExpired + expired.length,
        },
      });
    }
  }
}
