import { PurchaseOrderList } from '@/components/purchase-orders/purchase-order-list';
import { requireSession } from '@/lib/auth/guard';
import { listPurchaseOrders } from '@/lib/services/purchase-orders';

export const runtime = 'nodejs';

export const metadata = { title: 'Purchase orders · StockPilot' };

export default async function PurchaseOrdersPage() {
  const session = await requireSession();
  const { purchaseOrders } = await listPurchaseOrders(session.userId, { page: 1, limit: 50 });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Purchase orders</h1>
        <p className="text-muted-foreground text-sm">
          Drafts created from the Reorder Advisor. Review the AI-written email, edit it, and
          mark it sent once you&rsquo;ve placed the order with your supplier.
        </p>
      </div>

      <PurchaseOrderList
        orders={purchaseOrders.map((order) => ({
          ...order,
          createdAt: order.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
