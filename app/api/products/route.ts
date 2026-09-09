import { handleRouteError, jsonOk, parseJsonBody, parseQuery } from '@/lib/api';
import { requireSameOrigin } from '@/lib/auth/origin';
import { requireSession } from '@/lib/auth/guard';
import { createProduct, listProducts } from '@/lib/services/products';
import { createProductSchema, listProductsQuerySchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const query = parseQuery(new URL(request.url), listProductsQuerySchema);

    const result = await listProducts(session.userId, {
      page: query.page,
      limit: query.limit,
      search: query.search,
      lowStockOnly: query.lowStock,
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

    const input = await parseJsonBody(request, createProductSchema);
    const product = await createProduct(session.userId, input);

    return jsonOk({ product }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
