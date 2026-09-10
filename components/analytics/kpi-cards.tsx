import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatINR } from '@/lib/money';

export type KpiCardsProps = {
  revenue: string;
  units: number;
  stockValueAtCost: string;
  skusBelowReorder: number;
};

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-muted-foreground text-sm font-normal">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

export function KpiCards({ revenue, units, stockValueAtCost, skusBelowReorder }: KpiCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <KpiCard label="Revenue (30d)" value={formatINR(revenue)} />
      <KpiCard label="Units sold (30d)" value={String(units)} />
      <KpiCard label="Stock value at cost" value={formatINR(stockValueAtCost)} />
      <KpiCard label="SKUs below reorder point" value={String(skusBelowReorder)} />
    </div>
  );
}

export function KpiCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-4 w-24" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
