'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Archive, Package, Pencil, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { AdjustStockDialog } from '@/components/products/adjust-stock-dialog';
import { SupplierDialog } from '@/components/products/supplier-dialog';
import { StockHealthBadge } from '@/components/status-badges';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiDelete, apiPatch, apiPost } from '@/lib/client-api';
import { formatINR } from '@/lib/money';
import type { StockHealthBand } from '@/lib/services/analytics';

function stockHealthBand(quantity: number, reorderThreshold: number): StockHealthBand {
  if (quantity <= 0) return 'out_of_stock';
  if (quantity <= reorderThreshold) return 'low';
  return 'healthy';
}

export type ProductRow = {
  id: string;
  name: string;
  sku: string;
  description: string | null;
  unitPrice: string;
  costPrice: string;
  quantity: number;
  reorderThreshold: number;
  supplierId: string | null;
  supplierName: string | null;
};

export type SupplierOption = {
  id: string;
  name: string;
};

type FormState = {
  name: string;
  sku: string;
  description: string;
  unitPrice: string;
  costPrice: string;
  quantity: string;
  reorderThreshold: string;
  supplierId: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  sku: '',
  description: '',
  unitPrice: '',
  costPrice: '',
  quantity: '0',
  reorderThreshold: '0',
  supplierId: '',
};

export function ProductManager({
  products,
  suppliers,
}: {
  products: ProductRow[];
  suppliers: SupplierOption[];
}) {
  const router = useRouter();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [adjusting, setAdjusting] = useState<ProductRow | null>(null);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(product: ProductRow) {
    setEditingId(product.id);
    setForm({
      name: product.name,
      sku: product.sku,
      description: product.description ?? '',
      unitPrice: product.unitPrice,
      costPrice: product.costPrice,
      quantity: String(product.quantity),
      reorderThreshold: String(product.reorderThreshold),
      supplierId: product.supplierId ?? '',
    });
    setFieldErrors({});
    setFormError(null);
    setDialogOpen(true);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});
    setFormError(null);

    const shared = {
      name: form.name,
      sku: form.sku,
      description: form.description || null,
      unitPrice: form.unitPrice,
      costPrice: form.costPrice,
      reorderThreshold: Number(form.reorderThreshold),
      supplierId: form.supplierId || null,
    };

    try {
      if (editingId) {
        // quantity is intentionally not sent: stock moves only via sales and adjustments.
        await apiPatch(`/api/products/${editingId}`, shared);
        toast.success('Product updated.');
      } else {
        await apiPost('/api/products', { ...shared, quantity: Number(form.quantity) });
        toast.success('Product created.');
      }

      setDialogOpen(false);
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

  async function onArchive(product: ProductRow) {
    if (!window.confirm(`Archive "${product.name}"? Its sales history is kept.`)) {
      return;
    }

    try {
      await apiDelete(`/api/products/${product.id}`);
      toast.success('Product archived.');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not archive product.');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
          <p className="text-muted-foreground text-sm">
            {products.length} active {products.length === 1 ? 'product' : 'products'}.
          </p>
        </div>
        <div className="flex gap-2">
          <SupplierDialog supplierCount={suppliers.length} />
          <Button onClick={openCreate}>Add product</Button>
        </div>
      </div>

      {products.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No products yet"
          description="Add your first product to start tracking stock."
          action={<Button onClick={openCreate}>Add product</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => {
                const band = stockHealthBand(product.quantity, product.reorderThreshold);
                return (
                  <TableRow key={product.id}>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell className="font-mono text-xs">{product.sku}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {product.supplierName ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">{formatINR(product.unitPrice)}</TableCell>
                    <TableCell className="text-right">{formatINR(product.costPrice)}</TableCell>
                    <TableCell className="text-right">
                      <span className="tabular-nums">{product.quantity}</span>
                      <StockHealthBadge band={band} className="ml-2" />
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(product)}>
                        <Pencil /> Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setAdjusting(product)}>
                        <SlidersHorizontal /> Adjust
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => onArchive(product)}>
                        <Archive /> Archive
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AdjustStockDialog product={adjusting} onClose={() => setAdjusting(null)} />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit product' : 'Add product'}</DialogTitle>
            <DialogDescription>
              {editingId
                ? 'Stock quantity is changed through sales and stock adjustments, not here.'
                : 'Opening stock is recorded in the movement ledger.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
              {fieldErrors.name && <p className="text-destructive text-sm">{fieldErrors.name}</p>}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="sku">SKU</Label>
                <Input
                  id="sku"
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  required
                />
                {fieldErrors.sku && <p className="text-destructive text-sm">{fieldErrors.sku}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="supplierId">Supplier</Label>
                <select
                  id="supplierId"
                  className="border-input bg-background h-8 w-full rounded-lg border px-2.5 text-sm"
                  value={form.supplierId}
                  onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
                >
                  <option value="">None</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="unitPrice">Sell price (₹)</Label>
                <Input
                  id="unitPrice"
                  inputMode="decimal"
                  value={form.unitPrice}
                  onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
                  placeholder="499.00"
                  required
                />
                {fieldErrors.unitPrice && (
                  <p className="text-destructive text-sm">{fieldErrors.unitPrice}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="costPrice">Cost price (₹)</Label>
                <Input
                  id="costPrice"
                  inputMode="decimal"
                  value={form.costPrice}
                  onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                  placeholder="210.00"
                  required
                />
                {fieldErrors.costPrice && (
                  <p className="text-destructive text-sm">{fieldErrors.costPrice}</p>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {!editingId && (
                <div className="space-y-2">
                  <Label htmlFor="quantity">Opening stock</Label>
                  <Input
                    id="quantity"
                    inputMode="numeric"
                    value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="reorderThreshold">Reorder threshold</Label>
                <Input
                  id="reorderThreshold"
                  inputMode="numeric"
                  value={form.reorderThreshold}
                  onChange={(e) => setForm({ ...form, reorderThreshold: e.target.value })}
                />
              </div>
            </div>

            {formError && (
              <p role="alert" className="text-destructive text-sm">
                {formError}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create product'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
