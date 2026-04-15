import puppeteer from "@cloudflare/puppeteer";
import type { Env } from "../../types";

/**
 * Scrape Reddit subreddits for card mentions using Browser Rendering.
 *
 * Since Reddit deprecated the standalone Data API in favor of Devvit,
 * we use Cloudflare's headless Chrome to scrape public subreddit pages.
 *
 * Runs every 5 minutes via cron. Scrapes new posts from target subreddits,
 * extracts card mentions via Workers AI, and queues for sentiment analysis.
 */

const TARGET_SUBREDDITS = [
  "PokemonTCG",
  "baseballcards",
  "basketballcards",
  "footballcards",
  "PKMNTCGDeals",
  "sportscards",
];

interface ScrapedPost {
  id: string;
  title: string;
  selftext: string;
  subreddit: string;
  score: number;
  numComments: number;
  permalink: string;
  createdUtc: number;
}

/**
 * Scrape recent posts from target subreddits.
 * Uses old.reddit.com which renders server-side (no JS needed for basic content).
 */
export async function scrapeRedditSentiment(env: Env): Promise<number> {
  let totalProcessed = 0;

  // Process one subreddit per cron run to stay within limits
  // Rotate through subreddits using the current minute
  const minuteOfDay = new Date().getMinutes() + new Date().getHours() * 60;
  const subIndex = minuteOfDay % TARGET_SUBREDDITS.length;
  const subreddit = TARGET_SUBREDDITS[subIndex];

  try {
    const posts = await scrapeSubreddit(env, subreddit);

    for (const post of posts) {
      const text = `${post.title} ${post.selftext}`.trim();
      if (!text || text.length < 10) continue;

      // Extract card mentions via Workers AI
      const cardIds = await extractCardMentions(env, text);

      for (const cardId of cardIds) {
        await env.SENTIMENT_QUEUE.send({
          type: "sentiment_analysis",
          data: {
            card_id: cardId,
            text: text.slice(0, 500),
            source: "reddit",
            post_url: `https://reddit.com${post.permalink}`,
            engagement: post.score + post.numComments,
          },
        });
        totalProcessed++;
      }
    }
  } catch (err) {
    console.error(`Reddit scrape failed for r/${subreddit}:`, err);
  }

  return totalProcessed;
}

async function scrapeSubreddit(env: Env, subreddit: string): Promise<ScrapedPost[]> {
  // Use old.reddit.com — server-rendered HTML, much simpler to parse
  const browser = await puppeteer.launch(env.BROWSER);

  try {
    const page = await browser.newPage();

    // Set a reasonable user agent
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    await page.goto(`https://old.reddit.com/r/${subreddit}/new/.json`, {
      waitUntil: "networkidle0",
      timeout: 15000,
    });

    // old.reddit.com/r/sub/new/.json returns JSON even without auth
    const content = await page.evaluate(() => (globalThis as any).document.body?.innerText || "");

    const data = JSON.parse(content) as {
      data: {
        children: Array<{
          data: {
            id: string;
            title: string;
            selftext: string;
            subreddit: string;
            score: number;
            num_comments: number;
            permalink: string;
            created_utc: number;
          };
        }>;
      };
    };

    return data.data.children.slice(0, 15).map((child) => ({
      id: child.data.id,
      title: child.data.title,
      selftext: child.data.selftext || "",
      subreddit: child.data.subreddit,
      score: child.data.score,
      numComments: child.data.num_comments,
      permalink: child.data.permalink,
      createdUtc: child.data.created_utc,
    }));
  } finally {
    await browser.close();
  }
}

/**
 * Use Workers AI to extract card mentions from post text.
 */
async function extractCardMentions(env: Env, text: string): Promise<string[]> {
  try {
    const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        {
          role: "system",
          content:
            'You are a card mention extractor. Given text from a trading card forum, extract specific card names. Return ONLY a JSON array of card names. Example: ["Charizard Base Set", "Jordan Rookie Fleer"]. If no specific cards, return [].',
        },
        { role: "user", content: text.slice(0, 800) },
      ],
      max_tokens: 200,
    });

    const responseText = (result as { response: string }).response || "";
    const jsonMatch = responseText.match(/\[.*\]/s);
    if (!jsonMatch) return [];

    const cardNames = JSON.parse(jsonMatch[0]) as string[];
    if (!Array.isArray(cardNames) || cardNames.length === 0) return [];

    // Look up card IDs from catalog
    const cardIds: string[] = [];
    for (const name of cardNames.slice(0, 5)) {
      const card = await env.DB.prepare(
        `SELECT id FROM card_catalog WHERE name LIKE ? LIMIT 1`
      )
        .bind(`%${name}%`)
        .first();

      if (card) cardIds.push(card.id as string);
    }

    return cardIds;
  } catch {
    return [];
  }
}
