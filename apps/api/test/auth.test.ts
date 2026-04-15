import { describe, it, expect } from "vitest";

/**
 * Auth middleware behavior tests.
 * These test the auth logic in isolation (no Worker runtime needed).
 */

// Simulate the auth decision logic extracted from middleware
function shouldBypassAuth(path: string, method: string, environment: string): boolean {
  if (path === "/" || method === "OPTIONS") return true;
  if (environment === "development") return true;
  return false;
}

function validateApiKey(headerKey: string | null, envKey: string): "ok" | "missing" | "invalid" {
  if (!headerKey) return "missing";
  if (headerKey !== envKey) return "invalid";
  return "ok";
}

describe("Auth middleware", () => {
  it("bypasses auth for health check", () => {
    expect(shouldBypassAuth("/", "GET", "production")).toBe(true);
  });

  it("bypasses auth for OPTIONS preflight", () => {
    expect(shouldBypassAuth("/v1/price/card-1", "OPTIONS", "production")).toBe(true);
  });

  it("bypasses auth in development", () => {
    expect(shouldBypassAuth("/v1/price/card-1", "GET", "development")).toBe(true);
  });

  it("requires auth in production", () => {
    expect(shouldBypassAuth("/v1/price/card-1", "GET", "production")).toBe(false);
  });

  it("validates correct API key", () => {
    expect(validateApiKey("test-key-123", "test-key-123")).toBe("ok");
  });

  it("rejects missing API key", () => {
    expect(validateApiKey(null, "test-key-123")).toBe("missing");
  });

  it("rejects wrong API key", () => {
    expect(validateApiKey("wrong-key", "test-key-123")).toBe("invalid");
  });

  it("requires auth for /agents/ path in production", () => {
    expect(shouldBypassAuth("/agents/price-monitor/default", "GET", "production")).toBe(false);
  });
});
