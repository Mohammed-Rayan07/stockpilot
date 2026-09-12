import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// One component for every "nothing here yet" view (products, sales, purchase orders,
// reorder, low stock) instead of each page hand-rolling its own dashed box. `tone`
// distinguishes a genuinely empty state (neutral) from a good-news empty state, e.g.
// "nothing needs reordering" (positive).

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = 'neutral',
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: 'neutral' | 'positive';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-xl bg-muted/30 px-6 py-12 text-center ring-1 ring-foreground/[0.08]',
        className,
      )}
    >
      <span
        className={cn(
          'mx-auto mb-4 inline-flex size-12 items-center justify-center rounded-full',
          tone === 'positive' ? 'bg-success/10 text-success' : 'bg-background text-muted-foreground ring-1 ring-foreground/[0.08]',
        )}
      >
        <Icon className="size-6" strokeWidth={1.5} />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
