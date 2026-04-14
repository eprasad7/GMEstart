import { Hono } from "hono";
import type { Env } from "../types";

export const sentimentRoutes = new Hono<{ Bindings: Env }>();

// GET /v1/sentiment/:cardId
sentimentRoutes.get("/:cardId", async (c) => {
  const cardId = c.req.param("cardId");

  // Get the most recent rollup for each source+period combination
  const scores = await c.env.DB.prepare(
    `SELECT s.* FROM sentiment_scores s
     INNER JOIN (
       SELECT card_id, source, period, MAX(rollup_date) as max_date
       FROM sentiment_scores
       WHERE card_id = ?
       GROUP BY card_id, source, period
     ) latest
       ON s.card_id = latest.card_id
       AND s.source = latest.source
       AND s.period = latest.period
       AND s.rollup_date = latest.max_date
     ORDER BY s.source, s.period`
  )
    .bind(cardId)
    .all();

  // Compute composite score (weighted average: 24h=0.5, 7d=0.3, 30d=0.2)
  const periodWeights: Record<string, number> = { "24h": 0.5, "7d": 0.3, "30d": 0.2 };
  let weightedSum = 0;
  let totalWeight = 0;
  let totalMentions = 0;

  for (const s of scores.results) {
    const w = periodWeights[s.period as string] || 0.2;
    weightedSum += (s.score as number) * w;
    totalWeight += w;
    if (s.period === "7d") {
      totalMentions += s.mention_count as number;
    }
  }

  const compositeScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Determine trend by comparing 24h score to 7d score
  const score24h = scores.results.find((s) => s.period === "24h")?.score as number | undefined;
  const score7d = scores.results.find((s) => s.period === "7d")?.score as number | undefined;

  let trend = "stable";
  if (score24h !== undefined && score7d !== undefined) {
    if (score24h > score7d * 1.3) trend = "spiking";
    else if (score24h > score7d * 1.1) trend = "rising";
    else if (score24h < score7d * 0.7) trend = "crashing";
    else if (score24h < score7d * 0.9) trend = "falling";
  }

  // Get top posts from the latest 24h entry
  const latest24h = scores.results.find((s) => s.period === "24h");
  const topPosts = latest24h?.top_posts ? JSON.parse(latest24h.top_posts as string) : [];

  return c.json({
    card_id: cardId,
    score: Math.round(compositeScore * 100) / 100,
    mentions_7d: totalMentions,
    trend,
    breakdown: scores.results,
    top_posts: topPosts,
  });
});

// GET /v1/sentiment/trending — cards with spiking sentiment
sentimentRoutes.get("/trending/all", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 50);

  const trending = await c.env.DB.prepare(
    `SELECT s.card_id, cc.name, cc.category, s.score, s.mention_count,
            s.source, s.period
     FROM sentiment_scores s
     JOIN card_catalog cc ON cc.id = s.card_id
     WHERE s.period = '24h'
       AND s.rollup_date >= date('now', '-1 day')
       AND s.mention_count > 5
     ORDER BY s.score DESC, s.mention_count DESC
     LIMIT ?`
  )
    .bind(limit)
    .all();

  return c.json({ trending: trending.results });
});
