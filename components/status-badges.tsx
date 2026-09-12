import { Ban, CircleCheck, CircleX, PencilLine, Send, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { PurchaseOrderStatus } from '@/lib/db/schema';
import type { StockHealthBand } from '@/lib/services/analytics';

// One badge per status enum, used everywhere that status appears (products table,
// low-stock table, the dashboard health card, purchase orders) so the same count or row
// always reads the same way. healthy=success, low=warning, out_of_stock=destructive for
// stock; draft=neutral, sent=info, cancelled=neutral for purchase orders -- cancelling an
// order isn't an error, so it never gets destructive/red.

const STOCK_HEALTH: Record<StockHealthBand, { label: string; variant: 'success' | 'warning' | 'destructive'; Icon: typeof CircleCheck }> = {
  healthy: { label: 'Healthy', variant: 'success', Icon: CircleCheck },
  low: { label: 'Low', variant: 'warning', Icon: TriangleAlert },
  out_of_stock: { label: 'Out', variant: 'destructive', Icon: CircleX },
};

export function StockHealthBadge({ band, className }: { band: StockHealthBand; className?: string }) {
  const { label, variant, Icon } = STOCK_HEALTH[band];
  return (
    <Badge variant={variant} className={className}>
      <Icon />
      {label}
    </Badge>
  );
}

const PO_STATUS: Record<PurchaseOrderStatus, { label: string; variant: 'outline' | 'info' | 'secondary'; Icon: typeof PencilLine }> = {
  draft: { label: 'Draft', variant: 'outline', Icon: PencilLine },
  sent: { label: 'Sent', variant: 'info', Icon: Send },
  cancelled: { label: 'Cancelled', variant: 'secondary', Icon: Ban },
};

export function PoStatusBadge({ status, className }: { status: PurchaseOrderStatus; className?: string }) {
  const { label, variant, Icon } = PO_STATUS[status];
  return (
    <Badge variant={variant} className={className}>
      <Icon />
      {label}
    </Badge>
  );
}
