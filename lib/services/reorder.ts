import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import { products, sales, suppliers } from '../db/schema';

// §6.3's formulas verbatim. Kept as a pure function, separate from the DB query below,
// so reorder-math.test.ts can assert against hand-computed numbers without needing a
// live sales fixture for every edge case.

const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_SAFETY_DAYS = 7;
const REVIEW_PERIOD_DAYS = 7;
const DEFAULT_LEAD_TIME_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// The reorder methodology is a transparent heuristic, not a service-level-optimal model.
// A service-level-optimal answer would require a demand distribution and a newsvendor or
// (Q, r) model with a stated target fill rate; that was deliberately not implemented.
export const REORDER_ASSUMPTIONS = [
  'Demand is assumed constant over the lookback window. No trend or seasonality is modelled.',
  'Lead time is treated as deterministic; no variability is modelled.',
  'Periods when a product was out of stock count as zero demand, which understates true demand (stock-out censoring).',
  'Safety stock is a simple day-count buffer, not derived from a demand distribution or a target service level.',
] as const;

export type ReorderCalcInput = {
  quantity: number;
  unitsInWindow: number;
  lookbackDays: number;
  firstSaleAt: Date | null;
  now: Date;
  leadTimeDays: number;
  safetyDays: number;
};

export type ReorderCalcResult = {
  dailyVelocity: number;
  observedDays: number;
  daysOfCover: number | null;
  leadTimeDays: number;
  safetyDays: number;
  reviewPeriodDays: number;
  reorderPoint: number;
  suggestedQty: number;
};

export function calculateReorderAdvice(input: ReorderCalcInput): ReorderCalcResult {
  const daysSinceFirstSale = input.firstSaleAt
    ? Math.floor((input.now.getTime() - input.firstSaleAt.getTime()) / DAY_MS)
    : input.lookbackDays;
  const observedDays = Math.min(input.lookbackDays, daysSinceFirstSale);
  const dailyVelocity = input.unitsInWindow / Math.max(observedDays, 1);
  // null, not zero: zero would claim "infinite cover", not "no recent sales to judge by".
  const daysOfCover = dailyVelocity > 0 ? input.quantity / dailyVelocity : null;
  const reorderPoint = dailyVelocity * (input.leadTimeDays + input.safetyDays);
  const suggestedQty = Math.max(
    0,
    Math.ceil(
      dailyVelocity * (input.leadTimeDays + REVIEW_PERIOD_DAYS + input.safetyDays) -
        input.quantity,
    ),
  );

  return {
    dailyVelocity,
    observedDays,
    daysOfCover,
    leadTimeDays: input.leadTimeDays,
    safetyDays: input.safetyDays,
    reviewPeriodDays: REVIEW_PERIOD_DAYS,
    reorderPoint,
    suggestedQty,
  };
}

export type ReorderAdviceItem = ReorderCalcResult & {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  reorderThreshold: number;
  supplierId: string | null;
  supplierName: string | null;
};

export type ReorderAdvice = {
  lookbackDays: number;
  safetyDays: number;
  assumptions: readonly string[];
  items: ReorderAdviceItem[];
};

/**
 * Every product at or below its reorder point, each carrying the inputs that produced its
 * suggestion (§6.3) so the UI and the AI can both show the working rather than a bare number.
 */
export async function getReorderAdvice(
  userId: string,
  opts: { safetyDays?: number; lookbackDays?: number } = {},
): Promise<ReorderAdvice> {
  const lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const safetyDays = opts.safetyDays ?? DEFAULT_SAFETY_DAYS;
  const now = new Date();
  const since = new Date(now.getTime() - lookbackDays * DAY_MS);

  const candidates = await db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      quantity: products.quantity,
      reorderThreshold: products.reorderThreshold,
      supplierId: products.supplierId,
      supplierName: suppliers.name,
      leadTimeDays: suppliers.leadTimeDays,
    })
    .from(products)
    .leftJoin(suppliers, eq(suppliers.id, products.supplierId))
    .where(
      and(
        eq(products.userId, userId),
        eq(products.isArchived, false),
        lte(products.quantity, products.reorderThreshold),
      ),
    );

  if (candidates.length === 0) {
    return { lookbackDays, safetyDays, assumptions: REORDER_ASSUMPTIONS, items: [] };
  }

  const productIds = candidates.map((c) => c.id);

  const salesAgg = await db
    .select({
      productId: sales.productId,
      firstSaleAt: sql<string>`MIN(${sales.soldAt})`,
      unitsInWindow: sql<number>`COALESCE(SUM(CASE WHEN ${sales.soldAt} >= ${since} THEN ${sales.quantity} ELSE 0 END), 0)::int`,
    })
    .from(sales)
    .where(and(eq(sales.userId, userId), inArray(sales.productId, productIds)))
    .groupBy(sales.productId);

  const salesByProduct = new Map(salesAgg.map((row) => [row.productId, row]));

  const items: ReorderAdviceItem[] = candidates.map((product) => {
    const agg = salesByProduct.get(product.id);
    const calc = calculateReorderAdvice({
      quantity: product.quantity,
      unitsInWindow: agg?.unitsInWindow ?? 0,
      lookbackDays,
      firstSaleAt: agg?.firstSaleAt ? new Date(agg.firstSaleAt) : null,
      now,
      leadTimeDays: product.leadTimeDays ?? DEFAULT_LEAD_TIME_DAYS,
      safetyDays,
    });

    return {
      ...calc,
      productId: product.id,
      name: product.name,
      sku: product.sku,
      quantity: product.quantity,
      reorderThreshold: product.reorderThreshold,
      supplierId: product.supplierId,
      supplierName: product.supplierName,
    };
  });

  return { lookbackDays, safetyDays, assumptions: REORDER_ASSUMPTIONS, items };
}
