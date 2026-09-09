import { handleRouteError, jsonOk, parseJsonBody } from '@/lib/api';
import { requireSameOrigin } from '@/lib/auth/origin';
import { requireSession } from '@/lib/auth/guard';
import { adjustStock } from '@/lib/services/sales';
import { adjustStockSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    requireSameOrigin(request);

    const input = await parseJsonBody(request, adjustStockSchema);

    const result = await adjustStock(
      session.userId,
      input.productId,
      input.delta,
      input.reason,
      'user',
      input.note,
    );

    return jsonOk(result, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
