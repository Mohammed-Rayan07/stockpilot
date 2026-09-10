'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiPatch } from '@/lib/client-api';
import { formatINR } from '@/lib/money';
import type { PurchaseOrderLine, PurchaseOrderStatus } from '@/lib/db/schema';

export type PurchaseOrderRow = {
  id: string;
  supplierId: string;
  supplierName: string;
  status: PurchaseOrderStatus;
  lines: PurchaseOrderLine[];
  totalCost: string;
  emailDraft: string | null;
  createdAt: string;
};

const STATUS_VARIANT: Record<PurchaseOrderStatus, 'default' | 'secondary' | 'destructive'> = {
  draft: 'secondary',
  sent: 'default',
  cancelled: 'destructive',
};

export function PurchaseOrderList({ orders }: { orders: PurchaseOrderRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<PurchaseOrderRow | null>(null);
  const [emailDraft, setEmailDraft] = useState('');
  const [saving, setSaving] = useState<'draft' | 'send' | 'cancel' | null>(null);

  function openDetail(order: PurchaseOrderRow) {
    setOpen(order);
    setEmailDraft(order.emailDraft ?? '');
  }

  async function onSaveDraft() {
    if (!open) return;
    setSaving('draft');
    try {
      await apiPatch(`/api/purchase-orders/${open.id}`, { emailDraft });
      toast.success('Email draft saved.');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not reach the server.');
    } finally {
      setSaving(null);
    }
  }

  async function onChangeStatus(status: 'sent' | 'cancelled') {
    if (!open) return;
    setSaving(status === 'sent' ? 'send' : 'cancel');
    try {
      await apiPatch(`/api/purchase-orders/${open.id}`, { status });
      toast.success(status === 'sent' ? 'Marked as sent.' : 'Purchase order cancelled.');
      setOpen(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not reach the server.');
    } finally {
      setSaving(null);
    }
  }

  if (orders.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center">
        <p className="font-medium">No purchase orders yet</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Draft one from the Reorder Advisor page.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Supplier</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => (
              <TableRow key={order.id}>
                <TableCell className="font-medium">{order.supplierName}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[order.status]}>{order.status}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{order.lines.length}</TableCell>
                <TableCell className="text-right">{formatINR(order.totalCost)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {new Intl.DateTimeFormat('en-IN', {
                    dateStyle: 'medium',
                    timeZone: 'Asia/Kolkata',
                  }).format(new Date(order.createdAt))}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => openDetail(order)}>
                    View
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent className="sm:max-w-lg">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>{open.supplierName}</DialogTitle>
                <DialogDescription>
                  {open.lines.length} line{open.lines.length === 1 ? '' : 's'}, total{' '}
                  {formatINR(open.totalCost)}.
                </DialogDescription>
              </DialogHeader>

              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2 text-sm">
                {open.lines.map((line) => (
                  <div key={line.product_id} className="flex justify-between">
                    <span>
                      {line.name}{' '}
                      <span className="text-muted-foreground font-mono text-xs">{line.sku}</span>
                    </span>
                    <span className="tabular-nums">
                      {line.quantity} × {formatINR(line.unit_cost)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Supplier email</p>
                <Textarea
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  rows={8}
                  disabled={open.status !== 'draft' || saving !== null}
                  placeholder="No draft was generated. Write one to send with this order."
                />
              </div>

              <DialogFooter className="flex-wrap gap-2">
                {open.status === 'draft' ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => onChangeStatus('cancelled')}
                      disabled={saving !== null}
                    >
                      {saving === 'cancel' ? 'Cancelling…' : 'Cancel order'}
                    </Button>
                    <Button variant="outline" onClick={onSaveDraft} disabled={saving !== null}>
                      {saving === 'draft' ? 'Saving…' : 'Save email draft'}
                    </Button>
                    <Button onClick={() => onChangeStatus('sent')} disabled={saving !== null}>
                      {saving === 'send' ? 'Marking…' : 'Mark as sent'}
                    </Button>
                  </>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    This order is {open.status} and can no longer be edited.
                  </p>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
