import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { products, purchaseOrders, suppliers, type PurchaseOrderLine } from '../db/schema';
import { NotFoundError, ValidationError } from '../errors';
import { toMajor, toMinor } from '../money';

export type CreatePurchaseOrderDraftInput = {
  supplierId: string;
  lines: { productId: string; quantity: number }[];
};

/**
 * Snapshots each line's name, SKU and current cost price at draft time -- a PO line is a
 * point-in-time record of what was ordered at what cost, and must not change if the
 * product is edited afterwards (same reasoning as sale price snapshotting, §4.1).
 */
export async function createPurchaseOrderDraft(userId: string, input: CreatePurchaseOrderDraftInput) {
  const [supplier] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.id, input.supplierId), eq(suppliers.userId, userId)));

  if (!supplier) {
    throw new NotFoundError('Supplier not found');
  }

  const productIds = input.lines.map((line) => line.productId);
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.userId, userId), inArray(products.id, productIds)));

  const rowsById = new Map(rows.map((row) => [row.id, row]));

  let totalMinor = 0;
  const lines: PurchaseOrderLine[] = input.lines.map((line) => {
    const product = rowsById.get(line.productId);

    if (!product) {
      throw new NotFoundError('Product not found');
    }

    const unitCostMinor = toMinor(product.costPrice);
    totalMinor += unitCostMinor * line.quantity;

    return {
      product_id: product.id,
      name: product.name,
      sku: product.sku,
      quantity: line.quantity,
      unit_cost: product.costPrice,
    };
  });

  if (lines.length === 0) {
    throw new ValidationError('A purchase order needs at least one line.');
  }

  const [order] = await db
    .insert(purchaseOrders)
    .values({
      userId,
      supplierId: supplier.id,
      status: 'draft',
      lines,
      totalCost: toMajor(totalMinor),
    })
    .returning();

  return order;
}
