import { getAdminSupabaseClient } from "@/lib/supabase";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = globalThis as typeof globalThis & {
  __regicideRateBuckets?: Map<string, Bucket>;
};

buckets.__regicideRateBuckets ??= new Map<string, Bucket>();

function keyFor(request: Request, scope: string) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? "unknown";
  return `${scope}:${ip}`;
}

export async function assertRateLimit(request: Request, scope: string, limit = 24, windowMs = 60_000) {
  const client = getAdminSupabaseClient();
  const bucketKey = keyFor(request, scope);

  if (client) {
    const { data, error } = await client.rpc("consume_rate_limit", {
      bucket_key: bucketKey,
      max_hits: limit,
      window_ms: windowMs,
    });
    if (error) throw new Error(error.message);
    if (!data?.allowed) {
      throw new Error(`Rate limit exceeded for ${scope}. Please wait a moment.`);
    }
    return;
  }

  const now = Date.now();
  const existing = buckets.__regicideRateBuckets!.get(bucketKey);
  if (!existing || existing.resetAt <= now) {
    buckets.__regicideRateBuckets!.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (existing.count >= limit) {
    throw new Error(`Rate limit exceeded for ${scope}. Please wait a moment.`);
  }
  existing.count += 1;
  buckets.__regicideRateBuckets!.set(bucketKey, existing);
}
