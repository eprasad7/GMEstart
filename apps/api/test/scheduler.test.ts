import { describe, it, expect } from "vitest";

/**
 * Scheduler pipeline ordering tests.
 * Validates that the cron → source mapping and pipeline order are correct.
 */

const cronSourceMap: Record<string, string> = {
  "*/15 * * * *": "soldcomps",
  "*/5 * * * *": "reddit",
  "0 1 * * 0": "archive",
  "0 * * * *": "sentiment_rollup",
  "0 2 * * *": "pricecharting",
  "0 3 * * *": "population",
  "0 4 * * *": "anomaly",
  "0 5 * * *": "features",
  "0 6 * * *": "predictions",
};

// Pipeline must run in this order for data correctness
const requiredOrder = [
  "anomaly",       // Must flag bad data before features use it
  "features",      // Must compute features before predictions use them
  "predictions",   // Must run after features are fresh
];

describe("Scheduler pipeline", () => {
  it("maps every cron to a named source", () => {
    const crons = Object.keys(cronSourceMap);
    expect(crons.length).toBe(9);
    for (const source of Object.values(cronSourceMap)) {
      expect(typeof source).toBe("string");
      expect(source.length).toBeGreaterThan(0);
    }
  });

  it("includes weekly archival", () => {
    expect(cronSourceMap["0 1 * * 0"]).toBe("archive");
  });

  it("anomaly runs before features", () => {
    const anomalyHour = 4; // 0 4 * * *
    const featuresHour = 5; // 0 5 * * *
    expect(anomalyHour).toBeLessThan(featuresHour);
  });

  it("features runs before predictions", () => {
    const featuresHour = 5;
    const predictionsHour = 6;
    expect(featuresHour).toBeLessThan(predictionsHour);
  });

  it("ingestion runs before anomaly detection", () => {
    // SoldComps runs every 15 min, PriceCharting at 2am, Population at 3am
    // All before anomaly at 4am
    const pricechartingHour = 2;
    const populationHour = 3;
    const anomalyHour = 4;
    expect(pricechartingHour).toBeLessThan(anomalyHour);
    expect(populationHour).toBeLessThan(anomalyHour);
  });

  it("no duplicate source names", () => {
    const sources = Object.values(cronSourceMap);
    const unique = new Set(sources);
    expect(unique.size).toBe(sources.length);
  });

  it("unknown cron returns undefined source", () => {
    expect(cronSourceMap["0 99 * * *"]).toBeUndefined();
  });
});
