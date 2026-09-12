import { KpiCards } from '@/components/analytics/kpi-cards';
import { LowStockTable } from '@/components/analytics/low-stock-table';
import { RevenueChart } from '@/components/analytics/revenue-chart';
import { TopProductsChart } from '@/components/analytics/top-products-chart';
import { requireSession } from '@/lib/auth/guard';
import { getDashboardMetrics } from '@/lib/services/analytics';
import { getReorderAdvice } from '@/lib/services/reorder';

export const runtime = 'nodejs';

export const metadata = { title: 'Dashboard · StockPilot' };

export default async function DashboardPage() {
  const session = await requireSession();

  // Reads may call services directly from a Server Component (§6); the low-stock table
  // reuses the same reorder-advice query the Reorder Advisor page runs, rather than a
  // second hand-rolled "products below threshold" query.
  const [metrics, advice] = await Promise.all([
    getDashboardMetrics(session.userId),
    getReorderAdvice(session.userId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm">
          Welcome back, {session.name}. Figures cover the last {metrics.days} days.
        </p>
      </div>

      <KpiCards
        revenue={metrics.revenue}
        units={metrics.units}
        stockValueAtCost={metrics.inventoryHealth.stockValueAtCost}
        bands={metrics.inventoryHealth.bands}
      />

      <RevenueChart data={metrics.revenueOverTime} />

      <TopProductsChart
        data={metrics.topProductsByUnits.map((p) => ({ name: p.name, units: p.units }))}
      />

      <LowStockTable
        rows={advice.items.map((item) => ({
          productId: item.productId,
          name: item.name,
          sku: item.sku,
          quantity: item.quantity,
          reorderThreshold: item.reorderThreshold,
          daysOfCover: item.daysOfCover,
        }))}
      />
    </div>
  );
}
