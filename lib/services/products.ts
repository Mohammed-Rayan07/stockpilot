import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { products, stockMovements, suppliers } from '../db/schema';
import { NotFoundError, ValidationError } from '../errors';

const POSTGRES_UNIQUE_VIOLATION = '23505';

// Every function here takes userId first and puts it in the WHERE clause. That predicate
// IS the tenant boundary: there is no row-level security in the database, so a query that
// forgets it would silently read another tenant's data.

export type ListProductsOptions = {
  page: number;
  limit: number;
  search?: string;
  lowStockOnly?: boolean;
};

export async function listProducts(userId: string, opts: ListProductsOptions) {
  const filters = [eq(products.userId, userId), eq(products.isArchived, false)];

  if (opts.search) {
    const pattern = `%${opts.search}%`;
    const match = or(ilike(products.name, pattern), ilike(products.sku, pattern));
    if (match) {
      filters.push(match);
    }
  }

  if (opts.lowStockOnly) {
    filters.push(sql`${products.quantity} <= ${products.reorderThreshold}`);
  }

  const where = and(...filters);
  const offset = (opts.page - 1) * opts.limit;

  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      description: products.description,
      unitPrice: products.unitPrice,
      costPrice: products.costPrice,
      quantity: products.quantity,
      reorderThreshold: products.reorderThreshold,
      supplierId: products.supplierId,
      supplierName: suppliers.name,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .leftJoin(suppliers, eq(suppliers.id, products.supplierId))
    .where(where)
    .orderBy(asc(products.name))
    .limit(opts.limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .where(where);

  return { products: rows, total: count, page: opts.page, limit: opts.limit };
}

export async function getProduct(userId: string, productId: string) {
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.userId, userId)));

  if (!product) {
    // NOT_FOUND rather than FORBIDDEN when the row belongs to another tenant. Returning
    // 403 would confirm the id exists, which is an existence oracle across tenants.
    throw new NotFoundError('Product not found');
  }

  return product;
}

export type CreateProductInput = {
  name: string;
  sku: string;
  description?: string | null;
  unitPrice: string;
  costPrice: string;
  quantity: number;
  reorderThreshold: number;
  supplierId?: string | null;
};

export async function createProduct(userId: string, input: CreateProductInput) {
  if (input.supplierId) {
    await assertSupplierBelongsToUser(userId, input.supplierId);
  }

  try {
    return await db.transaction(async (tx) => {
      const [product] = await tx
        .insert(products)
        .values({
          userId,
          name: input.name,
          sku: input.sku,
          description: input.description ?? null,
          unitPrice: input.unitPrice,
          costPrice: input.costPrice,
          quantity: input.quantity,
          reorderThreshold: input.reorderThreshold,
          supplierId: input.supplierId ?? null,
        })
        .returning();

      // Opening stock is a write to products.quantity, so it needs a matching ledger row
      // in the same transaction like every other one. Without it the §4.2 reconciliation
      // query would report a mismatch on every newly created product.
      if (input.quantity > 0) {
        await tx.insert(stockMovements).values({
          userId,
          productId: product.id,
          delta: input.quantity,
          balanceAfter: input.quantity,
          reason: 'initial',
          actor: 'user',
          note: 'Opening stock',
        });
      }

      return product;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ValidationError('A product with that SKU already exists.', {
        fields: { sku: 'This SKU is already in use.' },
      });
    }
    throw error;
  }
}

export type UpdateProductInput = {
  name?: string;
  sku?: string;
  description?: string | null;
  unitPrice?: string;
  costPrice?: string;
  reorderThreshold?: number;
  supplierId?: string | null;
};

export async function updateProduct(
  userId: string,
  productId: string,
  input: UpdateProductInput,
) {
  await getProduct(userId, productId);

  if (input.supplierId) {
    await assertSupplierBelongsToUser(userId, input.supplierId);
  }

  // `quantity` is not accepted here by design. Stock changes only through recordSale and
  // adjustStock, which append to the ledger in the same transaction.
  try {
    const [updated] = await db
      .update(products)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(products.id, productId), eq(products.userId, userId)))
      .returning();

    return updated;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ValidationError('A product with that SKU already exists.', {
        fields: { sku: 'This SKU is already in use.' },
      });
    }
    throw error;
  }
}

/**
 * Archives rather than deletes. `sales.product_id` is ON DELETE RESTRICT, so a real
 * delete would either fail or destroy financial history.
 */
export async function archiveProduct(userId: string, productId: string) {
  await getProduct(userId, productId);

  const [archived] = await db
    .update(products)
    .set({ isArchived: true, updatedAt: new Date() })
    .where(and(eq(products.id, productId), eq(products.userId, userId)))
    .returning();

  return archived;
}

async function assertSupplierBelongsToUser(userId: string, supplierId: string) {
  const [supplier] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.userId, userId)));

  if (!supplier) {
    throw new ValidationError('Supplier not found.', {
      fields: { supplierId: 'Unknown supplier.' },
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION
  );
}
