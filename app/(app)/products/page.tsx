import { ProductManager } from '@/components/products/product-manager';
import { requireSession } from '@/lib/auth/guard';
import { listProducts } from '@/lib/services/products';
import { listSuppliers } from '@/lib/services/suppliers';

export const runtime = 'nodejs';

export const metadata = { title: 'Products · StockPilot' };

export default async function ProductsPage() {
  const session = await requireSession();

  // Reads may call services directly from a Server Component (§6). Writes always go
  // through a route handler, which is where the origin check lives.
  const [{ products }, suppliers] = await Promise.all([
    listProducts(session.userId, { page: 1, limit: 100 }),
    listSuppliers(session.userId),
  ]);

  return (
    <ProductManager
      products={products}
      suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
    />
  );
}
