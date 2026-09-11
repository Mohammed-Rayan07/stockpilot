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

// `quantity` is deliberately absent from updateProductSchema. The §4.2 invariant is that
// no change to products.quantity happens without a matching stock_movements row in the
// same transaction -- recordSale, adjustStock and createProduct (at insert time, for
// opening stock) are the only three writers, and all three hold that invariant. A generic
// product edit is none of those three, so it is not allowed to touch quantity at all.

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

export const dashboardQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
});

export const reorderAdviceQuerySchema = z.object({
  safetyDays: z.coerce.number().int().min(0).max(90).optional(),
});

export const createPurchaseOrderSchema = z.object({
  supplierId: z.uuid(),
  lines: z
    .array(z.object({ productId: z.uuid(), quantity: z.number().int().positive() }))
    .min(1, 'A purchase order needs at least one line.'),
});

export const updatePurchaseOrderSchema = z.object({
  status: z.enum(['sent', 'cancelled']).optional(),
  emailDraft: z.string().trim().max(5000).optional(),
});

// The `history` array is an opaque round-trip value: the client only ever resends what
// POST /api/ai/chat previously returned, so this checks shape (a Gemini Content[]), not
// exact contents. Being opaque to us does not make it free: every entry is replayed to
// Gemini as input tokens on every subsequent turn, so an unbounded array is unbounded
// spend per turn even though `message` itself is capped. The entry count and the
// stringified-size cap below bound that cost regardless of how the client got the array
// that large.
const HISTORY_MAX_ENTRIES = 20;
const HISTORY_MAX_CHARS = 20_000;

export const aiChatSchema = z.object({
  message: z.string().trim().min(1, 'Message is required.').max(2000, 'Message is too long.'),
  history: z
    .array(
      z.object({
        role: z.string().optional(),
        parts: z.array(z.record(z.string(), z.unknown())).optional(),
      }),
    )
    .max(HISTORY_MAX_ENTRIES, `History cannot exceed ${HISTORY_MAX_ENTRIES} entries.`)
    .optional()
    .refine(
      (history) => !history || JSON.stringify(history).length <= HISTORY_MAX_CHARS,
      `History is too large (max ${HISTORY_MAX_CHARS} characters).`,
    ),
});
