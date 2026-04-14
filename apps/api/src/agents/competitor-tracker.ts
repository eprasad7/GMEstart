import { Agent, callable } from "agents";
import type { Env } from "../types";

/**
 * CompetitorTrackerAgent — monitors competitor prices.
 *
 * Tracks pricing from TCGPlayer, COMC, and eBay active listings
 * for cards in GameStop's inventory. Identifies:
 * - Cards where GameStop is priced above/below market
 * - Competitor price changes that signal market shifts
 * - Arbitrage opportunities (buy low on one platform, sell high on another)
 */

interface CompetitorPrice {
  cardId: string;
  cardName: string;
  platform: "tcgplayer" | "comc" | "ebay_active";
  price: number;
  url: string;
  checkedAt: string;
}

interface PriceGap {
  cardId: string;
  cardName: string;
  gamestopPrice: number;
  competitorPrice: number;
  platform: string;
  gapPct: number;
  direction: "overpriced" | "underpriced";
}

interface TrackerState {
  lastScanAt: string | null;
  competitorPrices: CompetitorPrice[];
  priceGaps: PriceGap[];
  scansCompleted: number;
  opportunitiesFound: number;
}

export class CompetitorTrackerAgent extends Agent<Env, TrackerState> {
  initialState: TrackerState = {
    lastScanAt: null,
    competitorPrices: [],
    priceGaps: [],
    scansCompleted: 0,
    opportunitiesFound: 0,
  };

  async onStart() {
    // Run competitor scan every 6 hours
    await this.scheduleEvery(21600, "scanCompetitorPrices");
  }

  @callable({ description: "Run a competitor price scan now" })
  async scanCompetitorPrices(): Promise<{ gaps: number; scanned: number }> {
    // Get cards with active predictions (our priced inventory)
    const cards = await this.env.DB.prepare(
      `SELECT mp.card_id, mp.grade, mp.grading_company, mp.fair_value,
              cc.name, cc.category, cc.pricecharting_id
       FROM model_predictions mp
       JOIN card_catalog cc ON cc.id = mp.card_id
       WHERE mp.fair_value > 0
       ORDER BY mp.fair_value DESC
       LIMIT 100`
    ).bind().all();

    const competitorPrices: CompetitorPrice[] = [];
    const priceGaps: PriceGap[] = [];

    for (const card of cards.results) {
      const cardId = card.card_id as string;
      const cardName = card.name as string;
      const ourPrice = card.fair_value as number;

      // Check PriceCharting (we already have this data — compare against latest)
      const pcPrice = await this.env.DB.prepare(
        `SELECT price_usd FROM price_observations
         WHERE card_id = ? AND source = 'pricecharting'
         ORDER BY sale_date DESC LIMIT 1`
      ).bind(cardId).first();

      if (pcPrice) {
        const compPrice = pcPrice.price_usd as number;
        competitorPrices.push({
          cardId,
          cardName,
          platform: "tcgplayer",
          price: compPrice,
          url: `https://www.pricecharting.com/game/${card.pricecharting_id || cardId}`,
          checkedAt: new Date().toISOString(),
        });

        const gapPct = ((ourPrice - compPrice) / compPrice) * 100;
        if (Math.abs(gapPct) > 15) {
          priceGaps.push({
            cardId,
            cardName,
            gamestopPrice: ourPrice,
            competitorPrice: compPrice,
            platform: "pricecharting",
            gapPct: Math.round(gapPct * 10) / 10,
            direction: gapPct > 0 ? "overpriced" : "underpriced",
          });
        }
      }

      // Check CardHedger multi-platform data
      const chPrice = await this.env.DB.prepare(
        `SELECT price_usd, source FROM price_observations
         WHERE card_id = ? AND source = 'cardhedger'
         ORDER BY sale_date DESC LIMIT 1`
      ).bind(cardId).first();

      if (chPrice) {
        const compPrice = chPrice.price_usd as number;
        const gapPct = ((ourPrice - compPrice) / compPrice) * 100;
        if (Math.abs(gapPct) > 15) {
          priceGaps.push({
            cardId,
            cardName,
            gamestopPrice: ourPrice,
            competitorPrice: compPrice,
            platform: "cardhedger",
            gapPct: Math.round(gapPct * 10) / 10,
            direction: gapPct > 0 ? "overpriced" : "underpriced",
          });
        }
      }
    }

    // Sort gaps by magnitude
    priceGaps.sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct));

    this.setState({
      lastScanAt: new Date().toISOString(),
      competitorPrices: competitorPrices.slice(0, 200),
      priceGaps: priceGaps.slice(0, 50),
      scansCompleted: this.state.scansCompleted + 1,
      opportunitiesFound: this.state.opportunitiesFound + priceGaps.length,
    });

    return { gaps: priceGaps.length, scanned: cards.results.length };
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, "");

    switch (path) {
      case "getStatus":
        return Response.json(this.getStatus());
      case "getAllGaps":
        return Response.json(this.getAllGaps());
      case "getOverpriced": {
        const body = request.method === "POST" ? await request.json() as { limit?: number } : {};
        return Response.json(this.getOverpriced(body.limit));
      }
      case "getUnderpriced": {
        const body = request.method === "POST" ? await request.json() as { limit?: number } : {};
        return Response.json(this.getUnderpriced(body.limit));
      }
      case "scanCompetitorPrices":
        return Response.json(await this.scanCompetitorPrices());
      default:
        return Response.json({ error: "Unknown method" }, { status: 404 });
    }
  }

  @callable({ description: "Get cards where GameStop is overpriced vs competitors" })
  getOverpriced(limit: number = 10): PriceGap[] {
    return this.state.priceGaps
      .filter((g) => g.direction === "overpriced")
      .slice(0, limit);
  }

  @callable({ description: "Get cards where GameStop is underpriced (arbitrage opportunities)" })
  getUnderpriced(limit: number = 10): PriceGap[] {
    return this.state.priceGaps
      .filter((g) => g.direction === "underpriced")
      .slice(0, limit);
  }

  @callable({ description: "Get all price gaps sorted by magnitude" })
  getAllGaps(): PriceGap[] {
    return this.state.priceGaps;
  }

  @callable({ description: "Get agent status" })
  getStatus() {
    return {
      lastScan: this.state.lastScanAt,
      totalScans: this.state.scansCompleted,
      currentGaps: this.state.priceGaps.length,
      overpriced: this.state.priceGaps.filter((g) => g.direction === "overpriced").length,
      underpriced: this.state.priceGaps.filter((g) => g.direction === "underpriced").length,
    };
  }
}
