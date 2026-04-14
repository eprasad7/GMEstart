import type { Env } from "../../types";

interface PriceChartingProduct {
  id: string;
  "product-name": string;
  "console-name": string;
  "loose-price"?: number;
  "graded-price"?: number;
  "complete-price"?: number;
  "new-price"?: number;
}

/**
 * Ingest aggregated prices from PriceCharting API.
 * Runs daily at 2am via Cron Trigger.
 *
 * PriceCharting API: https://www.pricecharting.com/api-documentation
 * - 40-char API token
 * - Returns aggregated market prices
 * - ~$15-30/mo at Legendary tier
 */
export async function ingestPriceCharting(env: Env): Promise<number> {
  // Get cards with PriceCharting IDs
  const cards = await env.DB.prepare(
    `SELECT id, name, pricecharting_id, category FROM card_catalog
     WHERE pricecharting_id IS NOT NULL
     ORDER BY updated_at ASC
     LIMIT 100`
  )
    .bind()
    .all();

  let totalIngested = 0;

  for (const card of cards.results) {
    try {
      const pcId = card.pricecharting_id as string;
      const response = await fetch(
        `https://www.pricecharting.com/api/product?t=${env.PRICECHARTING_API_KEY}&id=${pcId}`,
        { headers: { "Content-Type": "application/json" } }
      );

      if (!response.ok) {
        console.error(`PriceCharting API error for ${card.id}: ${response.status}`);
        continue;
      }

      const product = await response.json() as PriceChartingProduct;
      const today = new Date().toISOString().split("T")[0];

      // PriceCharting returns aggregated prices, not individual sales.
      // We store these as "pricecharting" source observations.
      const prices: { grade: string; price: number; grading_company: string }[] = [];

      if (product["graded-price"]) {
        prices.push({
          grade: "10",
          price: product["graded-price"] / 100, // PriceCharting returns cents
          grading_company: "PSA",
        });
      }
      // Use complete-price as the RAW baseline. If unavailable, fall back
      // to loose-price. Never emit both — they would double-count RAW.
      const rawPrice = product["complete-price"] || product["loose-price"];
      if (rawPrice) {
        prices.push({
          grade: "RAW",
          price: rawPrice / 100,
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
            // Include date in URL so daily snapshots aren't deduped by the unique index
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
