import { handleRouteError, jsonOk, parseJsonBody } from '@/lib/api';
import { requireSameOrigin } from '@/lib/auth/origin';
import { createSession, setSessionCookie } from '@/lib/auth/session';
import { RateLimitedError } from '@/lib/errors';
import {
  checkRateLimit,
  clientIpFrom,
  LOGIN_RATE_LIMIT,
  loginRateLimitKey,
} from '@/lib/rate-limit';
import { authenticateUser } from '@/lib/services/auth';
import { loginSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);

    const input = await parseJsonBody(request, loginSchema);

    const key = loginRateLimitKey(clientIpFrom(request), input.email.trim().toLowerCase());
    const limit = checkRateLimit(key, LOGIN_RATE_LIMIT.limit, LOGIN_RATE_LIMIT.windowMs);

    if (!limit.allowed) {
      throw new RateLimitedError('Too many sign-in attempts. Try again in a few minutes.');
    }

    const { userId } = await authenticateUser(input);

    const rawToken = await createSession(userId);
    await setSessionCookie(rawToken);

    return jsonOk({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
