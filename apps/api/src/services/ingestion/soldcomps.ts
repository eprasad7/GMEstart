import type { Env } from "../../types";

/**
 * Ingest sold listings from SoldComps API (licensed eBay data).
 * Runs every 15 minutes via Cron Trigger.
 *
 * SoldComps API:
 *   Base: https://api.sold-comps.com
 *   Endpoint: GET /v1/scrape?keyword=...&limit=...
 *   Auth: Bearer token in Authorization header
 *   Response: { keyword, totalItems, hasNextPage, items[] }
 *
 * Each item:
 *   itemId, title, soldPrice (string USD), shippingPrice, endedAt,
 *   url, sellerUsername, sellerFeedbackScore, shippingType, totalPrice
 */

interface SoldCompsResponse {
  keyword: string;
  page: number;
  totalItems: number;
  hasNextPage: boolean;
  items: SoldCompsItem[];
}

interface SoldCompsItem {
  itemId: string;
  title: string;
  soldPrice: string;
  soldCurrency: string;
  shippingPrice: string;
  shippingCurrency: string;
  shippingType: string;
  totalPrice: string;
  endedAt: string;
  url: string;
  sellerUsername: string;
  sellerPositivePercent: number;
  sellerFeedbackScore: number;
  categoryId: string;
}

/** Map internal categories to SoldComps search terms */
const categorySearchTerms: Record<string, string> = {
  pokemon: "pokemon",
  sports_baseball: "baseball card",
  sports_basketball: "basketball card",
  sports_football: "football card",
  sports_hockey: "hockey card",
  tcg_mtg: "magic the gathering",
  tcg_yugioh: "yugioh",
  other: "",
};

export async function ingestSoldComps(env: Env): Promise<number> {
  // Get cards that need price updates (prioritize by last update time)
  const cards = await env.DB.prepare(
    `SELECT cc.id, cc.name, cc.category
     FROM card_catalog cc
     LEFT JOIN (
       SELECT card_id, MAX(created_at) as last_ingested
       FROM price_observations
       WHERE source = 'soldcomps'
       GROUP BY card_id
     ) po ON po.card_id = cc.id
     ORDER BY po.last_ingested ASC NULLS FIRST
     LIMIT 5`
  )
    .bind()
    .all();

  let totalIngested = 0;

  for (const card of cards.results) {
    try {
      const searchQuery = card.name as string;
      const response = await fetch(
        `https://api.sold-comps.com/v1/scrape?keyword=${encodeURIComponent(searchQuery)}&limit=50`,
        {
          headers: {
            Authorization: `Bearer ${env.SOLDCOMPS_API_KEY}`,
          },
        }
      );

      if (!response.ok) {
        console.error(`SoldComps API error for ${card.id}: ${response.status}`);
        continue;
      }

      const data = await response.json() as SoldCompsResponse;
      if (!data.items?.length) continue;

      // Filter out lot sales
      const validResults = data.items.filter((r) => !isLotSale(r.title));

      for (const item of validResults) {
        const gradeInfo = parseGradeFromTitle(item.title);
        const price = parseFloat(item.soldPrice);
        if (isNaN(price) || price <= 0) continue;

        await env.INGESTION_QUEUE.send({
          type: "price_observation",
          data: {
            card_id: card.id as string,
            source: "soldcomps",
            price_usd: price,
            sale_date: item.endedAt.split("T")[0],
            grade: gradeInfo.grade,
            grading_company: gradeInfo.company,
            grade_numeric: gradeInfo.numeric,
            sale_type: inferSaleType(item),
            listing_url: item.url,
            seller_id: item.sellerUsername || null,
            bid_count: null,
          },
        });
        totalIngested++;
      }
    } catch (err) {
      console.error(`Failed to ingest card ${card.id}:`, err);
    }
  }

  return totalIngested;
}

function isLotSale(title: string): boolean {
  return /\b(lot|bundle|collection|set of|x\d+|\d+\s*cards?|bulk|grab bag|mystery)\b/i.test(title);
}

function parseGradeFromTitle(title: string): {
  company: string | null;
  grade: string | null;
  numeric: number | null;
} {
  const patterns = [
    { regex: /\bPSA\s+(\d+\.?\d*)\b/i, company: "PSA" },
    { regex: /\bBGS\s+(\d+\.?\d*)\b/i, company: "BGS" },
    { regex: /\bCGC\s+(\d+\.?\d*)\b/i, company: "CGC" },
    { regex: /\bSGC\s+(\d+\.?\d*)\b/i, company: "SGC" },
  ];

  for (const { regex, company } of patterns) {
    const match = title.match(regex);
    if (match) {
      const numeric = parseFloat(match[1]);
      return { company, grade: match[1], numeric };
    }
  }

  return { company: "RAW", grade: "RAW", numeric: null };
}

function inferSaleType(item: SoldCompsItem): string {
  // SoldComps doesn't explicitly say auction vs BIN,
  // but we can infer from the data
  return "auction"; // Default — SoldComps primarily returns auction data
}
