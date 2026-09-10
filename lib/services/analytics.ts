import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '../db';
import { products, sales } from '../db/schema';

// All money aggregates below are summed in Postgres `numeric` via SQL, never pulled into
// JS and added as floats. `SUM(total_amount) - SUM(quantity * unit_cost)` stays `numeric`
// through the whole expression and the driver hands back a string, same as every other
// money value in this codebase (§2.2).

const DEFAULT_DASHBOARD_DAYS = 30;
const TOP_PRODUCTS_LIMIT = 5;
const IST_TIME_ZONE = 'Asia/Kolkata';

/** 'YYYY-MM-DD' in IST. en-CA formats as ISO by convention; the IANA zone does the offset. */
function istDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST_TIME_ZONE }).format(date);
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export type StockHealthBand = 'out_of_stock' | 'low' | 'healthy';

export type InventoryHealth = {
  totalSkus: number;
  stockValueAtCost: string;
  bands: Record<StockHealthBand, number>;
};

/**
 * Bands a product by quantity against its own reorder threshold, not a fixed number:
 * "low" is relative to what this specific product needs on hand.
 */
function healthBand(quantity: number, reorderThreshold: number): StockHealthBand {
  if (quantity <= 0) return 'out_of_stock';
  if (quantity <= reorderThreshold) return 'low';
  return 'healthy';
}

export async function getInventoryHealth(userId: string): Promise<InventoryHealth> {
  const rows = await db
    .select({ quantity: products.quantity, reorderThreshold: products.reorderThreshold })
    .from(products)
    .where(and(eq(products.userId, userId), eq(products.isArchived, false)));

  const [{ stockValueAtCost }] = await db
    .select({
      stockValueAtCost: sql<string>`COALESCE(SUM(${products.quantity} * ${products.costPrice}), 0)::numeric(14,2)`,
    })
    .from(products)
    .where(and(eq(products.userId, userId), eq(products.isArchived, false)));

  const bands: Record<StockHealthBand, number> = { out_of_stock: 0, low: 0, healthy: 0 };
  for (const row of rows) {
    bands[healthBand(row.quantity, row.reorderThreshold)] += 1;
  }

  return { totalSkus: rows.length, stockValueAtCost, bands };
}

export type TopProduct = {
  productId: string;
  name: string;
  sku: string;
  units: number;
  revenue: string;
};

export type DashboardMetrics = {
  days: number;
  revenue: string;
  units: number;
  margin: string;
  revenueOverTime: { date: string; revenue: string }[];
  topProductsByUnits: TopProduct[];
  topProductsByRevenue: TopProduct[];
  inventoryHealth: InventoryHealth;
};

export async function getDashboardMetrics(
  userId: string,
  opts: { days?: number } = {},
): Promise<DashboardMetrics> {
  const days = opts.days ?? DEFAULT_DASHBOARD_DAYS;
  const since = daysAgo(days);
  const windowFilter = and(eq(sales.userId, userId), gte(sales.soldAt, since));

  const [totals] = await db
    .select({
      revenue: sql<string>`COALESCE(SUM(${sales.totalAmount}), 0)::numeric(14,2)`,
      units: sql<number>`COALESCE(SUM(${sales.quantity}), 0)::int`,
      margin: sql<string>`COALESCE(SUM(${sales.totalAmount}) - SUM(${sales.quantity} * ${sales.unitCost}), 0)::numeric(14,2)`,
    })
    .from(sales)
    .where(windowFilter);

  const dailyRows = await db
    .select({
      day: sql<string>`(date_trunc('day', ${sales.soldAt} AT TIME ZONE 'Asia/Kolkata'))::date`,
      revenue: sql<string>`SUM(${sales.totalAmount})::numeric(14,2)`,
    })
    .from(sales)
    .where(windowFilter)
    .groupBy(sql`1`);

  // Every day in the window gets a point, zero-revenue or not, so the line chart has no
  // gaps -- and the bucket boundary matches the driver's IST day, not a UTC one.
  const revenueByDay = new Map(dailyRows.map((row) => [row.day, row.revenue]));
  const revenueOverTime: { date: string; revenue: string }[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = istDateKey(daysAgo(i));
    revenueOverTime.push({ date: key, revenue: revenueByDay.get(key) ?? '0.00' });
  }

  const byUnits = await db
    .select({
      productId: products.id,
      name: products.name,
      sku: products.sku,
      units: sql<number>`SUM(${sales.quantity})::int`,
      revenue: sql<string>`SUM(${sales.totalAmount})::numeric(14,2)`,
    })
    .from(sales)
    .innerJoin(products, eq(products.id, sales.productId))
    .where(windowFilter)
    .groupBy(products.id, products.name, products.sku)
    .orderBy(desc(sql`SUM(${sales.quantity})`))
    .limit(TOP_PRODUCTS_LIMIT);

  const byRevenue = await db
    .select({
      productId: products.id,
      name: products.name,
      sku: products.sku,
      units: sql<number>`SUM(${sales.quantity})::int`,
      revenue: sql<string>`SUM(${sales.totalAmount})::numeric(14,2)`,
    })
    .from(sales)
    .innerJoin(products, eq(products.id, sales.productId))
    .where(windowFilter)
    .groupBy(products.id, products.name, products.sku)
    .orderBy(desc(sql`SUM(${sales.totalAmount})`))
    .limit(TOP_PRODUCTS_LIMIT);

  const inventoryHealth = await getInventoryHealth(userId);

  return {
    days,
    revenue: totals.revenue,
    units: totals.units,
    margin: totals.margin,
    revenueOverTime,
    topProductsByUnits: byUnits,
    topProductsByRevenue: byRevenue,
    inventoryHealth,
  };
}

export type ProductVelocity = {
  productId: string | null;
  name: string | null;
  sku: string | null;
  days: number;
  currentUnits: number;
  unitsPerDay: number;
  previousUnits: number;
  trendPct: number | null;
};

/**
 * Store-wide when productId is omitted, one product's figures when it is given. Both call
 * paths -- the fast/slow-movers view and the get_product_velocity AI tool -- share this.
 */
export async function getProductVelocity(
  userId: string,
  opts: { productId?: string; days?: number } = {},
): Promise<ProductVelocity> {
  const days = opts.days ?? DEFAULT_DASHBOARD_DAYS;
  const currentSince = daysAgo(days);
  const previousSince = daysAgo(days * 2);

  const productFilter = opts.productId ? eq(sales.productId, opts.productId) : undefined;

  const [current] = await db
    .select({ units: sql<number>`COALESCE(SUM(${sales.quantity}), 0)::int` })
    .from(sales)
    .where(and(eq(sales.userId, userId), gte(sales.soldAt, currentSince), productFilter));

  const [previous] = await db
    .select({ units: sql<number>`COALESCE(SUM(${sales.quantity}), 0)::int` })
    .from(sales)
    .where(
      and(
        eq(sales.userId, userId),
        gte(sales.soldAt, previousSince),
        lt(sales.soldAt, currentSince),
        productFilter,
      ),
    );

  let name: string | null = null;
  let sku: string | null = null;

  if (opts.productId) {
    const [product] = await db
      .select({ name: products.name, sku: products.sku })
      .from(products)
      .where(and(eq(products.id, opts.productId), eq(products.userId, userId)));
    name = product?.name ?? null;
    sku = product?.sku ?? null;
  }

  const trendPct =
    previous.units === 0
      ? current.units === 0
        ? 0
        : null // no previous-window baseline to compare against
      : Math.round(((current.units - previous.units) / previous.units) * 1000) / 10;

  return {
    productId: opts.productId ?? null,
    name,
    sku,
    days,
    currentUnits: current.units,
    unitsPerDay: Math.round((current.units / days) * 100) / 100,
    previousUnits: previous.units,
    trendPct,
  };
}
