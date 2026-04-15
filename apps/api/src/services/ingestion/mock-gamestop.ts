import type { Env } from "../../types";

/**
 * Generate mock GameStop internal data for demo purposes.
 *
 * Creates realistic-looking trade-in, inventory, and foot traffic data
 * for cards in the catalog. This simulates what GameStop's internal
 * systems would provide in production.
 *
 * Call via POST /v1/system/mock-internal
 */

export async function generateMockInternalData(env: Env): Promise<{ generated: number }> {
  // Get cards from catalog
  const cards = await env.DB.prepare(
    `SELECT id, name, category FROM card_catalog ORDER BY RANDOM() LIMIT 200`
  ).bind().all();

  if (cards.results.length === 0) {
    throw new Error("No cards in catalog. Run /v1/system/seed first.");
  }

  // Ensure the table exists
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS gamestop_internal_metrics (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       card_id TEXT NOT NULL REFERENCES card_catalog(id),
       trade_in_count INTEGER NOT NULL DEFAULT 0,
       avg_trade_in_price REAL NOT NULL DEFAULT 0,
       inventory_units INTEGER NOT NULL DEFAULT 0,
       store_views INTEGER NOT NULL DEFAULT 0,
       foot_traffic_index REAL NOT NULL DEFAULT 0,
       snapshot_date TEXT NOT NULL DEFAULT (date('now')),
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       UNIQUE(card_id, snapshot_date)
     )`
  ).bind().run();

  const BATCH_SIZE = 90;
  const today = new Date().toISOString().split("T")[0];
  let count = 0;

  const stmt = env.DB.prepare(
    `INSERT OR REPLACE INTO gamestop_internal_metrics
       (card_id, trade_in_count, avg_trade_in_price, inventory_units, store_views, foot_traffic_index, snapshot_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const stmts: D1PreparedStatement[] = [];

  for (const card of cards.results) {
    const cardId = card.id as string;
    const category = card.category as string;

    // Get the card's fair value for realistic trade-in pricing
    const prediction = await env.DB.prepare(
      `SELECT fair_value FROM model_predictions WHERE card_id = ? ORDER BY predicted_at DESC LIMIT 1`
    ).bind(cardId).first();

    const fairValue = (prediction?.fair_value as number) || randomBetween(10, 500);

    // Generate realistic metrics
    const isPokemon = category === "pokemon";
    const isSports = category.startsWith("sports_");

    // Trade-in volume: Pokemon cards trade more frequently
    const tradeInCount = Math.floor(
      randomBetween(0, isPokemon ? 8 : isSports ? 4 : 2)
    );

    // Trade-in price: GameStop offers 40-60% of market value for trade-ins
    const tradeInDiscount = randomBetween(0.35, 0.55);
    const avgTradeInPrice = Math.round(fairValue * tradeInDiscount * 100) / 100;

    // Inventory: how many does GameStop have in stock across stores
    const inventoryUnits = Math.floor(randomBetween(0, isPokemon ? 12 : 5));

    // Store views: online page views (correlates with popularity)
    const storeViews = Math.floor(
      randomBetween(10, isPokemon ? 500 : isSports ? 200 : 50) *
      (fairValue > 100 ? 2 : 1) // High-value cards get more views
    );

    // Foot traffic index: normalized 0-1 score for regional demand
    const footTrafficIndex = Math.round(randomBetween(0.1, 0.9) * 100) / 100;

    stmts.push(
      stmt.bind(
        cardId,
        tradeInCount,
        avgTradeInPrice,
        inventoryUnits,
        storeViews,
        footTrafficIndex,
        today
      )
    );
    count++;

    if (stmts.length >= BATCH_SIZE) {
      await env.DB.batch(stmts);
      stmts.length = 0;
    }
  }

  if (stmts.length > 0) {
    await env.DB.batch(stmts);
  }

  // Also generate some mock price observations from "gamestop_internal" source
  // These represent trade-in transactions
  const tradeInStmt = env.DB.prepare(
    `INSERT OR IGNORE INTO price_observations
       (card_id, source, price_usd, sale_date, grade, grading_company, grade_numeric, sale_type, listing_url)
     VALUES (?, 'gamestop_internal', ?, ?, ?, ?, ?, 'fixed', ?)`
  );

  const tradeInStmts: D1PreparedStatement[] = [];

  for (const card of cards.results.slice(0, 50)) {
    const cardId = card.id as string;
    const prediction = await env.DB.prepare(
      `SELECT fair_value FROM model_predictions WHERE card_id = ? ORDER BY predicted_at DESC LIMIT 1`
    ).bind(cardId).first();

    const fairValue = (prediction?.fair_value as number) || randomBetween(10, 200);
    const tradeInPrice = Math.round(fairValue * randomBetween(0.35, 0.55) * 100) / 100;

    // Generate 1-3 trade-in transactions over the past 30 days
    const numTradeIns = Math.floor(randomBetween(1, 4));
    for (let i = 0; i < numTradeIns; i++) {
      const daysAgo = Math.floor(randomBetween(1, 30));
      const date = new Date();
      date.setDate(date.getDate() - daysAgo);
      const dateStr = date.toISOString().split("T")[0];

      tradeInStmts.push(
        tradeInStmt.bind(
          cardId,
          tradeInPrice * randomBetween(0.9, 1.1), // slight variation
          dateStr,
          "RAW",
          "RAW",
          null,
          `gamestop://trade-in/${cardId}/${dateStr}/${i}`
        )
      );

      if (tradeInStmts.length >= BATCH_SIZE) {
        await env.DB.batch(tradeInStmts);
        tradeInStmts.length = 0;
      }
    }
  }

  if (tradeInStmts.length > 0) {
    await env.DB.batch(tradeInStmts);
  }

  return { generated: count };
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
