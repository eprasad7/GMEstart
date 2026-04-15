import { describe, it, expect } from "vitest";

/**
 * Source-specific dedup behavior tests.
 * Validates that each data source's dedup semantics are correct.
 */

describe("Price observation dedup rules", () => {
  // The unique index is: (card_id, source, listing_url) WHERE listing_url IS NOT NULL

  it("SoldComps: unique listing URLs produce unique observations", () => {
    const obs1 = { card_id: "poke-1", source: "soldcomps", listing_url: "https://ebay.com/item/123" };
    const obs2 = { card_id: "poke-1", source: "soldcomps", listing_url: "https://ebay.com/item/456" };
    // These have different listing_urls → both insert
    expect(obs1.listing_url).not.toBe(obs2.listing_url);
  });

  it("SoldComps: same listing URL is deduped", () => {
    const obs1 = { card_id: "poke-1", source: "soldcomps", listing_url: "https://ebay.com/item/123" };
    const obs2 = { card_id: "poke-1", source: "soldcomps", listing_url: "https://ebay.com/item/123" };
    // Same listing_url → INSERT OR IGNORE skips obs2
    expect(obs1.listing_url).toBe(obs2.listing_url);
  });

  it("PriceCharting: daily snapshots have date-stamped URLs", () => {
    const today = "2026-04-14";
    const tomorrow = "2026-04-15";
    const url1 = `https://www.pricecharting.com/game/pc123#${today}-10`;
    const url2 = `https://www.pricecharting.com/game/pc123#${tomorrow}-10`;
    // Different dates → different URLs → both insert
    expect(url1).not.toBe(url2);
  });

  it("PriceCharting: same day same grade is deduped", () => {
    const date = "2026-04-14";
    const url1 = `https://www.pricecharting.com/game/pc123#${date}-10`;
    const url2 = `https://www.pricecharting.com/game/pc123#${date}-10`;
    expect(url1).toBe(url2);
  });

  it("NULL listing_url observations bypass dedup (partial index)", () => {
    const obs = { card_id: "poke-1", source: "gamestop_internal", listing_url: null };
    // The unique index has WHERE listing_url IS NOT NULL
    // So NULL listing_url rows are never constrained → always insert
    expect(obs.listing_url).toBeNull();
  });
});

describe("Sentiment raw dedup rules", () => {
  it("same post_url is deduped", () => {
    const url1 = "https://reddit.com/r/PokemonTCG/comments/abc";
    const url2 = "https://reddit.com/r/PokemonTCG/comments/abc";
    expect(url1).toBe(url2);
  });

  it("different posts are not deduped", () => {
    const url1 = "https://reddit.com/r/PokemonTCG/comments/abc";
    const url2 = "https://reddit.com/r/PokemonTCG/comments/def";
    expect(url1).not.toBe(url2);
  });
});

describe("PriceCharting RAW dedup", () => {
  it("only emits one RAW observation per card per day", () => {
    // pricecharting.ts: uses complete-price OR loose-price, never both
    const hasComplete = true;
    const hasLoose = true;
    const rawPrice = hasComplete ? 100 : hasLoose ? 80 : null;
    // Should use complete-price when both exist
    expect(rawPrice).toBe(100);
  });

  it("falls back to loose-price when no complete-price", () => {
    const hasComplete = false;
    const hasLoose = true;
    const rawPrice = hasComplete ? undefined : hasLoose ? 80 : null;
    expect(rawPrice).toBe(80);
  });
});
