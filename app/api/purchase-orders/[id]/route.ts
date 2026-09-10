import { handleRouteError, jsonOk, parseJsonBody } from '@/lib/api';
import { requireSameOrigin } from '@/lib/auth/origin';
import { requireSession } from '@/lib/auth/guard';
import { updatePurchaseOrder } from '@/lib/services/purchase-orders';
import { updatePurchaseOrderSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireSameOrigin(request);
    const { id } = await params;

    const input = await parseJsonBody(request, updatePurchaseOrderSchema);
    const order = await updatePurchaseOrder(session.userId, id, input);

    return jsonOk({ purchaseOrder: order });
  } catch (error) {
    return handleRouteError(error);
  }
}
