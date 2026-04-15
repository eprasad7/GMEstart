import type { Env } from "../../types";

/**
 * Ingest aggregated prices from PriceCharting API.
 * Runs daily at 2am via Cron Trigger.
 *
 * PriceCharting API (verified against real responses):
 *   Search: GET /api/products?t={token}&q={query}&type=card
 *     → { products: [{ id, product-name, console-name, loose-price }] }
 *
 *   Detail: GET /api/product?t={token}&id={id}
 *     → { id, product-name, console-name, loose-price, graded-price, status }
 *
 *   Prices are in CENTS (e.g., 505272 = $5,052.72)
 */

interface PriceChartingProduct {
  id: string;
  "product-name": string;
  "console-name": string;
  "loose-price"?: number;
  "graded-price"?: number;
  "complete-price"?: number;
  status?: string;
}

interface PriceChartingSearchResponse {
  products: PriceChartingProduct[];
}

/** Map PriceCharting console names to our category enum */
function mapCategory(consoleName: string): string {
  const lower = consoleName.toLowerCase();
  if (lower.includes("pokemon")) return "pokemon";
  if (lower.includes("baseball")) return "sports_baseball";
  if (lower.includes("basketball")) return "sports_basketball";
  if (lower.includes("football")) return "sports_football";
  if (lower.includes("hockey")) return "sports_hockey";
  if (lower.includes("magic") || lower.includes("mtg")) return "tcg_mtg";
  if (lower.includes("yu-gi-oh") || lower.includes("yugioh")) return "tcg_yugioh";
  return "other";
}

export async function ingestPriceCharting(env: Env): Promise<number> {
  // Get cards with PriceCharting IDs that need updates
  const cards = await env.DB.prepare(
    `SELECT id, name, pricecharting_id, category FROM card_catalog
     WHERE pricecharting_id IS NOT NULL
     ORDER BY updated_at ASC
     LIMIT 100`
  )
    .bind()
    .all();

  let totalIngested = 0;
  const today = new Date().toISOString().split("T")[0];

  for (const card of cards.results) {
    try {
      const pcId = card.pricecharting_id as string;

      // Fetch product detail
      const response = await fetch(
        `https://www.pricecharting.com/api/product?t=${env.PRICECHARTING_API_KEY}&id=${pcId}`,
        { headers: { "Content-Type": "application/json" } }
      );

      if (!response.ok) {
        console.error(`PriceCharting API error for ${card.id}: ${response.status}`);
        continue;
      }

      const product = await response.json() as PriceChartingProduct;

      // PriceCharting returns prices in CENTS
      const prices: { grade: string; price: number; grading_company: string }[] = [];

      if (product["graded-price"]) {
        prices.push({
          grade: "10",
          price: product["graded-price"] / 100,
          grading_company: "PSA",
        });
      }

      // Use complete-price OR loose-price, never both (avoid double-counting RAW)
      const rawPriceCents = product["complete-price"] || product["loose-price"];
      if (rawPriceCents) {
        prices.push({
          grade: "RAW",
          price: rawPriceCents / 100,
          grading_company: "RAW",
        });
      }

      for (const p of prices) {
        await env.INGESTION_QUEUE.send({
          type: "price_observation",
          data: {
            card_id: card.id as string,
            source: "pricecharting",
            price_usd: p.price,
            sale_date: today,
            grade: p.grade,
            grading_company: p.grading_company,
            grade_numeric: p.grade === "RAW" ? null : parseFloat(p.grade),
            sale_type: "fixed",
            // Include date+grade in URL so daily snapshots bypass dedup index
            listing_url: `https://www.pricecharting.com/game/${pcId}#${today}-${p.grade}`,
            seller_id: null,
            bid_count: null,
          },
        });
        totalIngested++;
      }

      // Update card's updated_at
      await env.DB.prepare(
        `UPDATE card_catalog SET updated_at = datetime('now') WHERE id = ?`
      )
        .bind(card.id)
        .run();
    } catch (err) {
      console.error(`PriceCharting ingestion failed for ${card.id}:`, err);
    }
  }

  return totalIngested;
}

/**
 * Search PriceCharting and auto-create card_catalog entries.
 * Used by the bootstrap flow and for discovering new cards.
 */
export async function searchAndImportCards(
  env: Env,
  query: string,
  limit: number = 25
): Promise<number> {
  const response = await fetch(
    `https://www.pricecharting.com/api/products?t=${env.PRICECHARTING_API_KEY}&q=${encodeURIComponent(query)}&type=card`,
    { headers: { "Content-Type": "application/json" } }
  );

  if (!response.ok) {
    throw new Error(`PriceCharting search failed: ${response.status}`);
  }

  const data = await response.json() as PriceChartingSearchResponse;
  if (!data.products?.length) return 0;

  const BATCH_SIZE = 90;
  const stmt = env.DB.prepare(
    `INSERT INTO card_catalog (id, name, set_name, set_year, card_number, category, pricecharting_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       pricecharting_id = excluded.pricecharting_id,
       updated_at = datetime('now')`
  );

  const stmts = data.products.slice(0, limit).map((p) => {
    const category = mapCategory(p["console-name"]);
    const cardId = `${category}-${p.id}`.toLowerCase().replace(/\s+/g, "-");
    return stmt.bind(
      cardId,
      p["product-name"],
      p["console-name"],
      0,
      "",
      category,
      p.id
    );
  });

  for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
    await env.DB.batch(stmts.slice(i, i + BATCH_SIZE));
  }

  return stmts.length;
}
