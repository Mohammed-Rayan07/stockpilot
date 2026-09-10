import { KpiCardsSkeleton } from '@/components/analytics/kpi-cards';
import { LowStockTableSkeleton } from '@/components/analytics/low-stock-table';
import { RevenueChartSkeleton } from '@/components/analytics/revenue-chart';
import { TopProductsChartSkeleton } from '@/components/analytics/top-products-chart';
import { Skeleton } from '@/components/ui/skeleton';

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      <KpiCardsSkeleton />
      <RevenueChartSkeleton />
      <TopProductsChartSkeleton />
      <LowStockTableSkeleton />
    </div>
  );
}
