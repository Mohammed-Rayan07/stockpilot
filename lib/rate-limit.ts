// In-memory fixed-window counter.
//
// HONEST LIMITATION: this Map lives in one serverless instance's memory. Vercel runs
// many instances and recycles them, so an attacker spreading attempts across instances
// sees a much higher effective limit, and the counters reset on every cold start. This
// slows casual brute force and nothing more. The correct production answer is a shared
// store — Redis or Upstash — keyed the same way. This is documented rather than hidden
// because a silent hole is worse than a disclosed one.

type Window = {
  count: number;
  resetAt: number;
};

const windows = new Map<string, Window>();

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || now >= existing.resetAt) {
    const fresh: Window = { count: 1, resetAt: now + windowMs };
    windows.set(key, fresh);
    return { allowed: true, remaining: limit - 1, resetAt: fresh.resetAt };
  }

  existing.count += 1;

  if (existing.count > limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  return { allowed: true, remaining: limit - existing.count, resetAt: existing.resetAt };
}

export const LOGIN_RATE_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 };

/**
 * Keyed on IP *and* email so that one attacker cannot lock out a victim's account by
 * burning the limit against their address from elsewhere.
 */
export function loginRateLimitKey(ip: string, email: string): string {
  return `login:${ip}:${email}`;
}

/**
 * Vercel puts the client address in x-forwarded-for. The header is spoofable in general;
 * behind Vercel's proxy the first entry is the one the platform observed.
 */
export function clientIpFrom(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');

  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  return 'unknown';
}
