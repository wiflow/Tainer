import "server-only";

type RateLimitBucket = { count: number; firstReq: number };

const buckets = new Map<string, Map<string, RateLimitBucket>>();

export function createRateLimiter(
  name: string,
  maxRequests: number,
  windowMs: number,
) {
  if (!buckets.has(name)) {
    buckets.set(name, new Map());
  }

  return function checkRateLimit(key: string): boolean {
    const tracker = buckets.get(name)!;
    const now = Date.now();
    const cutoff = now - windowMs;

    for (const [k, entry] of tracker) {
      if (entry.firstReq < cutoff) tracker.delete(k);
    }

    const entry = tracker.get(key);

    if (entry && now - entry.firstReq < windowMs) {
      if (entry.count >= maxRequests) {
        return false;
      }
      entry.count += 1;
    } else {
      tracker.set(key, { count: 1, firstReq: now });
    }

    return true;
  };
}

export function createRateLimiterOrThrow(
  name: string,
  maxRequests: number,
  windowMs: number,
  message = "Too many requests. Please wait a few minutes.",
) {
  const check = createRateLimiter(name, maxRequests, windowMs);

  return function enforceRateLimit(key: string) {
    if (!check(key)) {
      throw new Error(message);
    }
  };
}
