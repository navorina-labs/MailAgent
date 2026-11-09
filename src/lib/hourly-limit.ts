/** Per-hour counters in the RATE_LIMIT KV for public, unauthenticated endpoints. */

export async function hourlyLimitHit(
  kv: KVNamespace | undefined,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  key: string,
  max: number
): Promise<boolean> {
  if (!kv) return false;
  const bucket = `${key}:${Math.floor(Date.now() / 3_600_000)}`;
  const used = Number((await kv.get(bucket)) ?? 0);
  if (used >= max) return true;
  ctx.waitUntil(kv.put(bucket, String(used + 1), { expirationTtl: 3700 }));
  return false;
}
