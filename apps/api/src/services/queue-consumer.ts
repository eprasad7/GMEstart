import type { Env } from "../types";
import { logEvent } from "../lib/logging";
import { hashSellerId } from "../lib/security";

interface IngestionMessage {
  type: "price_observation";
  data: {
    card_id: string;
    source: string;
    price_usd: number;
    sale_date: string;
    grade: string | null;
    grading_company: string | null;
    grade_numeric: number | null;
    sale_type: string | null;
    listing_url: string | null;
    seller_id: string | null;
    bid_count: number | null;
  };
}

interface SentimentMessage {
  type: "sentiment_analysis";
  data: {
    card_id: string;
    text: string;
    source: "reddit" | "twitter";
    post_url: string;
    engagement: number;
  };
}

const D1_BATCH_LIMIT = 90; // Stay under D1's 100-statement limit

/**
 * Process batched price observations from the ingestion queue.
 * Ack AFTER successful DB write to prevent message loss.
 * Uses INSERT OR IGNORE with listing_url dedup to prevent duplicate observations.
 */
export async function handleIngestionQueue(
  batch: MessageBatch,
  env: Env
): Promise<void> {
  const stmt = env.DB.prepare(
    `INSERT OR IGNORE INTO price_observations
       (card_id, source, price_usd, sale_date, grade, grading_company, grade_numeric, sale_type, listing_url, seller_id, bid_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const inserts: D1PreparedStatement[] = [];
  const pendingMessages: Message[] = [];
  const skippedMessages: Message[] = [];

  for (const msg of batch.messages) {
    const { type, data } = msg.body as IngestionMessage;
    if (type !== "price_observation") {
      skippedMessages.push(msg);
      continue;
    }

    if (data.price_usd <= 0 || data.price_usd > 1_000_000) {
      skippedMessages.push(msg);
      continue;
    }

    // Best Offer adjustment
    let adjustedPrice = data.price_usd;
    if (data.sale_type === "best_offer") {
      adjustedPrice = data.price_usd * 0.80;
    }

    const hashedSellerId = data.seller_id
      ? await hashSellerId(data.seller_id, env.SELLER_HASH_SALT || env.API_KEY)
      : null;

    inserts.push(
      stmt.bind(
        data.card_id,
        data.source,
        adjustedPrice,
        data.sale_date,
        data.grade,
        data.grading_company,
        data.grade_numeric,
        data.sale_type,
        data.listing_url,
        hashedSellerId,
        data.bid_count
      )
    );
    pendingMessages.push(msg);
  }

  // Ack skipped messages immediately (filtered out, not DB-dependent)
  for (const msg of skippedMessages) {
    msg.ack();
  }

  // Write in batches respecting D1 limit, then ack
  for (let i = 0; i < inserts.length; i += D1_BATCH_LIMIT) {
    const chunk = inserts.slice(i, i + D1_BATCH_LIMIT);
    const msgChunk = pendingMessages.slice(i, i + D1_BATCH_LIMIT);

    try {
      await env.DB.batch(chunk);
      // Ack only after successful write
      for (const msg of msgChunk) {
        msg.ack();
      }
    } catch (err) {
      // Don't ack — messages will be retried
      logEvent("error", "ingestion_batch_insert_failed", {
        error: err instanceof Error ? err.message : String(err),
        batchSize: chunk.length,
      });
    }
  }
}

/**
 * Process social media posts for sentiment analysis via Workers AI.
 * Uses INSERT OR IGNORE with post_url dedup to prevent counting the same post twice.
 */
export async function handleSentimentQueue(
  batch: MessageBatch,
  env: Env
): Promise<void> {
  for (const msg of batch.messages) {
    const { type, data } = msg.body as SentimentMessage;
    if (type !== "sentiment_analysis") {
      msg.ack();
      continue;
    }

    try {
      const result = await env.AI.run("@cf/huggingface/distilbert-sst-2-int8", {
        text: data.text,
      });

      const label = (result as { label: string; score: number }[])?.[0];
      const score = label
        ? label.label === "POSITIVE"
          ? label.score
          : -label.score
        : 0;

      // INSERT OR IGNORE — unique on (card_id, source, post_url) prevents
      // the same Reddit post from being counted across multiple 5-min polls
      await env.DB.prepare(
        `INSERT OR IGNORE INTO sentiment_raw (card_id, source, score, post_url, engagement, observed_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`
      )
        .bind(data.card_id, data.source, score, data.post_url, data.engagement)
        .run();

      msg.ack();
    } catch (err) {
      console.error("Sentiment analysis failed:", err);
      // Don't ack — will retry
    }
  }
}
