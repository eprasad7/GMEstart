import { describe, expect, it } from "vitest";
import { hashSellerId, secureCompareStrings } from "../src/lib/security";

describe("security helpers", () => {
  it("hashes seller IDs deterministically", async () => {
    const first = await hashSellerId("Seller-123", "salt");
    const second = await hashSellerId("seller-123", "salt");
    expect(first).toBe(second);
    expect(first).not.toContain("Seller-123");
  });

  it("changes the hash when the salt changes", async () => {
    const first = await hashSellerId("seller-123", "salt-a");
    const second = await hashSellerId("seller-123", "salt-b");
    expect(first).not.toBe(second);
  });

  it("compares matching strings securely", async () => {
    await expect(secureCompareStrings("abc", "abc")).resolves.toBe(true);
    await expect(secureCompareStrings("abc", "xyz")).resolves.toBe(false);
  });
});
