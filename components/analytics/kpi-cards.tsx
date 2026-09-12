import { IndianRupee, PackageCheck, ShoppingCart, TriangleAlert, Warehouse } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatINR } from '@/lib/money';
import type { StockHealthBand } from '@/lib/services/analytics';

export type KpiCardsProps = {
  revenue: string;
  units: number;
  stockValueAtCost: string;
  bands: Record<StockHealthBand, number>;
};

const ICON_TONE = {
  primary: 'bg-primary/10 text-primary',
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
} as const;

function IconBadge({ icon: Icon, tone }: { icon: LucideIcon; tone: keyof typeof ICON_TONE }) {
  return (
    <span className={`inline-flex size-8 items-center justify-center rounded-lg ${ICON_TONE[tone]}`}>
      <Icon className="size-4" />
    </span>
  );
}

function KpiCard({
  icon,
  tone,
  label,
  value,
}: {
  icon: LucideIcon;
  tone: keyof typeof ICON_TONE;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-3">
        <IconBadge icon={icon} tone={tone} />
        <div>
          <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
          <p className="text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// The 4th card renders the same healthy/low/out-of-stock bands the reorder advisor and
// low-stock table already compute (lib/services/analytics.ts), as a small segmented bar
// instead of one bare count -- the "SKUs below reorder point" number is still exactly
// what it was, just shown with what it's a fraction of.
function StockHealthCard({ bands }: { bands: Record<StockHealthBand, number> }) {
  const atRisk = bands.low + bands.out_of_stock;
  const total = bands.healthy + atRisk;
  const healthy = atRisk === 0;

  return (
    <Card>
      <CardContent className="space-y-3">
        <IconBadge icon={healthy ? PackageCheck : TriangleAlert} tone={healthy ? 'success' : 'warning'} />
        <div>
          <p className="text-[13px] font-medium text-muted-foreground">SKUs below reorder point</p>
          <p className="text-3xl font-semibold tracking-tight tabular-nums">{atRisk}</p>
        </div>
        {total > 0 && (
          <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${bands.healthy} healthy, ${bands.low} low, ${bands.out_of_stock} out of stock`}>
            {bands.healthy > 0 && (
              <div className="bg-success" style={{ width: `${(bands.healthy / total) * 100}%` }} />
            )}
            {bands.low > 0 && (
              <div className="bg-warning" style={{ width: `${(bands.low / total) * 100}%` }} />
            )}
            {bands.out_of_stock > 0 && (
              <div className="bg-destructive" style={{ width: `${(bands.out_of_stock / total) * 100}%` }} />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function KpiCards({ revenue, units, stockValueAtCost, bands }: KpiCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <KpiCard icon={IndianRupee} tone="primary" label="Revenue (30d)" value={formatINR(revenue)} />
      <KpiCard icon={ShoppingCart} tone="neutral" label="Units sold (30d)" value={String(units)} />
      <KpiCard icon={Warehouse} tone="neutral" label="Stock value at cost" value={formatINR(stockValueAtCost)} />
      <StockHealthCard bands={bands} />
    </div>
  );
}

export function KpiCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="space-y-3">
            <Skeleton className="size-8 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-20" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
