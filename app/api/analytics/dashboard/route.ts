import { handleRouteError, jsonOk, parseQuery } from '@/lib/api';
import { requireSession } from '@/lib/auth/guard';
import { getDashboardMetrics } from '@/lib/services/analytics';
import { dashboardQuerySchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const query = parseQuery(new URL(request.url), dashboardQuerySchema);

    const metrics = await getDashboardMetrics(session.userId, { days: query.days });

    return jsonOk(metrics);
  } catch (error) {
    return handleRouteError(error);
  }
}
