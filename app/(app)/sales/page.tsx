import { SalesManager } from '@/components/sales/sales-manager';
import { requireSession } from '@/lib/auth/guard';
import { listProducts } from '@/lib/services/products';
import { listSales } from '@/lib/services/sales';

export const runtime = 'nodejs';

export const metadata = { title: 'Sales · StockPilot' };

export default async function SalesPage() {
  const session = await requireSession();

  const [salesResult, productsResult] = await Promise.all([
    listSales(session.userId, { page: 1, limit: 50 }),
    listProducts(session.userId, { page: 1, limit: 100 }),
  ]);

  return (
    <SalesManager
      sales={salesResult.sales.map((sale) => ({
        id: sale.id,
        productName: sale.productName,
        sku: sale.sku,
        quantity: sale.quantity,
        unitPrice: sale.unitPrice,
        totalAmount: sale.totalAmount,
        soldAt: sale.soldAt.toISOString(),
      }))}
      products={productsResult.products.map((product) => ({
        id: product.id,
        name: product.name,
        sku: product.sku,
        quantity: product.quantity,
        unitPrice: product.unitPrice,
      }))}
    />
  );
}
