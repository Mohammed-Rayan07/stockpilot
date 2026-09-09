import { handleRouteError, jsonOk, parseJsonBody, parseQuery } from '@/lib/api';
import { requireSameOrigin } from '@/lib/auth/origin';
import { requireSession } from '@/lib/auth/guard';
import { listSales, recordSale } from '@/lib/services/sales';
import { listSalesQuerySchema, recordSaleSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const query = parseQuery(new URL(request.url), listSalesQuerySchema);

    const result = await listSales(session.userId, query);

    return jsonOk(result);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    requireSameOrigin(request);

    const input = await parseJsonBody(request, recordSaleSchema);

    // actor='user': this path is a human clicking the form. The AI approval flow calls
    // the same service with actor='ai_assistant', which is what makes every stock change
    // traceable to its origin.
    const sale = await recordSale(session.userId, input, 'user');

    return jsonOk({ sale }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
