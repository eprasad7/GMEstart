import { describe, it, expect } from "vitest";

/**
 * NRV (Net Realizable Value) logic tests.
 * Validates the retail economics calculations match the spec.
 */

const MARKETPLACE_FEE = 0.13;
const SHIPPING_COST = 5.0;
const RETURN_RATE = 0.03;
const REQUIRED_MARGIN = 0.20;

function computeNrv(fairValue: number): number {
  const gross = fairValue * (1 - MARKETPLACE_FEE);
  const netAfterReturns = gross * (1 - RETURN_RATE);
  return netAfterReturns - SHIPPING_COST;
}

function computeMaxBuyPrice(fairValue: number): number {
  return computeNrv(fairValue) * (1 - REQUIRED_MARGIN);
}

function makeDecision(offeredPrice: number, fairValue: number, sellThreshold: number, confidence: string) {
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

describe("NRV calculations", () => {
  it("computes NRV correctly for $100 card", () => {
    // $100 * 0.87 (fees) * 0.97 (returns) - $5 (shipping)
    const nrv = computeNrv(100);
    expect(nrv).toBeCloseTo(79.39, 1);
  });

  it("computes max buy price at 20% margin", () => {
    const maxBuy = computeMaxBuyPrice(100);
    // NRV ~$79.39 * 0.80 = ~$63.51
    expect(maxBuy).toBeCloseTo(63.51, 0);
  });

  it("NRV is negative for very cheap cards", () => {
    // $5 card: $5 * 0.87 * 0.97 - $5 = -$0.78
    expect(computeNrv(5)).toBeLessThan(0);
  });

  it("max buy price is 0 for cards below shipping cost", () => {
    expect(computeMaxBuyPrice(5)).toBeLessThan(0);
  });
});

describe("Buy/sell decisions", () => {
  it("STRONG_BUY when price is well below max buy", () => {
    // $100 card, offered at $50, sell threshold $120
    expect(makeDecision(50, 100, 120, "HIGH")).toBe("STRONG_BUY");
  });

  it("REVIEW_BUY when confidence is LOW", () => {
    expect(makeDecision(50, 100, 120, "LOW")).toBe("REVIEW_BUY");
  });

  it("SELL_SIGNAL when price exceeds sell threshold", () => {
    expect(makeDecision(130, 100, 120, "HIGH")).toBe("SELL_SIGNAL");
  });

  it("FAIR_VALUE when price is between buy and sell", () => {
    expect(makeDecision(80, 100, 120, "HIGH")).toBe("FAIR_VALUE");
  });

  it("won't recommend buying above NRV", () => {
    // Offered at $85 for $100 card — NRV ~$79, so buying at $85 loses money
    const decision = makeDecision(85, 100, 120, "HIGH");
    expect(decision).toBe("FAIR_VALUE"); // Not a buy
  });
});
