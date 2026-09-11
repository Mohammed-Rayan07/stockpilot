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

// §7.8: 20 assistant messages per user per hour.
export const AI_CHAT_RATE_LIMIT = { limit: 20, windowMs: 60 * 60 * 1000 };

export function aiChatRateLimitKey(userId: string): string {
  return `ai-chat:${userId}`;
}

/**
 * Keyed on IP *and* email so that one attacker cannot lock out a victim's account by
 * burning the limit against their address from elsewhere.
 */
export function loginRateLimitKey(ip: string, email: string): string {
  return `login:${ip}:${email}`;
}

/**
 * `x-vercel-forwarded-for` is Vercel's own copy of the client address: per Vercel's docs
 * it is identical to `x-forwarded-for` except that it cannot be overwritten, whereas
 * `x-forwarded-for` *can* be, if the account has purchased the Enterprise "trusted proxy"
 * add-on that lets a custom upstream proxy set it. `x-forwarded-for` is kept as a
 * fallback: by default (no trusted proxy configured) Vercel overwrites it at the edge and
 * does not forward client-supplied values, specifically to prevent spoofing, so it too is
 * trustworthy for accounts without that add-on.
 *
 * Off Vercel entirely -- local dev, or any other host in front that does not set either
 * header -- neither is present and this returns 'unknown'. Every request then collapses
 * onto the same IP bucket and the `ip:email` key degrades to an email-only key. That
 * limitation, alongside the in-memory store itself, is disclosed in README.md rather than
 * presenting the limiter as fully IP-scoped everywhere it might run.
 */
export function clientIpFrom(request: Request): string {
  const forwarded =
    request.headers.get('x-vercel-forwarded-for') ?? request.headers.get('x-forwarded-for');

  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  return 'unknown';
}
