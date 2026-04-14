import { Agent, callable } from "agents";
import type { Env } from "../types";

/**
 * MarketIntelligenceAgent — generates AI-powered daily market summaries.
 *
 * Every day at 7am, after all data pipelines have run:
 * - Aggregates market movements across categories
 * - Identifies top movers, emerging trends, and notable events
 * - Uses Workers AI to generate a natural language market report
 * - Stores reports for dashboard consumption
 */

interface MarketReport {
  id: string;
  date: string;
  summary: string;
  highlights: Array<{
    category: string;
    title: string;
    detail: string;
    impact: "positive" | "negative" | "neutral";
  }>;
  topGainers: Array<{ name: string; changePct: number }>;
  topDecliners: Array<{ name: string; changePct: number }>;
  marketSentiment: "bullish" | "bearish" | "neutral";
  generatedAt: string;
}

interface IntelligenceState {
  reports: MarketReport[];
  lastGeneratedAt: string | null;
  totalReports: number;
}

export class MarketIntelligenceAgent extends Agent<Env, IntelligenceState> {
  initialState: IntelligenceState = {
    reports: [],
    lastGeneratedAt: null,
    totalReports: 0,
  };

  async onStart() {
    // Generate daily report at 7am (after all pipeline crons complete)
    await this.schedule("0 7 * * *", "generateDailyReport");
  }

  @callable({ description: "Generate a market intelligence report now" })
  async generateDailyReport(): Promise<MarketReport> {
    // Gather market data
    const [moversUp, moversDown, alertSummary, sentimentSummary, volumeStats] = await Promise.all([
      this.getTopMovers("up"),
      this.getTopMovers("down"),
      this.getAlertSummary(),
      this.getSentimentSummary(),
      this.getVolumeStats(),
    ]);

    // Build context for AI summary
    const context = `
Market Data for ${new Date().toLocaleDateString()}:

TOP GAINERS (7d):
${moversUp.map((m) => `- ${m.name}: +${m.changePct.toFixed(1)}% ($${m.recentAvg.toFixed(2)})`).join("\n")}

TOP DECLINERS (7d):
${moversDown.map((m) => `- ${m.name}: ${m.changePct.toFixed(1)}% ($${m.recentAvg.toFixed(2)})`).join("\n")}

ACTIVE ALERTS: ${alertSummary.total} (${alertSummary.spikes} spikes, ${alertSummary.crashes} crashes, ${alertSummary.viral} viral)

SENTIMENT: Overall score ${sentimentSummary.avgScore.toFixed(2)} (${sentimentSummary.totalMentions} mentions in 7d)
Top mentioned: ${sentimentSummary.topMentioned.join(", ")}

VOLUME: ${volumeStats.totalSales7d} sales in last 7d (${volumeStats.trend})
`.trim();

    // Generate AI summary
    const aiResult = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        {
          role: "system",
          content: `You are a collectibles market analyst for GameStop. Write a concise daily market briefing (3-4 paragraphs) covering price movements, emerging trends, and notable events. Be specific about card names and percentages. Use a professional but accessible tone. End with a 1-sentence market outlook.`,
        },
        { role: "user", content: context },
      ],
      max_tokens: 500,
    });

    const summary = (aiResult as { response: string }).response || "Market report unavailable.";

    // Determine overall sentiment
    const marketSentiment: MarketReport["marketSentiment"] =
      sentimentSummary.avgScore > 0.2 ? "bullish" :
      sentimentSummary.avgScore < -0.2 ? "bearish" : "neutral";

    // Build highlights
    const highlights: MarketReport["highlights"] = [];

    if (moversUp.length > 0) {
      highlights.push({
        category: "pokemon",
        title: `${moversUp[0].name} leads gainers`,
        detail: `+${moversUp[0].changePct.toFixed(1)}% over 7 days`,
        impact: "positive",
      });
    }
    if (moversDown.length > 0) {
      highlights.push({
        category: "sports",
        title: `${moversDown[0].name} leads decliners`,
        detail: `${moversDown[0].changePct.toFixed(1)}% over 7 days`,
        impact: "negative",
      });
    }
    if (alertSummary.viral > 0) {
      highlights.push({
        category: "social",
        title: `${alertSummary.viral} viral events detected`,
        detail: "Social mention spikes may drive short-term price action",
        impact: "neutral",
      });
    }

    const report: MarketReport = {
      id: `report-${Date.now()}`,
      date: new Date().toISOString().split("T")[0],
      summary,
      highlights,
      topGainers: moversUp.map((m) => ({ name: m.name, changePct: m.changePct })),
      topDecliners: moversDown.map((m) => ({ name: m.name, changePct: m.changePct })),
      marketSentiment,
      generatedAt: new Date().toISOString(),
    };

    // Keep last 30 reports
    const reports = [report, ...this.state.reports].slice(0, 30);

    this.setState({
      reports,
      lastGeneratedAt: report.generatedAt,
      totalReports: this.state.totalReports + 1,
    });

    return report;
  }

  @callable({ description: "Get the latest market report" })
  getLatestReport(): MarketReport | null {
    return this.state.reports[0] || null;
  }

  @callable({ description: "Get report history" })
  getReportHistory(count: number = 7): MarketReport[] {
    return this.state.reports.slice(0, count);
  }

  @callable({ description: "Get agent status" })
  getStatus() {
    return {
      lastGenerated: this.state.lastGeneratedAt,
      totalReports: this.state.totalReports,
      reportsStored: this.state.reports.length,
    };
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, "");

    switch (path) {
      case "getLatestReport":
        return Response.json(this.getLatestReport());
      case "getReportHistory": {
        const body = request.method === "POST" ? await request.json() as { count?: number } : {};
        return Response.json(this.getReportHistory(body.count));
      }
      case "generateDailyReport":
        return Response.json(await this.generateDailyReport());
      case "getStatus":
        return Response.json(this.getStatus());
      default:
        return Response.json({ error: "Unknown method" }, { status: 404 });
    }
  }

  private async getTopMovers(direction: "up" | "down") {
    const orderDir = direction === "down" ? "ASC" : "DESC";
    const result = await this.env.DB.prepare(
      `SELECT po.card_id, cc.name,
              AVG(CASE WHEN po.sale_date >= date('now', '-7 days') THEN po.price_usd END) as recent_avg,
              AVG(CASE WHEN po.sale_date < date('now', '-7 days') AND po.sale_date >= date('now', '-14 days') THEN po.price_usd END) as prior_avg
       FROM price_observations po
       JOIN card_catalog cc ON cc.id = po.card_id
       WHERE po.sale_date >= date('now', '-14 days') AND po.is_anomaly = 0
       GROUP BY po.card_id
       HAVING recent_avg IS NOT NULL AND prior_avg IS NOT NULL AND prior_avg > 0
       ORDER BY (recent_avg - prior_avg) / prior_avg ${orderDir}
       LIMIT 5`
    ).bind().all();

    return result.results.map((r) => ({
      name: r.name as string,
      recentAvg: r.recent_avg as number,
      changePct: (((r.recent_avg as number) - (r.prior_avg as number)) / (r.prior_avg as number)) * 100,
    }));
  }

  private async getAlertSummary() {
    const result = await this.env.DB.prepare(
      `SELECT alert_type, COUNT(*) as cnt
       FROM price_alerts WHERE is_active = 1
       GROUP BY alert_type`
    ).bind().all();

    const counts: Record<string, number> = {};
    for (const r of result.results) {
      counts[r.alert_type as string] = r.cnt as number;
    }

    return {
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      spikes: counts["price_spike"] || 0,
      crashes: counts["price_crash"] || 0,
      viral: counts["viral_social"] || 0,
    };
  }

  private async getSentimentSummary() {
    const result = await this.env.DB.prepare(
      `SELECT AVG(score) as avg_score, SUM(mention_count) as total_mentions
       FROM sentiment_scores WHERE period = '7d'
         AND rollup_date = (SELECT MAX(rollup_date) FROM sentiment_scores WHERE period = '7d')`
    ).bind().first();

    const topMentioned = await this.env.DB.prepare(
      `SELECT cc.name FROM sentiment_scores ss
       JOIN card_catalog cc ON cc.id = ss.card_id
       WHERE ss.period = '7d'
       ORDER BY ss.mention_count DESC LIMIT 5`
    ).bind().all();

    return {
      avgScore: (result?.avg_score as number) || 0,
      totalMentions: (result?.total_mentions as number) || 0,
      topMentioned: topMentioned.results.map((r) => r.name as string),
    };
  }

  private async getVolumeStats() {
    const result = await this.env.DB.prepare(
      `SELECT
         COUNT(CASE WHEN sale_date >= date('now', '-7 days') THEN 1 END) as sales_7d,
         COUNT(CASE WHEN sale_date >= date('now', '-14 days') AND sale_date < date('now', '-7 days') THEN 1 END) as sales_prior_7d
       FROM price_observations WHERE is_anomaly = 0 AND sale_date >= date('now', '-14 days')`
    ).bind().first();

    const current = (result?.sales_7d as number) || 0;
    const prior = (result?.sales_prior_7d as number) || 0;
    const trend = prior > 0
      ? current > prior * 1.1 ? "increasing" : current < prior * 0.9 ? "decreasing" : "stable"
      : "insufficient data";

    return { totalSales7d: current, trend };
  }
}
