import { Type, type Schema } from '@google/genai';
import { z, type ZodType } from 'zod';
import {
  getDashboardMetrics,
  getInventoryHealth,
  getProductVelocity,
} from '../services/analytics';
import { createPurchaseOrderDraft } from '../services/purchase-orders';
import { getReorderAdvice } from '../services/reorder';
import { adjustStock, recordSale } from '../services/sales';
import { listProducts } from '../services/products';

// §7.3's registry. Every entry's `parameters` is hand-written -- not generated from
// `zodSchema` by a converter -- because Gemini's function-calling schema is an OpenAPI
// subset that rejects `$ref`, and every general-purpose Zod-to-JSON-Schema converter
// emits it for anything beyond the flattest shapes. `zodSchema` exists purely for the
// executor's runtime argument validation (§7.4 step 3); the two schemas describe the
// same shape by hand, not by derivation from one another.
//
// No entry's `parameters` or `zodSchema` contains `userId`, `user_id`, `tenant`, or
// `email` (§7.1 rule 1). The executor injects userId from the verified session and never
// reads it from model-supplied arguments, so there would be nowhere for such a field to
// go even if the model hallucinated one -- but the executor also strips it explicitly
// (§7.4 step 2) rather than relying on that silently.

// Bounds mirror lib/validation/schemas.ts, kept in sync by hand for the same reason the
// two schemas below are: Gemini's function-calling schema and this module's own runtime
// zodSchema are hand-written, not derived from one shared object (see the note above).
// products.unit_price/cost_price are numeric(12,2) -- 10 integer digits, 2 decimal.
const MONEY = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, 'Must be an amount like 199 or 199.50');

// products.quantity and stock_movements.delta are Postgres `integer` (max 2,147,483,647).
const MAX_QUANTITY = 100_000_000;

export type ToolDefinition<TArgs = Record<string, unknown>> = {
  name: string;
  description: string;
  parameters: Schema;
  zodSchema: ZodType<TArgs>;
  mutating: boolean;
  handler: (userId: string, args: TArgs) => Promise<unknown>;
};

// ---------------------------------------------------------------------------
// Read-only tools
// ---------------------------------------------------------------------------

const listProductsTool: ToolDefinition<{
  search?: string;
  lowStockOnly?: boolean;
  limit?: number;
}> = {
  name: 'list_products',
  description:
    "Lists the signed-in user's products, optionally filtered by name/SKU search text or " +
    'restricted to products at or below their reorder threshold.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      search: { type: Type.STRING, description: 'Case-insensitive match against name or SKU.' },
      lowStockOnly: { type: Type.BOOLEAN, description: 'Only products at/below reorder point.' },
      limit: { type: Type.INTEGER, description: 'Max rows to return, 1-50.' },
    },
  },
  zodSchema: z.object({
    search: z.string().trim().max(200).optional(),
    lowStockOnly: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  mutating: false,
  handler: async (userId, args) => {
    const result = await listProducts(userId, {
      page: 1,
      limit: args.limit ?? 20,
      search: args.search,
      lowStockOnly: args.lowStockOnly,
    });

    return result.products.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      quantity: p.quantity,
      price: p.unitPrice,
      reorderThreshold: p.reorderThreshold,
    }));
  },
};

const getInventoryHealthTool: ToolDefinition<Record<string, never>> = {
  name: 'get_inventory_health',
  description:
    'Returns total SKU count, total stock value at cost, and counts of products by ' +
    'health band (out_of_stock, low, healthy).',
  parameters: { type: Type.OBJECT, properties: {} },
  zodSchema: z.object({}),
  mutating: false,
  handler: async (userId) => getInventoryHealth(userId),
};

const getLowStockTool: ToolDefinition<Record<string, never>> = {
  name: 'get_low_stock',
  description: 'Lists products at or below their reorder point, each with days of cover.',
  parameters: { type: Type.OBJECT, properties: {} },
  zodSchema: z.object({}),
  mutating: false,
  handler: async (userId) => {
    const advice = await getReorderAdvice(userId);
    return advice.items.map((item) => ({
      productId: item.productId,
      name: item.name,
      sku: item.sku,
      quantity: item.quantity,
      reorderThreshold: item.reorderThreshold,
      daysOfCover: item.daysOfCover,
    }));
  },
};

const getProductVelocityTool: ToolDefinition<{ productId?: string; days?: number }> = {
  name: 'get_product_velocity',
  description:
    'Units sold per day, units sold in the window, and the trend versus the previous ' +
    'window of the same length. Store-wide if productId is omitted.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      productId: { type: Type.STRING, description: 'UUID of one product, or omit for all.' },
      days: { type: Type.INTEGER, description: 'Window length in days, 1-90. Default 30.' },
    },
  },
  zodSchema: z.object({
    productId: z.uuid().optional(),
    days: z.number().int().min(1).max(90).optional(),
  }),
  mutating: false,
  handler: async (userId, args) =>
    getProductVelocity(userId, { productId: args.productId, days: args.days }),
};

const getSalesSummaryTool: ToolDefinition<{ days?: number }> = {
  name: 'get_sales_summary',
  description: 'Revenue, units sold, gross margin, and top products over a day window.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      days: { type: Type.INTEGER, description: 'Window length in days, 1-365. Default 30.' },
    },
  },
  zodSchema: z.object({ days: z.number().int().min(1).max(365).optional() }),
  mutating: false,
  handler: async (userId, args) => {
    // Backed by the same function the dashboard uses (§6), projected down to only what
    // this tool promises: a full daily series reaching the model is pure token cost, and
    // more surface for injected product-name text (§7.6) to ride along on.
    const metrics = await getDashboardMetrics(userId, { days: args.days });
    return {
      days: metrics.days,
      revenue: metrics.revenue,
      units: metrics.units,
      margin: metrics.margin,
      topProducts: metrics.topProductsByRevenue.map((p) => ({
        name: p.name,
        sku: p.sku,
        units: p.units,
        revenue: p.revenue,
      })),
    };
  },
};

const getReorderAdviceTool: ToolDefinition<{ safetyDays?: number }> = {
  name: 'get_reorder_advice',
  description:
    'Full reorder recommendation for every product at or below its reorder point: ' +
    'daily velocity, days of cover, suggested order quantity, and the stated assumptions ' +
    'behind the numbers.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      safetyDays: { type: Type.INTEGER, description: 'Safety-stock buffer in days. Default 7.' },
    },
  },
  zodSchema: z.object({ safetyDays: z.number().int().min(0).max(90).optional() }),
  mutating: false,
  handler: async (userId, args) => getReorderAdvice(userId, { safetyDays: args.safetyDays }),
};

// ---------------------------------------------------------------------------
// Mutating tools (proposal-only -- see lib/ai/executor.ts §7.4 step 4)
// ---------------------------------------------------------------------------

const recordSaleTool: ToolDefinition<{ productId: string; quantity: number; unitPrice?: string }> =
  {
    name: 'record_sale',
    description: 'Proposes logging a sale, decrementing stock. Requires human approval.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        productId: { type: Type.STRING, description: 'UUID of the product sold.' },
        quantity: { type: Type.INTEGER, description: 'Units sold. Must be positive.' },
        unitPrice: {
          type: Type.STRING,
          description: 'Override sale price, e.g. "199.00". Omit to use the list price.',
        },
      },
      required: ['productId', 'quantity'],
    },
    zodSchema: z.object({
      productId: z.uuid(),
      quantity: z.number().int().positive().max(MAX_QUANTITY),
      unitPrice: MONEY.optional(),
    }),
    mutating: true,
    handler: async (userId, args) =>
      recordSale(
        userId,
        { productId: args.productId, quantity: args.quantity, unitPrice: args.unitPrice },
        'ai_assistant',
      ),
  };

const adjustStockTool: ToolDefinition<{
  productId: string;
  delta: number;
  reason: 'restock' | 'adjustment';
  note?: string;
}> = {
  name: 'adjust_stock',
  description:
    'Proposes a manual stock change (restock or correction), positive or negative. ' +
    'Requires human approval.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      productId: { type: Type.STRING, description: 'UUID of the product.' },
      delta: { type: Type.INTEGER, description: 'Signed change, e.g. 20 or -3. Cannot be 0.' },
      reason: { type: Type.STRING, enum: ['restock', 'adjustment'], format: 'enum' },
      note: { type: Type.STRING, description: 'Optional short note explaining the change.' },
    },
    required: ['productId', 'delta', 'reason'],
  },
  zodSchema: z.object({
    productId: z.uuid(),
    delta: z
      .number()
      .int()
      .min(-MAX_QUANTITY)
      .max(MAX_QUANTITY)
      .refine((v) => v !== 0, 'Adjustment cannot be zero.'),
    reason: z.enum(['restock', 'adjustment']),
    note: z.string().trim().max(500).optional(),
  }),
  mutating: true,
  handler: async (userId, args) =>
    adjustStock(userId, args.productId, args.delta, args.reason, 'ai_assistant', args.note ?? null),
};

const createPurchaseOrderDraftTool: ToolDefinition<{
  supplierId: string;
  lines: { productId: string; quantity: number }[];
}> = {
  name: 'create_purchase_order_draft',
  description:
    'Proposes a draft purchase order for one supplier: a snapshot of product, quantity ' +
    'and current cost for each line. Requires human approval.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      supplierId: { type: Type.STRING, description: 'UUID of the supplier.' },
      lines: {
        type: Type.ARRAY,
        description: 'At least one line to order.',
        items: {
          type: Type.OBJECT,
          properties: {
            productId: { type: Type.STRING },
            quantity: { type: Type.INTEGER },
          },
          required: ['productId', 'quantity'],
        },
      },
    },
    required: ['supplierId', 'lines'],
  },
  zodSchema: z.object({
    supplierId: z.uuid(),
    lines: z
      .array(z.object({ productId: z.uuid(), quantity: z.number().int().positive().max(MAX_QUANTITY) }))
      .min(1),
  }),
  mutating: true,
  handler: async (userId, args) =>
    createPurchaseOrderDraft(userId, { supplierId: args.supplierId, lines: args.lines }),
};

// A registry of tools with different argument shapes has nowhere else to put the type:
// each tool above is fully typed at its own definition, and the executor treats args as
// unknown until zodSchema validates them anyway.
/* eslint-disable @typescript-eslint/no-explicit-any */
export const TOOLS: ToolDefinition<any>[] = [
  listProductsTool,
  getInventoryHealthTool,
  getLowStockTool,
  getProductVelocityTool,
  getSalesSummaryTool,
  getReorderAdviceTool,
  recordSaleTool,
  adjustStockTool,
  createPurchaseOrderDraftTool,
];

export function findTool(name: string): ToolDefinition<any> | undefined {
  return TOOLS.find((tool) => tool.name === name);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
