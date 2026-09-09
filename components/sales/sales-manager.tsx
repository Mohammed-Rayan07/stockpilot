'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { ApiError, apiPost } from '@/lib/client-api';
import { formatINR } from '@/lib/money';

export type SaleRow = {
  id: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: string;
  totalAmount: string;
  soldAt: string;
};

export type SellableProduct = {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  unitPrice: string;
};

export function SalesManager({
  sales,
  products,
}: {
  sales: SaleRow[];
  products: SellableProduct[];
}) {
  const router = useRouter();

  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [quantity, setQuantity] = useState('1');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selected = products.find((p) => p.id === productId);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);

    try {
      await apiPost('/api/sales', {
        productId,
        quantity: Number(quantity),
        // A fresh key per submission makes a double-clicked button safe: the second
        // request hits the partial unique index and returns the first sale unchanged.
        idempotencyKey: crypto.randomUUID(),
      });

      toast.success('Sale recorded.');
      setQuantity('1');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.message);
      } else {
        setFormError('Could not reach the server.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sales</h1>
        <p className="text-muted-foreground text-sm">
          Logging a sale decrements stock in the same transaction.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Log a sale</CardTitle>
        </CardHeader>
        <CardContent>
          {products.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Add a product before logging a sale.
            </p>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-4" noValidate>
              <div className="min-w-56 flex-1 space-y-2">
                <Label htmlFor="productId">Product</Label>
                <select
                  id="productId"
                  className="border-input bg-background h-8 w-full rounded-lg border px-2.5 text-sm"
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                >
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} ({product.quantity} in stock)
                    </option>
                  ))}
                </select>
              </div>

              <div className="w-28 space-y-2">
                <Label htmlFor="quantity">Quantity</Label>
                <Input
                  id="quantity"
                  inputMode="numeric"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  required
                />
              </div>

              <div className="text-muted-foreground pb-2 text-sm">
                {selected ? `at ${formatINR(selected.unitPrice)} each` : null}
              </div>

              <Button type="submit" disabled={submitting}>
                {submitting ? 'Recording…' : 'Record sale'}
              </Button>
            </form>
          )}

          {formError && (
            <p role="alert" className="text-destructive mt-3 text-sm">
              {formError}
            </p>
          )}
        </CardContent>
      </Card>

      {sales.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="font-medium">No sales yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Recorded sales will appear here, most recent first.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sold at</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.map((sale) => (
                <TableRow key={sale.id}>
                  <TableCell className="whitespace-nowrap">
                    {new Date(sale.soldAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="font-medium">{sale.productName}</TableCell>
                  <TableCell className="font-mono text-xs">{sale.sku}</TableCell>
                  <TableCell className="text-right tabular-nums">{sale.quantity}</TableCell>
                  <TableCell className="text-right">{formatINR(sale.unitPrice)}</TableCell>
                  <TableCell className="text-right">{formatINR(sale.totalAmount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
