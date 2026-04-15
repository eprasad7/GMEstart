import { describe, it, expect } from "vitest";

// Extracted from apps/api/src/lib/params.ts
function parsePositiveInt(value: string | undefined, defaultVal: number, max: number): number {
  if (!value) return defaultVal;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return defaultVal;
  return Math.min(n, max);
}

describe("parsePositiveInt", () => {
  it("returns default for undefined", () => {
    expect(parsePositiveInt(undefined, 90, 365)).toBe(90);
  });

  it("returns default for empty string", () => {
    expect(parsePositiveInt("", 90, 365)).toBe(90);
  });

  it("returns default for NaN input", () => {
    expect(parsePositiveInt("abc", 90, 365)).toBe(90);
  });

  it("returns default for zero", () => {
    expect(parsePositiveInt("0", 90, 365)).toBe(90);
  });

  it("returns default for negative", () => {
    expect(parsePositiveInt("-5", 90, 365)).toBe(90);
  });

  it("parses valid positive integer", () => {
    expect(parsePositiveInt("30", 90, 365)).toBe(30);
  });

  it("clamps to max", () => {
    expect(parsePositiveInt("1000", 90, 365)).toBe(365);
  });

  it("handles float strings (parseInt truncates)", () => {
    expect(parsePositiveInt("30.5", 90, 365)).toBe(30);
  });
});
