import { afterAll, beforeAll, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { products } from '@/lib/db/schema';
import { NotFoundError } from '@/lib/errors';
import { archiveProduct, getProduct, listProducts, updateProduct } from '@/lib/services/products';
import { recordSale } from '@/lib/services/sales';
import { createTestProduct, createTestUser, deleteTestUser } from './helpers';

// Proves one claim: user A cannot reach user B's rows through the service layer, even
// holding B's exact product id.
//
// Every failure is NOT_FOUND rather than FORBIDDEN. A 403 would confirm the id exists,
// which turns any endpoint into an existence oracle across tenants.

let userA: string;
let userB: string;
let productOfB: string;

beforeAll(async () => {
  const [a, b] = await Promise.all([createTestUser('tenant-a'), createTestUser('tenant-b')]);
  userA = a.id;
  userB = b.id;

  const product = await createTestProduct(userB, { quantity: 20, unitPrice: '999.00' });
  productOfB = product.id;
});

afterAll(async () => {
  await deleteTestUser(userA);
  await deleteTestUser(userB);
});

test("reading another tenant's product by id fails as not-found", async () => {
  await expect(getProduct(userA, productOfB)).rejects.toBeInstanceOf(NotFoundError);
});

test("updating another tenant's product by id fails and changes nothing", async () => {
  await expect(
    updateProduct(userA, productOfB, { name: 'Hijacked', unitPrice: '1.00' }),
  ).rejects.toBeInstanceOf(NotFoundError);

  const [unchanged] = await db.select().from(products).where(eq(products.id, productOfB));
  expect(unchanged.name).toBe('Test Widget');
  expect(unchanged.unitPrice).toBe('999.00');
});

test("archiving another tenant's product fails and leaves it active", async () => {
  await expect(archiveProduct(userA, productOfB)).rejects.toBeInstanceOf(NotFoundError);

  const [unchanged] = await db.select().from(products).where(eq(products.id, productOfB));
  expect(unchanged.isArchived).toBe(false);
});

test("selling another tenant's product fails and does not move their stock", async () => {
  await expect(
    recordSale(userA, { productId: productOfB, quantity: 1 }),
  ).rejects.toBeInstanceOf(NotFoundError);

  const [unchanged] = await db.select().from(products).where(eq(products.id, productOfB));
  expect(unchanged.quantity).toBe(20);
});

test("listing products never returns another tenant's rows", async () => {
  const result = await listProducts(userA, { page: 1, limit: 100 });

  expect(result.products.some((p) => p.id === productOfB)).toBe(false);
  expect(result.total).toBe(0);
});
