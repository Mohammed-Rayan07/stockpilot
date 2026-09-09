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

// Supplier creation lives in a dialog on the products page rather than its own route,
// because §9's file structure defines no /suppliers page and §3.3 forbids adding one.

export function SupplierDialog({ supplierCount }: { supplierCount: number }) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [leadTimeDays, setLeadTimeDays] = useState('7');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});
    setFormError(null);

    try {
      await apiPost('/api/suppliers', {
        name,
        email: email || null,
        leadTimeDays: Number(leadTimeDays),
      });

      toast.success('Supplier added.');
      setName('');
      setEmail('');
      setLeadTimeDays('7');
      setOpen(false);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(error.fields);
        setFormError(error.message);
      } else {
        setFormError('Could not reach the server.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Suppliers ({supplierCount})
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add supplier</DialogTitle>
            <DialogDescription>
              Lead time feeds the reorder calculation: it is how many days an order takes
              to arrive.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="supplier-name">Name</Label>
              <Input
                id="supplier-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              {fieldErrors.name && <p className="text-destructive text-sm">{fieldErrors.name}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="supplier-email">Email</Label>
              <Input
                id="supplier-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="orders@supplier.example"
              />
              {fieldErrors.email && (
                <p className="text-destructive text-sm">{fieldErrors.email}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="supplier-lead">Lead time (days)</Label>
              <Input
                id="supplier-lead"
                inputMode="numeric"
                value={leadTimeDays}
                onChange={(e) => setLeadTimeDays(e.target.value)}
                required
              />
              {fieldErrors.leadTimeDays && (
                <p className="text-destructive text-sm">{fieldErrors.leadTimeDays}</p>
              )}
            </div>

            {formError && (
              <p role="alert" className="text-destructive text-sm">
                {formError}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Add supplier'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
