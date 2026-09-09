import { handleRouteError, jsonOk, parseJsonBody } from '@/lib/api';
import { requireSameOrigin } from '@/lib/auth/origin';
import { createSession, setSessionCookie } from '@/lib/auth/session';
import { registerUser } from '@/lib/services/auth';
import { registerSchema } from '@/lib/validation/schemas';

// bcrypt and the Neon WebSocket pool both need Node APIs the Edge runtime does not have.
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);

    const input = await parseJsonBody(request, registerSchema);
    const { userId } = await registerUser(input);

    const rawToken = await createSession(userId);
    await setSessionCookie(rawToken);

    return jsonOk({ ok: true }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
