import { handleRouteError, jsonOk } from '@/lib/api';
import { requireSameOrigin } from '@/lib/auth/origin';
import { destroySession } from '@/lib/auth/session';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);

    // Deletes the session row as well as the cookie. Clearing only the cookie is not a
    // logout: a token captured earlier would keep working until it expired.
    await destroySession();

    return jsonOk({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
