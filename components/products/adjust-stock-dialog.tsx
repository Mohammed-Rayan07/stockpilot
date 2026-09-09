'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, apiPost } from '@/lib/client-api';

type Target = {
  id: string;
  name: string;
  quantity: number;
};

export function AdjustStockDialog({
  product,
  onClose,
}: {
  product: Target | null;
  onClose: () => void;
}) {
  const router = useRouter();

  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState<'restock' | 'adjustment'>('restock');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!product) return;

    setSaving(true);
    setFormError(null);

    try {
      await apiPost('/api/stock/adjust', {
        productId: product.id,
        delta: Number(delta),
        reason,
        note: note || null,
      });

      toast.success('Stock adjusted.');
      setDelta('');
      setNote('');
      onClose();
      router.refresh();
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.message : 'Could not reach the server.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={product !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust stock</DialogTitle>
          <DialogDescription>
            {product
              ? `${product.name} — currently ${product.quantity} in stock. Use a positive number to add, negative to remove.`
              : null}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="delta">Change</Label>
            <Input
              id="delta"
              inputMode="numeric"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder="e.g. 25 or -3"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">Reason</Label>
            <select
              id="reason"
              className="border-input bg-background h-8 w-full rounded-lg border px-2.5 text-sm"
              value={reason}
              onChange={(e) => setReason(e.target.value as 'restock' | 'adjustment')}
            >
              <option value="restock">Restock</option>
              <option value="adjustment">Adjustment (damage, count correction)</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="note">Note</Label>
            <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          {formError && (
            <p role="alert" className="text-destructive text-sm">
              {formError}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Apply adjustment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
