import type { Env } from "../../types";

interface SoldCompsResult {
  title: string;
  price: number;
  date: string;
  url: string;
  type: string; // "auction", "buy_it_now", "best_offer"
  bids?: number;
  seller?: string;
}

/**
 * Ingest sold listings from SoldComps API (licensed eBay data).
 * Runs every 15 minutes via Cron Trigger.
 *
 * SoldComps API: https://sold-comps.com/
 * - Up to 240 results per request
 * - 365 days of eBay sold data
 * - $59/mo at Scale tier
 */
export async function ingestSoldComps(env: Env): Promise<number> {
  // Get cards that need price updates (prioritize by last update time)
  const cards = await env.DB.prepare(
    `SELECT cc.id, cc.name, cc.category, cc.pricecharting_id
     FROM card_catalog cc
     LEFT JOIN (
       SELECT card_id, MAX(created_at) as last_ingested
       FROM price_observations
       WHERE source = 'soldcomps'
       GROUP BY card_id
     ) po ON po.card_id = cc.id
     ORDER BY po.last_ingested ASC NULLS FIRST
     LIMIT 10`
  )
    .bind()
    .all();

  let totalIngested = 0;

  // Map internal categories to SoldComps API categories
  const categoryMap: Record<string, string> = {
    pokemon: "pokemon_cards",
    sports_baseball: "sports_cards",
    sports_basketball: "sports_cards",
    sports_football: "sports_cards",
    sports_hockey: "sports_cards",
    tcg_mtg: "trading_cards",
    tcg_yugioh: "trading_cards",
    other: "trading_cards",
  };

  for (const card of cards.results) {
    try {
      const searchQuery = card.name as string;
      const soldCompsCategory = categoryMap[card.category as string] || "trading_cards";
      const response = await fetch(
        `https://sold-comps.com/api/v1/search?q=${encodeURIComponent(searchQuery)}&category=${soldCompsCategory}&limit=50`,
        {
          headers: {
            Authorization: `Bearer ${env.SOLDCOMPS_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        console.error(`SoldComps API error for ${card.id}: ${response.status}`);
        continue;
      }

      const data = await response.json() as { results: SoldCompsResult[] };
      if (!data.results?.length) continue;

      // Filter out lot sales and junk
      const validResults = data.results.filter((r) => !isLotSale(r.title));

      // Parse grade from title
      const observations = validResults.map((r) => {
        const gradeInfo = parseGradeFromTitle(r.title);
        return {
          card_id: card.id as string,
          source: "soldcomps" as const,
          price_usd: r.price,
          sale_date: r.date,
          grade: gradeInfo.grade,
          grading_company: gradeInfo.company,
          grade_numeric: gradeInfo.numeric,
          sale_type: mapSaleType(r.type),
          listing_url: r.url,
          seller_id: r.seller || null,
          bid_count: r.bids || null,
        };
      });

      // Batch insert via queue for async processing
      for (const obs of observations) {
        await env.INGESTION_QUEUE.send({
          type: "price_observation",
          data: obs,
        });
      }

      totalIngested += observations.length;
    } catch (err) {
      console.error(`Failed to ingest card ${card.id}:`, err);
    }
  }

  return totalIngested;
}

/**
 * Detect lot/bundle sales that should be excluded from pricing.
 */
function isLotSale(title: string): boolean {
  const lotPatterns = /\b(lot|bundle|collection|set of|x\d+|\d+\s*cards?|bulk|grab bag|mystery)\b/i;
  return lotPatterns.test(title);
}

/**
 * Extract grading company and grade from listing title.
 * Examples:
 *   "Charizard PSA 10 Gem Mint" → { company: "PSA", grade: "10", numeric: 10 }
 *   "Jordan Rookie BGS 9.5" → { company: "BGS", grade: "9.5", numeric: 9.5 }
 *   "Base Set Pikachu Raw" → { company: "RAW", grade: "RAW", numeric: null }
 */
function parseGradeFromTitle(title: string): {
  company: string | null;
  grade: string | null;
  numeric: number | null;
} {
  const gradePatterns = [
    { regex: /\bPSA\s+(\d+\.?\d*)\b/i, company: "PSA" },
    { regex: /\bBGS\s+(\d+\.?\d*)\b/i, company: "BGS" },
    { regex: /\bCGC\s+(\d+\.?\d*)\b/i, company: "CGC" },
    { regex: /\bSGC\s+(\d+\.?\d*)\b/i, company: "SGC" },
  ];

  for (const { regex, company } of gradePatterns) {
    const match = title.match(regex);
    if (match) {
      const numeric = parseFloat(match[1]);
      return { company, grade: match[1], numeric };
    }
  }

  return { company: "RAW", grade: "RAW", numeric: null };
}

function mapSaleType(type: string): string | null {
  const map: Record<string, string> = {
    auction: "auction",
    buy_it_now: "buy_it_now",
    best_offer: "best_offer",
    fixed: "fixed",
  };
  return map[type.toLowerCase()] || null;
}
