import { PackageCheck } from 'lucide-react';
import { StockHealthBadge } from '@/components/status-badges';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export type LowStockRow = {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  reorderThreshold: number;
  daysOfCover: number | null;
};

export function LowStockTable({ rows }: { rows: LowStockRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Low stock</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState
            icon={PackageCheck}
            tone="positive"
            title="Nothing below its reorder point"
            description="Every product is above the stock level you set for it."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Reorder at</TableHead>
                  <TableHead className="text-right">Days of cover</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.productId}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="font-mono text-xs">{row.sku}</TableCell>
                    <TableCell className="text-right">
                      <span className="tabular-nums">{row.quantity}</span>
                      <StockHealthBadge
                        band={row.quantity <= 0 ? 'out_of_stock' : 'low'}
                        className="ml-2"
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.reorderThreshold}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.daysOfCover === null ? '—' : row.daysOfCover.toFixed(1)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function LowStockTableSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Low stock</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}
