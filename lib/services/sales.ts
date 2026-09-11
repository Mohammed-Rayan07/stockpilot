import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import { products, sales, stockMovements, type StockMovementActor } from '../db/schema';
import {
  InsufficientStockError,
  isUniqueViolation,
  NotFoundError,
  ValidationError,
} from '../errors';
import { toMajor, toMinor } from '../money';

export type RecordSaleInput = {
  productId: string;
  quantity: number;
  unitPrice?: string;
  idempotencyKey?: string;
};

// Two customers buy the last unit at the same moment. Unlocked, both transactions read a
// quantity of one, both pass the stock check, and both write zero: one unit sold twice.
// That is a lost update.
//
// Postgres's default READ COMMITTED isolation does not prevent it. Each transaction reads
// from a snapshot taken at statement start, so both genuinely observe one unit and neither
// is doing anything the isolation level forbids.
//
// The row lock serialises them, which is why the stock check must come after it and never
// before: a quantity read outside the lock can change before it is acted on, and that gap
// is precisely the race the lock exists to close. The CHECK constraint forbidding negative
// stock is the backstop, refusing an oversell even if this logic were wrong.
export async function recordSale(
  userId: string,
  input: RecordSaleInput,
  actor: StockMovementActor = 'user',
) {
  try {
    return await db.transaction(async (tx) => {
      // 1. Lock the product row, scoped to this tenant. The userId predicate is what
      //    keeps one tenant from locking or reading another tenant's row.
      const [product] = await tx
        .select()
        .from(products)
        .where(and(eq(products.id, input.productId), eq(products.userId, userId)))
        .for('update');

      if (!product) {
        throw new NotFoundError('Product not found');
      }

      // 2. Check stock AFTER acquiring the lock, never before. Checking first and then
      //    locking would reintroduce the exact race the lock exists to prevent.
      if (product.quantity < input.quantity) {
        throw new InsufficientStockError(product.quantity, input.quantity);
      }

      const unitPriceMinor = toMinor(input.unitPrice ?? product.unitPrice);
      const newQuantity = product.quantity - input.quantity;

      // Every write carries its tenant predicate so correctness never depends on the
      // caller having scoped the read.
      await tx
        .update(products)
        .set({ quantity: newQuantity, updatedAt: new Date() })
        .where(and(eq(products.id, product.id), eq(products.userId, userId)));

      const [sale] = await tx
        .insert(sales)
        .values({
          userId,
          productId: product.id,
          quantity: input.quantity,
          // Price and cost are snapshotted here, not looked up later: a sale is a
          // historical fact and must not move when the product's price changes.
          unitPrice: toMajor(unitPriceMinor),
          unitCost: product.costPrice,
          totalAmount: toMajor(unitPriceMinor * input.quantity),
          idempotencyKey: input.idempotencyKey ?? null,
        })
        .returning();

      // 3. Append to the ledger in the SAME transaction. This is what keeps
      //    products.quantity and stock_movements in agreement (§4.2).
      await tx.insert(stockMovements).values({
        userId,
        productId: product.id,
        delta: -input.quantity,
        balanceAfter: newQuantity,
        reason: 'sale',
        referenceId: sale.id,
        actor,
      });

      return sale;
    });
  } catch (error) {
    // Idempotency is handled OUT here, not inside the callback. Once the insert raises
    // inside the transaction the transaction is aborted, so a catch in there could not
    // run the follow-up SELECT. A double-clicked submit button lands here and gets the
    // sale that was already recorded.
    if (input.idempotencyKey && isUniqueViolation(error)) {
      const [existing] = await db
        .select()
        .from(sales)
        .where(
          and(eq(sales.userId, userId), eq(sales.idempotencyKey, input.idempotencyKey)),
        );

      if (existing) {
        return existing;
      }
    }

    throw error;
  }
}

/**
 * One of the three functions permitted to write `products.quantity` -- the others are
 * recordSale, above, and createProduct's opening-stock insert. Same locked-transaction
 * pattern as recordSale, for the same reason: no change to quantity without a matching
 * stock_movements row in the same transaction.
 */
export async function adjustStock(
  userId: string,
  productId: string,
  delta: number,
  reason: 'restock' | 'adjustment',
  actor: StockMovementActor = 'user',
  note?: string | null,
) {
  return db.transaction(async (tx) => {
    const [product] = await tx
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.userId, userId)))
      .for('update');

    if (!product) {
      throw new NotFoundError('Product not found');
    }

    const newQuantity = product.quantity + delta;

    if (newQuantity < 0) {
      throw new ValidationError(
        `Adjustment would take stock below zero. Current quantity is ${product.quantity}.`,
        { available: product.quantity, delta },
      );
    }

    // Every write carries its tenant predicate so correctness never depends on the
    // caller having scoped the read.
    await tx
      .update(products)
      .set({ quantity: newQuantity, updatedAt: new Date() })
      .where(and(eq(products.id, product.id), eq(products.userId, userId)));

    const [movement] = await tx
      .insert(stockMovements)
      .values({
        userId,
        productId: product.id,
        delta,
        balanceAfter: newQuantity,
        reason,
        actor,
        note: note ?? null,
      })
      .returning();

    return { movement, quantity: newQuantity };
  });
}

export async function listSales(
  userId: string,
  opts: { page: number; limit: number; from?: string; to?: string },
) {
  const filters = [eq(sales.userId, userId)];

  if (opts.from) {
    filters.push(gte(sales.soldAt, new Date(opts.from)));
  }
  if (opts.to) {
    filters.push(lte(sales.soldAt, new Date(opts.to)));
  }

  const where = and(...filters);
  const offset = (opts.page - 1) * opts.limit;

  const rows = await db
    .select({
      id: sales.id,
      productId: sales.productId,
      productName: products.name,
      sku: products.sku,
      quantity: sales.quantity,
      unitPrice: sales.unitPrice,
      unitCost: sales.unitCost,
      totalAmount: sales.totalAmount,
      soldAt: sales.soldAt,
    })
    .from(sales)
    .innerJoin(products, eq(products.id, sales.productId))
    .where(where)
    .orderBy(desc(sales.soldAt))
    .limit(opts.limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sales)
    .where(where);

  return { sales: rows, total: count, page: opts.page, limit: opts.limit };
}
