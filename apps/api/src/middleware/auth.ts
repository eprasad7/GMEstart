import { createMiddleware } from "hono/factory";
import type { Env } from "../types";
import { secureCompareStrings } from "../lib/security";

/**
 * API key authentication middleware.
 *
 * Checks for X-API-Key header and validates against the API_KEY secret.
 * Exempts the health check endpoint (/) and OPTIONS preflight requests.
 *
 * Set the secret via: wrangler secret put API_KEY
 */
export const apiKeyAuth = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  // Skip auth for health check and CORS preflight
  if (c.req.path === "/" || c.req.method === "OPTIONS") {
    return next();
  }

  // In development, allow unauthenticated access
  if (c.env.ENVIRONMENT === "development") {
    return next();
  }

  const apiKey = c.req.header("X-API-Key");
  if (!apiKey) {
    return c.json({ error: "Missing X-API-Key header" }, 401);
  }

  const isValid = await secureCompareStrings(apiKey, c.env.API_KEY);
  if (!isValid) {
    return c.json({ error: "Invalid API key" }, 403);
  }

  return next();
});

/**
 * Rate limiting middleware using KV.
 *
 * Limits requests per API key to MAX_REQUESTS_PER_MINUTE.
 * Uses a sliding window counter stored in KV.
 */
const MAX_REQUESTS_PER_MINUTE = 120;

export const rateLimiter = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  if (c.req.path === "/" || c.req.method === "OPTIONS") {
    return next();
  }

  if (c.env.ENVIRONMENT === "development") {
    return next();
  }

  const apiKey = c.req.header("X-API-Key") || "anonymous";
  const minute = Math.floor(Date.now() / 60000);
  const rateLimitKey = `ratelimit:${apiKey}:${minute}`;

  const current = await c.env.PRICE_CACHE.get(rateLimitKey);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= MAX_REQUESTS_PER_MINUTE) {
    return c.json(
      { error: "Rate limit exceeded. Maximum 120 requests per minute." },
      429
    );
  }

  // Increment counter (TTL 120s to cover the full minute window + buffer)
  await c.env.PRICE_CACHE.put(rateLimitKey, String(count + 1), {
    expirationTtl: 120,
  });

  // Set rate limit headers
  c.header("X-RateLimit-Limit", String(MAX_REQUESTS_PER_MINUTE));
  c.header("X-RateLimit-Remaining", String(MAX_REQUESTS_PER_MINUTE - count - 1));

  return next();
});
