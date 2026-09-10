import { afterAll, beforeAll, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { products, sales } from '@/lib/db/schema';
import { calculateReorderAdvice, getReorderAdvice } from '@/lib/services/reorder';
import { createSupplier } from '@/lib/services/suppliers';
import { createTestProduct, createTestUser, deleteTestUser } from './helpers';

// Proves one claim: §6.3's formulas, both as a pure calculation and end-to-end against a
// real sales fixture, match hand-computed values.

const DAY_MS = 24 * 60 * 60 * 1000;

test('calculateReorderAdvice matches hand-computed values', () => {
  const now = new Date('2026-01-31T00:00:00Z');

  // 30-day lookback, first sale 20 days ago, 40 units sold in that window.
  // observedDays = min(30, 20) = 20; dailyVelocity = 40 / 20 = 2.
  const result = calculateReorderAdvice({
    quantity: 10,
    unitsInWindow: 40,
    lookbackDays: 30,
    firstSaleAt: new Date(now.getTime() - 20 * DAY_MS),
    now,
    leadTimeDays: 5,
    safetyDays: 7,
  });

  expect(result.observedDays).toBe(20);
  expect(result.dailyVelocity).toBe(2);
  expect(result.daysOfCover).toBe(5); // 10 / 2
  expect(result.reorderPoint).toBe(24); // 2 * (5 + 7)
  // suggestedQty = ceil(2 * (5 + 7 + 7) - 10) = ceil(38 - 10) = 28
  expect(result.suggestedQty).toBe(28);
});

test('calculateReorderAdvice reports null days of cover with no sales', () => {
  const now = new Date('2026-01-31T00:00:00Z');

  const result = calculateReorderAdvice({
    quantity: 5,
    unitsInWindow: 0,
    lookbackDays: 30,
    firstSaleAt: null,
    now,
    leadTimeDays: 7,
    safetyDays: 7,
  });

  expect(result.dailyVelocity).toBe(0);
  expect(result.daysOfCover).toBeNull();
  // suggestedQty = ceil(0 * (...) - 5) = ceil(-5) = 0, clamped by max(0, ...)
  expect(result.suggestedQty).toBe(0);
});

let userId: string;

beforeAll(async () => {
  const user = await createTestUser('reorder-math');
  userId = user.id;
});

afterAll(async () => {
  await deleteTestUser(userId);
});

test('getReorderAdvice matches hand-computed values against a real sales fixture', async () => {
  const supplier = await createSupplier(userId, { name: 'Test Supplier', leadTimeDays: 5 });

  // At/below its own reorder threshold, so it is included in the advice.
  const product = await createTestProduct(userId, { quantity: 10, sku: 'REORDER-MATH-1' });
  await db
    .update(products)
    .set({ supplierId: supplier.id, reorderThreshold: 20 })
    .where(eq(products.id, product.id));

  const now = Date.now();
  // 4 sales inside a 30-day lookback, spread from 20 days ago to 2 days ago: 20 units total.
  const saleOffsetsDays = [20, 14, 8, 2];
  const saleUnits = [8, 6, 4, 2];

  for (let i = 0; i < saleOffsetsDays.length; i += 1) {
    await db.insert(sales).values({
      userId,
      productId: product.id,
      quantity: saleUnits[i],
      unitPrice: '100.00',
      unitCost: '40.00',
      totalAmount: (saleUnits[i] * 100).toFixed(2),
      soldAt: new Date(now - saleOffsetsDays[i] * DAY_MS),
    });
  }

  // No-sales product, also at/below threshold, to exercise the null-days-of-cover branch
  // and the "no supplier -> default lead time" fallback.
  const deadStock = await createTestProduct(userId, { quantity: 3, sku: 'REORDER-MATH-DEAD' });
  await db.update(products).set({ reorderThreshold: 5 }).where(eq(products.id, deadStock.id));

  const advice = await getReorderAdvice(userId, { safetyDays: 7, lookbackDays: 30 });

  const item = advice.items.find((i) => i.productId === product.id);
  expect(item).toBeDefined();
  // observedDays = min(30, 20) = 20; dailyVelocity = 20 / 20 = 1.
  expect(item!.observedDays).toBe(20);
  expect(item!.dailyVelocity).toBe(1);
  expect(item!.daysOfCover).toBe(10); // 10 / 1
  expect(item!.leadTimeDays).toBe(5); // from the linked supplier
  expect(item!.reorderPoint).toBe(12); // 1 * (5 + 7)
  // suggestedQty = ceil(1 * (5 + 7 + 7) - 10) = ceil(19 - 10) = 9
  expect(item!.suggestedQty).toBe(9);

  const deadItem = advice.items.find((i) => i.productId === deadStock.id);
  expect(deadItem).toBeDefined();
  expect(deadItem!.dailyVelocity).toBe(0);
  expect(deadItem!.daysOfCover).toBeNull();
  expect(deadItem!.leadTimeDays).toBe(7); // no supplier: falls back to the default

  expect(advice.assumptions).toHaveLength(4);
});
