import { handleRouteError, jsonOk, parseJsonBody } from '@/lib/api';
import { requireSameOrigin } from '@/lib/auth/origin';
import { requireSession } from '@/lib/auth/guard';
import { createSupplier, listSuppliers } from '@/lib/services/suppliers';
import { createSupplierSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const session = await requireSession();
    const suppliers = await listSuppliers(session.userId);

    return jsonOk({ suppliers });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    requireSameOrigin(request);

    const input = await parseJsonBody(request, createSupplierSchema);
    const supplier = await createSupplier(session.userId, input);

    return jsonOk({ supplier }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
