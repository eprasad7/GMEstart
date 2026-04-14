import { Agent, callable } from "agents";
import type { Env } from "../types";

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
  priceGaps: PriceGap[];
  scansCompleted: number;
  opportunitiesFound: number;
}

export class CompetitorTrackerAgent extends Agent<Env, TrackerState> {
  initialState: TrackerState = {
    lastScanAt: null,
    priceGaps: [],
    scansCompleted: 0,
    opportunitiesFound: 0,
  };

  static options = {
    hibernate: true,
    sendIdentityOnConnect: true,
    retry: { maxAttempts: 3, baseDelayMs: 2000, maxDelayMs: 30000 },
  };

  async onStart() {
    await this.scheduleEvery(21600, "scanCompetitorPrices");
  }

  @callable({ description: "Run a competitor price scan and identify gaps" })
  async scanCompetitorPrices(): Promise<{ gaps: number; scanned: number }> {
    return await this.keepAliveWhile(async () => {
      const cards = await this.env.DB.prepare(
        `SELECT mp.card_id, mp.grade, mp.grading_company, mp.fair_value,
                cc.name, cc.pricecharting_id
         FROM model_predictions mp
         JOIN card_catalog cc ON cc.id = mp.card_id
         WHERE mp.fair_value > 0
         ORDER BY mp.fair_value DESC LIMIT 100`
      ).bind().all();

      const priceGaps: PriceGap[] = [];

      for (const card of cards.results) {
        const cardId = card.card_id as string;
        const cardName = card.name as string;
        const ourPrice = card.fair_value as number;

        const grade = card.grade as string;
        const gradingCompany = card.grading_company as string;

        // Check external sources — filter by grade+grading_company to avoid false gaps
        const externalPrices = await this.env.DB.prepare(
          `SELECT source, price_usd FROM price_observations
           WHERE card_id = ? AND source IN ('pricecharting', 'cardhedger', 'soldcomps')
             AND COALESCE(grade, 'RAW') = ? AND COALESCE(grading_company, 'RAW') = ?
           ORDER BY sale_date DESC LIMIT 3`
        ).bind(cardId, grade, gradingCompany).all();

        for (const ext of externalPrices.results) {
          const compPrice = ext.price_usd as number;
          const gapPct = ((ourPrice - compPrice) / compPrice) * 100;

          if (Math.abs(gapPct) > 15) {
            priceGaps.push({
              cardId,
              cardName,
              gamestopPrice: ourPrice,
              competitorPrice: compPrice,
              platform: ext.source as string,
              gapPct: Math.round(gapPct * 10) / 10,
              direction: gapPct > 0 ? "overpriced" : "underpriced",
            });
          }
        }
      }

      priceGaps.sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct));

      this.setState({
        lastScanAt: new Date().toISOString(),
        priceGaps: priceGaps.slice(0, 50),
        scansCompleted: this.state.scansCompleted + 1,
        opportunitiesFound: this.state.opportunitiesFound + priceGaps.length,
      });

      return { gaps: priceGaps.length, scanned: cards.results.length };
    });
  }

  @callable({ description: "Get cards where GameStop is overpriced vs competitors" })
  getOverpriced(limit: number = 10): PriceGap[] {
    return this.state.priceGaps.filter((g) => g.direction === "overpriced").slice(0, limit);
  }

  @callable({ description: "Get cards where GameStop is underpriced (buy opportunities)" })
  getUnderpriced(limit: number = 10): PriceGap[] {
    return this.state.priceGaps.filter((g) => g.direction === "underpriced").slice(0, limit);
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
