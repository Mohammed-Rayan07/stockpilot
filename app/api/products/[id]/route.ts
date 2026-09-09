import { handleRouteError, jsonOk, parseJsonBody } from '@/lib/api';
import { requireSameOrigin } from '@/lib/auth/origin';
import { requireSession } from '@/lib/auth/guard';
import { archiveProduct, updateProduct } from '@/lib/services/products';
import { updateProductSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';

// Next 15 hands route params as a Promise.
type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const session = await requireSession();
    requireSameOrigin(request);

    const { id } = await context.params;
    const input = await parseJsonBody(request, updateProductSchema);

    // The service re-checks ownership; the id in the URL is never trusted on its own.
    const product = await updateProduct(session.userId, id, input);

    return jsonOk({ product });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const session = await requireSession();
    requireSameOrigin(request);

    const { id } = await context.params;

    // Archive, not delete: sales reference products with ON DELETE RESTRICT.
    const product = await archiveProduct(session.userId, id);

    return jsonOk({ product });
  } catch (error) {
    return handleRouteError(error);
  }
}
