import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Stored lowercased and trimmed by the registration service so the UNIQUE
  // constraint is a true "one account per address" rule, not a case-sensitive one.
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Only the sha256 of the raw cookie token is stored: a database leak yields
    // hashes, not usable sessions.
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email'),
    leadTimeDays: integer('lead_time_days').notNull().default(7),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('suppliers_user_id_idx').on(t.userId),
    check('suppliers_lead_time_days_check', sql`${t.leadTimeDays} >= 0`),
  ],
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    sku: text('sku').notNull(),
    description: text('description'),
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
    costPrice: numeric('cost_price', { precision: 12, scale: 2 }).notNull(),
    quantity: integer('quantity').notNull().default(0),
    reorderThreshold: integer('reorder_threshold').notNull().default(0),
    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Scoped to the tenant, not global: a global unique SKU would let one tenant's
    // SKU block another's, leaking the existence of other tenants' data.
    uniqueIndex('products_user_sku_uniq').on(t.userId, t.sku),
    index('products_user_archived_idx').on(t.userId, t.isArchived),
    check('products_unit_price_check', sql`${t.unitPrice} >= 0`),
    check('products_cost_price_check', sql`${t.costPrice} >= 0`),
    // Defence in depth behind the row lock in recordSale: overselling is impossible
    // at the storage layer even if application logic is wrong.
    check('products_quantity_check', sql`${t.quantity} >= 0`),
    check('products_reorder_threshold_check', sql`${t.reorderThreshold} >= 0`),
  ],
);

export const sales = pgTable(
  'sales',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // RESTRICT, not CASCADE: deleting a product with sales history would silently
    // destroy financial records. Products are archived, never deleted.
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    // Price and cost are snapshotted because a sale is a historical fact: last
    // month's revenue must not move when today's price changes.
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
    unitCost: numeric('unit_cost', { precision: 12, scale: 2 }).notNull(),
    totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull(),
    idempotencyKey: text('idempotency_key'),
    soldAt: timestamp('sold_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sales_user_soldat_idx').on(t.userId, t.soldAt.desc()),
    index('sales_product_soldat_idx').on(t.productId, t.soldAt.desc()),
    // Partial index: many sales legitimately have no idempotency key, and NULLs
    // must not collide with each other.
    uniqueIndex('sales_idem_uniq')
      .on(t.userId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    check('sales_quantity_check', sql`${t.quantity} > 0`),
  ],
);

export type StockMovementReason = 'sale' | 'restock' | 'adjustment' | 'initial';
export type StockMovementActor = 'user' | 'ai_assistant';

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    delta: integer('delta').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    reason: text('reason').$type<StockMovementReason>().notNull(),
    referenceId: uuid('reference_id'),
    actor: text('actor').$type<StockMovementActor>().notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('stock_movements_user_product_created_idx').on(
      t.userId,
      t.productId,
      t.createdAt.desc(),
    ),
  ],
);

export type PurchaseOrderStatus = 'draft' | 'sent' | 'cancelled';

export type PurchaseOrderLine = {
  product_id: string;
  name: string;
  sku: string;
  quantity: number;
  unit_cost: string;
};

export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    status: text('status').$type<PurchaseOrderStatus>().notNull().default('draft'),
    // JSONB rather than a child table: a PO line is a point-in-time snapshot that is
    // never queried relationally and must not change when the product changes.
    lines: jsonb('lines').$type<PurchaseOrderLine[]>().notNull(),
    totalCost: numeric('total_cost', { precision: 12, scale: 2 }).notNull(),
    emailDraft: text('email_draft'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('purchase_orders_user_created_idx').on(t.userId, t.createdAt.desc())],
);

export type AiToolInvocationStatus =
  | 'executed'
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'error';

export const aiToolInvocations = pgTable(
  'ai_tool_invocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    toolName: text('tool_name').notNull(),
    arguments: jsonb('arguments').notNull(),
    status: text('status').$type<AiToolInvocationStatus>().notNull(),
    resultSummary: text('result_summary'),
    errorMessage: text('error_message'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_tool_invocations_user_created_idx').on(t.userId, t.createdAt.desc())],
);
