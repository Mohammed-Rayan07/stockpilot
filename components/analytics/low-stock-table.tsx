import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="font-medium">Nothing below its reorder point</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Every product is above the stock level you set for it.
            </p>
          </div>
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
                      {row.quantity === 0 && (
                        <Badge variant="destructive" className="ml-2">
                          Out
                        </Badge>
                      )}
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
