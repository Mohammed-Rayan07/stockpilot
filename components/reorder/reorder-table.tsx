'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError, apiPost } from '@/lib/client-api';

export type ReorderRow = {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  reorderThreshold: number;
  supplierId: string | null;
  supplierName: string | null;
  dailyVelocity: number;
  daysOfCover: number | null;
  leadTimeDays: number;
  suggestedQty: number;
};

export function ReorderTable({
  items,
  assumptions,
  lookbackDays,
  safetyDays,
}: {
  items: ReorderRow[];
  assumptions: readonly string[];
  lookbackDays: number;
  safetyDays: number;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((item) => [item.productId, item.suggestedQty])),
  );
  const [drafting, setDrafting] = useState(false);

  const selectedCount = selected.size;

  const selectedBySupplier = useMemo(() => {
    const groups = new Map<string, { supplierName: string; items: ReorderRow[] }>();
    for (const item of items) {
      if (!selected.has(item.productId) || !item.supplierId) continue;
      const group = groups.get(item.supplierId) ?? {
        supplierName: item.supplierName ?? 'Unknown supplier',
        items: [],
      };
      group.items.push(item);
      groups.set(item.supplierId, group);
    }
    return groups;
  }, [items, selected]);

  function toggle(productId: string, hasSupplier: boolean) {
    if (!hasSupplier) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  async function onDraft() {
    setDrafting(true);
    let created = 0;

    try {
      for (const [supplierId, group] of selectedBySupplier) {
        await apiPost('/api/purchase-orders', {
          supplierId,
          lines: group.items.map((item) => ({
            productId: item.productId,
            quantity: Math.max(1, quantities[item.productId] ?? item.suggestedQty),
          })),
        });
        created += 1;
      }

      toast.success(`Created ${created} purchase order${created === 1 ? '' : 's'}.`);
      setSelected(new Set());
      router.push('/purchase-orders');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not create purchase order.');
    } finally {
      setDrafting(false);
    }
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={PackageCheck}
            tone="positive"
            title="Nothing needs reordering"
            description="Every product is above the stock level you set for it."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-normal">Methodology and assumptions</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Based on the last {lookbackDays} days of sales, with a {safetyDays}-day safety
            buffer. This is a transparent heuristic, not a service-level-optimal model:
          </p>
          <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-5 text-sm">
            {assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Product</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead className="text-right">Units/day</TableHead>
              <TableHead className="text-right">Days of cover</TableHead>
              <TableHead className="text-right">Lead time</TableHead>
              <TableHead className="text-right">Order qty</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const hasSupplier = item.supplierId !== null;
              return (
                <TableRow key={item.productId}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selected.has(item.productId)}
                      disabled={!hasSupplier}
                      onChange={() => toggle(item.productId, hasSupplier)}
                      aria-label={`Select ${item.name}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    {item.name}
                    <span className="text-muted-foreground ml-2 font-mono text-xs">
                      {item.sku}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.supplierName ?? 'No supplier set'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.quantity} / {item.reorderThreshold}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.dailyVelocity.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.daysOfCover === null ? '—' : item.daysOfCover.toFixed(1)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{item.leadTimeDays}d</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min={1}
                      inputMode="numeric"
                      className="ml-auto h-8 w-20 text-right tabular-nums"
                      value={quantities[item.productId] ?? item.suggestedQty}
                      disabled={!hasSupplier}
                      onChange={(e) =>
                        setQuantities((prev) => ({
                          ...prev,
                          [item.productId]: Number(e.target.value),
                        }))
                      }
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {selectedCount === 0
            ? 'Select products to draft purchase orders, grouped by supplier.'
            : `${selectedCount} selected across ${selectedBySupplier.size} supplier${selectedBySupplier.size === 1 ? '' : 's'}.`}
        </p>
        <Button onClick={onDraft} disabled={selectedCount === 0 || drafting}>
          {drafting ? 'Drafting…' : 'Draft purchase order(s)'}
        </Button>
      </div>
    </div>
  );
}
