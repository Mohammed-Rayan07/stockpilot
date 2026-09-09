import { z } from 'zod';

// One schema per input, defined once and reused by the REST handlers and (from Phase 5)
// the AI executor. Two copies of a validation rule is how the two call paths drift apart
// and how an authorization hole opens up.

const MONEY = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Must be an amount like 199 or 199.50');

export const registerSchema = z.object({
  email: z.email('Enter a valid email address.'),
  // 10 characters, not 8: length is the only property that reliably resists offline
  // guessing, and composition rules mostly push users toward predictable substitutions.
  password: z.string().min(10, 'Password must be at least 10 characters.').max(200),
  name: z.string().trim().min(1, 'Name is required.').max(120),
});

export const loginSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.').max(200),
});

export const createProductSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(200),
  sku: z.string().trim().min(1, 'SKU is required.').max(64),
  description: z.string().trim().max(2000).optional().nullable(),
  unitPrice: MONEY,
  costPrice: MONEY,
  quantity: z.number().int().min(0).default(0),
  reorderThreshold: z.number().int().min(0).default(0),
  supplierId: z.uuid().optional().nullable(),
});

export const updateProductSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  sku: z.string().trim().min(1).max(64).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  unitPrice: MONEY.optional(),
  costPrice: MONEY.optional(),
  reorderThreshold: z.number().int().min(0).optional(),
  supplierId: z.uuid().optional().nullable(),
});

// `quantity` is deliberately absent from updateProductSchema. Stock is changed only by
// recordSale and adjustStock, both of which write the ledger in the same transaction.
// Letting a generic product edit set the quantity would break the §4.2 invariant.

export const createSupplierSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(200),
  email: z.email().optional().nullable().or(z.literal('')),
  leadTimeDays: z.number().int().min(0).max(365).default(7),
});

export const recordSaleSchema = z.object({
  productId: z.uuid(),
  quantity: z.number().int().positive('Quantity must be at least 1.'),
  unitPrice: MONEY.optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

export const adjustStockSchema = z.object({
  productId: z.uuid(),
  delta: z.number().int().refine((v) => v !== 0, 'Adjustment cannot be zero.'),
  reason: z.enum(['restock', 'adjustment']),
  note: z.string().trim().max(500).optional().nullable(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const listProductsQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  lowStock: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const listSalesQuerySchema = paginationSchema.extend({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
