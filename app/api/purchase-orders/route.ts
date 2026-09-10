import { handleRouteError, jsonOk, parseJsonBody, parseQuery } from '@/lib/api';
import { requireSameOrigin } from '@/lib/auth/origin';
import { requireSession } from '@/lib/auth/guard';
import { createPurchaseOrderDraft, listPurchaseOrders } from '@/lib/services/purchase-orders';
import { createPurchaseOrderSchema, paginationSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const query = parseQuery(new URL(request.url), paginationSchema);

    const result = await listPurchaseOrders(session.userId, {
      page: query.page,
      limit: query.limit,
    });

    return jsonOk(result);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    requireSameOrigin(request);

    const input = await parseJsonBody(request, createPurchaseOrderSchema);
    const order = await createPurchaseOrderDraft(session.userId, input);

    return jsonOk({ purchaseOrder: order }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
