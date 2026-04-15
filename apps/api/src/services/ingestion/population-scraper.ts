import puppeteer from "@cloudflare/puppeteer";
import type { Env } from "../../types";

/**
 * Scrape PSA population data from GemRate using Browser Rendering.
 *
 * GemRate aggregates population reports across PSA, BGS, CGC, SGC.
 * Their site loads data dynamically via JavaScript, so we use
 * Cloudflare's headless Chrome to render and extract.
 *
 * Runs daily at 3am via cron.
 */

const GEMRATE_SEARCH_URL = "https://www.gemrate.com/universal-pop-report";

export async function scrapePopulationReports(env: Env): Promise<number> {
  // Get cards that need population data (prioritize those without recent snapshots)
  const cards = await env.DB.prepare(
    `SELECT cc.id, cc.name, cc.category
     FROM card_catalog cc
     LEFT JOIN (
       SELECT card_id, MAX(snapshot_date) as last_snapshot
       FROM population_reports
       GROUP BY card_id
     ) pr ON pr.card_id = cc.id
     WHERE pr.last_snapshot IS NULL OR pr.last_snapshot < date('now', '-7 days')
     ORDER BY pr.last_snapshot ASC NULLS FIRST
     LIMIT 10`
  ).bind().all();

  if (cards.results.length === 0) return 0;

  let totalIngested = 0;
  const today = new Date().toISOString().split("T")[0];
  const browser = await puppeteer.launch(env.BROWSER);

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
    );

    for (const card of cards.results) {
      try {
        const cardName = card.name as string;

        // Navigate to GemRate search
        await page.goto(`${GEMRATE_SEARCH_URL}?q=${encodeURIComponent(cardName)}`, {
          waitUntil: "networkidle0",
          timeout: 20000,
        });

        // Wait for the population table to load
        await page.waitForSelector("table, .pop-data, .no-results", { timeout: 10000 }).catch(() => null);

        // Extract population data from the page
        const popData = await page.evaluate(() => {
          const rows: Array<{
            grading_company: string;
            grade: string;
            population: number;
          }> = [];

          // Look for population tables — GemRate uses various table formats
          const tables = (globalThis as any).document.querySelectorAll("table");
          for (const table of tables) {
            const headerCells = table.querySelectorAll("th");
            const headers = Array.from(headerCells).map((th: any) => th.textContent?.trim().toLowerCase() || "");

            // Check if this looks like a pop report table
            const hasGrade = headers.some((h: string) => h.includes("grade") || h.includes("score"));
            const hasPop = headers.some((h: string) => h.includes("pop") || h.includes("count") || h.includes("quantity"));

            if (!hasGrade && !hasPop) continue;

            const bodyRows = table.querySelectorAll("tbody tr");
            for (const row of bodyRows) {
              const cells = Array.from(row.querySelectorAll("td")).map((td: any) => td.textContent?.trim() || "");
              if (cells.length < 2) continue;

              // Try to extract grade and population from cells
              const gradeCell = cells.find((c: string) => /^(PSA|BGS|CGC|SGC)?\s*\d+\.?\d*$/.test(c));
              const popCell = cells.find((c: string) => /^\d+$/.test(c.replace(/,/g, "")));

              if (gradeCell && popCell) {
                const gradeMatch = gradeCell.match(/(PSA|BGS|CGC|SGC)?\s*(\d+\.?\d*)/);
                if (gradeMatch) {
                  rows.push({
                    grading_company: gradeMatch[1] || "PSA",
                    grade: gradeMatch[2],
                    population: parseInt(popCell.replace(/,/g, ""), 10),
                  });
                }
              }
            }
          }

          return rows;
        });

        if (popData.length > 0) {
          const BATCH_SIZE = 90;
          const stmts: D1PreparedStatement[] = [];

          for (const pop of popData) {
            stmts.push(
              env.DB.prepare(
                `INSERT INTO population_reports (card_id, grading_company, grade, population, pop_higher, total_population, snapshot_date)
                 VALUES (?, ?, ?, ?, 0, 0, ?)
                 ON CONFLICT(card_id, grading_company, grade, snapshot_date) DO UPDATE SET
                   population = excluded.population`
              ).bind(card.id, pop.grading_company, pop.grade, pop.population, today)
            );

            if (stmts.length >= BATCH_SIZE) {
              await env.DB.batch(stmts);
              stmts.length = 0;
            }
          }

          if (stmts.length > 0) {
            await env.DB.batch(stmts);
          }

          totalIngested += popData.length;
        }
      } catch (err) {
        console.error(`Population scrape failed for ${card.name}:`, err);
      }
    }
  } finally {
    await browser.close();
  }

  return totalIngested;
}
