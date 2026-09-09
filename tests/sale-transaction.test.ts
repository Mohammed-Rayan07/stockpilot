import { afterAll, beforeAll, expect, test } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { products, sales, stockMovements } from '@/lib/db/schema';
import { InsufficientStockError } from '@/lib/errors';
import { recordSale } from '@/lib/services/sales';
import { createTestProduct, createTestUser, deleteTestUser } from './helpers';

// Proves one claim: two concurrent sales of the last remaining unit cannot both succeed.
//
// This is the lost-update race. Without SELECT ... FOR UPDATE both transactions would
// read quantity = 1 from their own valid READ COMMITTED snapshot, both would pass the
// stock check, and both would write quantity = 0 — selling one unit twice.

let userId: string;

beforeAll(async () => {
  const user = await createTestUser('concurrency');
  userId = user.id;
});

afterAll(async () => {
  await deleteTestUser(userId);
});

test('two concurrent sales of the last unit: one succeeds, one fails', async () => {
  const product = await createTestProduct(userId, { quantity: 1, unitPrice: '250.00' });

  // allSettled, not all: one of these is expected to reject, and Promise.all would
  // discard the other result.
  const [first, second] = await Promise.allSettled([
    recordSale(userId, { productId: product.id, quantity: 1 }),
    recordSale(userId, { productId: product.id, quantity: 1 }),
  ]);

  const fulfilled = [first, second].filter((r) => r.status === 'fulfilled');
  const rejected = [first, second].filter((r) => r.status === 'rejected');

  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect(rejected[0].reason).toBeInstanceOf(InsufficientStockError);

  const [finalProduct] = await db.select().from(products).where(eq(products.id, product.id));
  expect(finalProduct.quantity).toBe(0);

  const saleRows = await db.select().from(sales).where(eq(sales.productId, product.id));
  expect(saleRows).toHaveLength(1);

  // The ledger must agree with products.quantity — the §4.2 invariant.
  const [{ ledgerBalance }] = await db
    .select({ ledgerBalance: sql<number>`COALESCE(SUM(${stockMovements.delta}), 0)::int` })
    .from(stockMovements)
    .where(eq(stockMovements.productId, product.id));

  expect(ledgerBalance).toBe(finalProduct.quantity);
});

test('insufficient stock leaves quantity unchanged and writes nothing', async () => {
  const product = await createTestProduct(userId, { quantity: 3 });

  await expect(recordSale(userId, { productId: product.id, quantity: 5 })).rejects.toBeInstanceOf(
    InsufficientStockError,
  );

  const [after] = await db.select().from(products).where(eq(products.id, product.id));
  expect(after.quantity).toBe(3);

  const saleRows = await db.select().from(sales).where(eq(sales.productId, product.id));
  expect(saleRows).toHaveLength(0);

  const movements = await db
    .select()
    .from(stockMovements)
    .where(eq(stockMovements.productId, product.id));
  expect(movements).toHaveLength(0);
});

test('a repeated idempotency key returns the original sale rather than selling twice', async () => {
  const product = await createTestProduct(userId, { quantity: 10 });
  const idempotencyKey = `test-key-${product.id}`;

  const firstSale = await recordSale(userId, {
    productId: product.id,
    quantity: 2,
    idempotencyKey,
  });

  const secondSale = await recordSale(userId, {
    productId: product.id,
    quantity: 2,
    idempotencyKey,
  });

  expect(secondSale.id).toBe(firstSale.id);

  const [after] = await db.select().from(products).where(eq(products.id, product.id));
  expect(after.quantity).toBe(8);

  const saleRows = await db
    .select()
    .from(sales)
    .where(and(eq(sales.productId, product.id), eq(sales.idempotencyKey, idempotencyKey)));
  expect(saleRows).toHaveLength(1);
});
