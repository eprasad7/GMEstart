import { describe, it, expect } from "vitest";

/**
 * Tests for pricing engine logic.
 *
 * NOTE: These test extracted/replicated logic rather than importing
 * from inference.ts directly, because inference.ts depends on Cloudflare
 * Worker bindings (D1, R2, KV) that aren't available in vitest.
 *
 * The NRV constants and formulas are duplicated here and MUST match
 * apps/api/src/services/inference.ts and apps/api/src/routes/evaluate.ts.
 * If those files change, these tests must be updated to match.
 *
 * TODO: Extract pure functions from inference.ts into a testable module
 * (e.g., lib/pricing.ts) that both the Worker and tests can import.
 */

// Constants — MUST match inference.ts and evaluate.ts
const MARKETPLACE_FEE = 0.13;
const SHIPPING = 5.0;
const RETURN_RATE = 0.03;
const REQUIRED_MARGIN = 0.20;

// Replicated from evaluate.ts
function computeNrv(fairValue: number): number {
  return fairValue * (1 - MARKETPLACE_FEE) * (1 - RETURN_RATE) - SHIPPING;
}

function computeMaxBuyPrice(fairValue: number): number {
  return computeNrv(fairValue) * (1 - REQUIRED_MARGIN);
}

// Replicated from evaluate.ts
function makeDecision(
  offeredPrice: number,
  fairValue: number,
  sellThreshold: number,
  confidence: "HIGH" | "MEDIUM" | "LOW"
): "STRONG_BUY" | "REVIEW_BUY" | "FAIR_VALUE" | "SELL_SIGNAL" {
  const nrv = computeNrv(fairValue);
  const maxBuyPrice = computeMaxBuyPrice(fairValue);

  if (offeredPrice < maxBuyPrice) {
    return confidence !== "LOW" ? "STRONG_BUY" : "REVIEW_BUY";
  } else if (offeredPrice > sellThreshold) {
    return "SELL_SIGNAL";
  } else if (offeredPrice > nrv) {
    return "FAIR_VALUE";
  }
  return "FAIR_VALUE";
}

describe("NRV calculations (must match evaluate.ts)", () => {
  it("NRV = fairValue * (1-fees) * (1-returns) - shipping", () => {
    // $100 * 0.87 * 0.97 - $5 = $79.39
    expect(computeNrv(100)).toBeCloseTo(79.39, 1);
  });

  it("NRV is negative for sub-$6 cards", () => {
    expect(computeNrv(5)).toBeLessThan(0);
    expect(computeNrv(6)).toBeCloseTo(0.1, 0);
  });

  it("max buy price = NRV * 0.80", () => {
    expect(computeMaxBuyPrice(100)).toBeCloseTo(63.51, 0);
  });

  it("max buy price < NRV < fair value", () => {
    const fv = 200;
    expect(computeMaxBuyPrice(fv)).toBeLessThan(computeNrv(fv));
    expect(computeNrv(fv)).toBeLessThan(fv);
  });
});

describe("Decision logic (must match evaluate.ts)", () => {
  it("STRONG_BUY when price < max buy and HIGH confidence", () => {
    expect(makeDecision(30, 100, 120, "HIGH")).toBe("STRONG_BUY");
  });

  it("REVIEW_BUY when price < max buy but LOW confidence", () => {
    expect(makeDecision(30, 100, 120, "LOW")).toBe("REVIEW_BUY");
  });

  it("SELL_SIGNAL when price > sell threshold", () => {
    expect(makeDecision(150, 100, 120, "HIGH")).toBe("SELL_SIGNAL");
  });

  it("FAIR_VALUE when price between max buy and sell threshold", () => {
    expect(makeDecision(80, 100, 120, "HIGH")).toBe("FAIR_VALUE");
  });

  it("FAIR_VALUE when price exceeds NRV but below sell threshold", () => {
    const nrv = computeNrv(100); // ~79.39
    expect(makeDecision(85, 100, 120, "HIGH")).toBe("FAIR_VALUE");
  });

  it("won't recommend buying unprofitable cards", () => {
    // Offered at $85 for $100 card — NRV ~$79, max buy ~$63
    // $85 > $63 so NOT a buy
    expect(makeDecision(85, 100, 120, "HIGH")).not.toBe("STRONG_BUY");
  });
});
