const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function digest(value: string): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return new Uint8Array(hash);
}

function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export async function secureCompareStrings(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([digest(left), digest(right)]);
  return constantTimeEqualBytes(leftDigest, rightDigest);
}

export async function hashSellerId(sellerId: string, salt: string): Promise<string> {
  const normalized = sellerId.trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  const salted = `${salt}:${normalized}`;
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(salted));
  return toHex(hash);
}
