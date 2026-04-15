import type { Env } from "../../types";

interface GameStopInternalSnapshotRow {
  card_id: string;
  snapshot_date?: string;
  trade_in_count?: number;
  avg_trade_in_price?: number;
  inventory_units?: number;
  store_views?: number;
  foot_traffic_index?: number;
}

interface PartnerPriceRow {
  card_id: string;
  price_usd: number;
  sale_date: string;
  grade?: string;
  grading_company?: string;
  sale_type?: string;
  listing_url?: string;
}

export async function importGameStopInternalSnapshot(
  env: Env,
  objectKey = "imports/gamestop_internal/latest.json"
): Promise<number> {
  const obj = await env.DATA_ARCHIVE.get(objectKey);
  if (!obj) {
    throw new Error(`Missing R2 object: ${objectKey}`);
  }

  const rows = (await obj.json()) as GameStopInternalSnapshotRow[];
  if (!Array.isArray(rows)) {
    throw new Error("Expected GameStop internal snapshot to be a JSON array.");
  }

  const BATCH_SIZE = 90;
  const stmt = env.DB.prepare(
    `INSERT INTO gamestop_internal_metrics
       (card_id, snapshot_date, trade_in_count, avg_trade_in_price, inventory_units, store_views, foot_traffic_index)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(card_id, snapshot_date) DO UPDATE SET
       trade_in_count = excluded.trade_in_count,
       avg_trade_in_price = excluded.avg_trade_in_price,
       inventory_units = excluded.inventory_units,
       store_views = excluded.store_views,
       foot_traffic_index = excluded.foot_traffic_index`
  );

  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE).map((row) =>
      stmt.bind(
        row.card_id,
        row.snapshot_date || new Date().toISOString().split("T")[0],
        row.trade_in_count || 0,
        row.avg_trade_in_price || 0,
        row.inventory_units || 0,
        row.store_views || 0,
        row.foot_traffic_index || 0
      )
    );
    await env.DB.batch(chunk);
    inserted += chunk.length;
  }

  return inserted;
}

export async function importPartnerPriceSnapshot(
  env: Env,
  source: "ebay" | "tcgplayer",
  objectKey: string
): Promise<number> {
  const obj = await env.DATA_ARCHIVE.get(objectKey);
  if (!obj) {
    throw new Error(`Missing R2 object: ${objectKey}`);
  }

  const rows = (await obj.json()) as PartnerPriceRow[];
  if (!Array.isArray(rows)) {
    throw new Error("Expected partner price snapshot to be a JSON array.");
  }

  let count = 0;
  for (const row of rows) {
    if (!row.card_id || !row.price_usd || !row.sale_date) {
      continue;
    }

    await env.INGESTION_QUEUE.send({
      type: "price_observation",
      data: {
        card_id: row.card_id,
        source,
        price_usd: row.price_usd,
        sale_date: row.sale_date,
        grade: row.grade || "RAW",
        grading_company: row.grading_company || "RAW",
        grade_numeric: row.grade && row.grade !== "RAW" ? parseFloat(row.grade) : null,
        sale_type: row.sale_type || "fixed",
        listing_url: row.listing_url || null,
        seller_id: null,
        bid_count: null,
      },
    });
    count++;
  }

  return count;
}
