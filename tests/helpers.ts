import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  aiToolInvocations,
  products,
  purchaseOrders,
  sales,
  sessions,
  stockMovements,
  suppliers,
  users,
} from '@/lib/db/schema';
import { createProduct } from '@/lib/services/products';

/** Creates a throwaway user. Each test gets its own so tests cannot interfere. */
export async function createTestUser(label: string) {
  const [user] = await db
    .insert(users)
    .values({
      email: `test-${label}-${randomUUID()}@example.test`,
      passwordHash: 'not-a-real-hash',
      name: `Test ${label}`,
    })
    .returning();

  return user;
}

export async function createTestProduct(
  userId: string,
  overrides: { quantity?: number; unitPrice?: string; costPrice?: string; sku?: string } = {},
) {
  // Goes through the real createProduct service, not a raw insert, so opening stock gets
  // its matching "initial" stock_movements row -- the same §4.2 invariant production relies on.
  return createProduct(userId, {
    name: 'Test Widget',
    sku: overrides.sku ?? `SKU-${randomUUID().slice(0, 8)}`,
    unitPrice: overrides.unitPrice ?? '100.00',
    costPrice: overrides.costPrice ?? '40.00',
    quantity: overrides.quantity ?? 0,
    reorderThreshold: 5,
  });
}

/** Child tables first: sales and stock_movements reference products with RESTRICT. */
export async function deleteTestUser(userId: string) {
  await db.delete(aiToolInvocations).where(eq(aiToolInvocations.userId, userId));
  await db.delete(purchaseOrders).where(eq(purchaseOrders.userId, userId));
  await db.delete(stockMovements).where(eq(stockMovements.userId, userId));
  await db.delete(sales).where(eq(sales.userId, userId));
  await db.delete(products).where(eq(products.userId, userId));
  await db.delete(suppliers).where(eq(suppliers.userId, userId));
  await db.delete(sessions).where(eq(sessions.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}
