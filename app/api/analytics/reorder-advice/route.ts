import { handleRouteError, jsonOk, parseQuery } from '@/lib/api';
import { requireSession } from '@/lib/auth/guard';
import { getReorderAdvice } from '@/lib/services/reorder';
import { reorderAdviceQuerySchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const query = parseQuery(new URL(request.url), reorderAdviceQuerySchema);

    const advice = await getReorderAdvice(session.userId, { safetyDays: query.safetyDays });

    return jsonOk(advice);
  } catch (error) {
    return handleRouteError(error);
  }
}
