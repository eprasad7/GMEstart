import type { Env } from "../types";

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
    engagement: number; // upvotes/likes
  };
}

/**
 * Process batched price observations from the ingestion queue.
 */
export async function handleIngestionQueue(
  batch: MessageBatch,
  env: Env
): Promise<void> {
  const stmt = env.DB.prepare(
    `INSERT INTO price_observations (card_id, source, price_usd, sale_date, grade, grading_company, grade_numeric, sale_type, listing_url, seller_id, bid_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const inserts = [];

  for (const msg of batch.messages) {
    const { type, data } = msg.body as IngestionMessage;
    if (type !== "price_observation") {
      msg.ack();
      continue;
    }

    // Apply data quality filters before inserting
    if (data.price_usd <= 0 || data.price_usd > 1_000_000) {
      msg.ack();
      continue;
    }

    // Best Offer adjustment — flag for downstream handling
    let adjustedPrice = data.price_usd;
    let saleType = data.sale_type;
    if (data.sale_type === "best_offer") {
      // Apply 80% discount factor as documented in the spec
      adjustedPrice = data.price_usd * 0.80;
    }

    inserts.push(
      stmt.bind(
        data.card_id,
        data.source,
        adjustedPrice,
        data.sale_date,
        data.grade,
        data.grading_company,
        data.grade_numeric,
        saleType,
        data.listing_url,
        data.seller_id,
        data.bid_count
      )
    );

    msg.ack();
  }

  if (inserts.length > 0) {
    await env.DB.batch(inserts);
  }
}

/**
 * Process social media posts for sentiment analysis via Workers AI.
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
      // Use Workers AI for sentiment classification
      const result = await env.AI.run("@cf/huggingface/distilbert-sst-2-int8", {
        text: data.text,
      });

      // Map to -1 to 1 scale
      const label = (result as { label: string; score: number }[])?.[0];
      const score = label
        ? label.label === "POSITIVE"
          ? label.score
          : -label.score
        : 0;

      // Insert individual sentiment observation (raw data).
      // The hourly rollup job aggregates these into 24h/7d/30d buckets.
      const today = new Date().toISOString().split("T")[0];
      await env.DB.prepare(
        `INSERT INTO sentiment_raw (card_id, source, score, post_url, engagement, observed_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`
      )
        .bind(data.card_id, data.source, score, data.post_url, data.engagement)
        .run();
    } catch (err) {
      console.error("Sentiment analysis failed:", err);
    }

    msg.ack();
  }
}
