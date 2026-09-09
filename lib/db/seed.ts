import { config } from 'dotenv';

config({ path: '.env' });

import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from './index';
import {
  aiToolInvocations,
  products,
  purchaseOrders,
  sales,
  sessions,
  stockMovements,
  suppliers,
  users,
} from './schema';
import { toMajor, toMinor } from '../money';

const DEMO_EMAIL = 'demo@stockpilot.app';
const DEMO_PASSWORD = 'demo-password-123';
const DEMO_NAME = 'Demo Merchant';

const LOOKBACK_DAYS = 45;

// A seeded generator, not Math.random: re-running the seed must produce byte-identical
// data, otherwise the hand-computed analytics figures in the README stop matching.
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    // Numerical Recipes LCG constants, kept in 32-bit range.
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

type ProductPlan = {
  name: string;
  sku: string;
  description: string;
  unitPrice: string;
  costPrice: string;
  reorderThreshold: number;
  finalQuantity: number;
  supplierIndex: 0 | 1;
  saleCount: number;
  maxUnitsPerSale: number;
};

// Deliberately varied velocity so the analytics have something real to show:
// one fast mover below its threshold, one dead stock item, one sitting exactly
// at its reorder point.
const PRODUCT_PLANS: ProductPlan[] = [
  {
    name: 'USB-C Cable 1m',
    sku: 'CBL-USBC-1M',
    description: 'Braided 60W USB-C to USB-C charging cable.',
    unitPrice: '499.00',
    costPrice: '210.00',
    reorderThreshold: 40,
    finalQuantity: 18,
    supplierIndex: 0,
    saleCount: 30,
    maxUnitsPerSale: 4,
  },
  {
    name: 'Wireless Mouse 2.4GHz',
    sku: 'MSE-WL-200',
    description: 'Silent-click wireless mouse with USB receiver.',
    unitPrice: '899.00',
    costPrice: '430.00',
    reorderThreshold: 15,
    finalQuantity: 15,
    supplierIndex: 0,
    saleCount: 12,
    maxUnitsPerSale: 3,
  },
  {
    name: 'Aluminium Laptop Stand',
    sku: 'STD-ALU-01',
    description: 'Adjustable six-level aluminium laptop riser.',
    unitPrice: '1799.00',
    costPrice: '940.00',
    reorderThreshold: 10,
    finalQuantity: 46,
    supplierIndex: 1,
    saleCount: 9,
    maxUnitsPerSale: 2,
  },
  {
    name: 'HDMI Cable 2m',
    sku: 'CBL-HDMI-2M',
    description: '4K 60Hz high-speed HDMI cable.',
    unitPrice: '649.00',
    costPrice: '295.00',
    reorderThreshold: 12,
    finalQuantity: 60,
    supplierIndex: 1,
    saleCount: 6,
    maxUnitsPerSale: 2,
  },
  {
    name: 'Mechanical Keyboard 87-key',
    sku: 'KBD-MECH-87',
    description: 'Tenkeyless mechanical keyboard, brown switches.',
    unitPrice: '4299.00',
    costPrice: '2350.00',
    reorderThreshold: 8,
    finalQuantity: 22,
    supplierIndex: 0,
    saleCount: 5,
    maxUnitsPerSale: 1,
  },
  {
    name: 'Fax Machine Ribbon',
    sku: 'FAX-RBN-01',
    description: 'Thermal transfer ribbon. Legacy stock, no recent demand.',
    unitPrice: '349.00',
    costPrice: '180.00',
    reorderThreshold: 5,
    finalQuantity: 25,
    supplierIndex: 1,
    saleCount: 0,
    maxUnitsPerSale: 1,
  },
];

const SUPPLIER_PLANS = [
  { name: 'Nandi Traders', email: 'orders@nanditraders.example', leadTimeDays: 5 },
  { name: 'Coastal Supply Co', email: 'purchasing@coastalsupply.example', leadTimeDays: 12 },
];

/**
 * Removes every row belonging to the demo user, child tables first.
 *
 * Deleting the user row and relying on ON DELETE CASCADE is not safe here: sales and
 * stock_movements reference products with ON DELETE RESTRICT, and Postgres does not
 * guarantee the order in which cascaded deletes fire. Explicit ordering is the only
 * version that is certain to succeed.
 */
async function deleteDemoData(userId: string): Promise<void> {
  await db.delete(aiToolInvocations).where(eq(aiToolInvocations.userId, userId));
  await db.delete(purchaseOrders).where(eq(purchaseOrders.userId, userId));
  await db.delete(stockMovements).where(eq(stockMovements.userId, userId));
  await db.delete(sales).where(eq(sales.userId, userId));
  await db.delete(products).where(eq(products.userId, userId));
  await db.delete(suppliers).where(eq(suppliers.userId, userId));
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

async function seed(): Promise<void> {
  const random = createRandom(20250913);
  const now = Date.now();

  const [existingUser] = await db.select().from(users).where(eq(users.email, DEMO_EMAIL));

  let userId: string;

  if (existingUser) {
    // Re-running the seed rebuilds the demo dataset from scratch rather than
    // appending to it, so the result is identical on every run.
    await deleteDemoData(existingUser.id);
    userId = existingUser.id;
  } else {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
    const [createdUser] = await db
      .insert(users)
      .values({ email: DEMO_EMAIL, passwordHash, name: DEMO_NAME })
      .returning();
    userId = createdUser.id;
  }

  const supplierIds: string[] = [];
  for (const plan of SUPPLIER_PLANS) {
    const [supplier] = await db
      .insert(suppliers)
      .values({
        userId,
        name: plan.name,
        email: plan.email,
        leadTimeDays: plan.leadTimeDays,
      })
      .returning();
    supplierIds.push(supplier.id);
  }

  let totalSales = 0;

  for (const plan of PRODUCT_PLANS) {
    // Each sale's day offset and unit count are drawn first so the opening stock can
    // be derived as (final quantity + everything sold). That keeps products.quantity
    // and the stock_movements ledger in agreement, which is what the §4.2
    // reconciliation query checks.
    const saleUnits: number[] = [];
    const saleDayOffsets: number[] = [];

    for (let i = 0; i < plan.saleCount; i += 1) {
      saleUnits.push(1 + Math.floor(random() * plan.maxUnitsPerSale));
      saleDayOffsets.push(Math.floor(random() * LOOKBACK_DAYS));
    }

    const unitsSold = saleUnits.reduce((sum, units) => sum + units, 0);
    const openingQuantity = plan.finalQuantity + unitsSold;

    const [product] = await db
      .insert(products)
      .values({
        userId,
        supplierId: supplierIds[plan.supplierIndex],
        name: plan.name,
        sku: plan.sku,
        description: plan.description,
        unitPrice: plan.unitPrice,
        costPrice: plan.costPrice,
        quantity: plan.finalQuantity,
        reorderThreshold: plan.reorderThreshold,
      })
      .returning();

    const openingDate = new Date(now - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    await db.insert(stockMovements).values({
      userId,
      productId: product.id,
      delta: openingQuantity,
      balanceAfter: openingQuantity,
      reason: 'initial',
      actor: 'user',
      note: 'Opening stock',
      createdAt: openingDate,
    });

    // Oldest sale first, so the running balance in the ledger reads correctly.
    const orderedSales = saleUnits
      .map((units, i) => ({ units, dayOffset: saleDayOffsets[i] }))
      .sort((a, b) => b.dayOffset - a.dayOffset);

    let balance = openingQuantity;

    for (const entry of orderedSales) {
      const soldAt = new Date(now - entry.dayOffset * 24 * 60 * 60 * 1000);
      const unitPriceMinor = toMinor(plan.unitPrice);

      const [sale] = await db
        .insert(sales)
        .values({
          userId,
          productId: product.id,
          quantity: entry.units,
          unitPrice: plan.unitPrice,
          unitCost: plan.costPrice,
          totalAmount: toMajor(unitPriceMinor * entry.units),
          soldAt,
          createdAt: soldAt,
        })
        .returning();

      balance -= entry.units;

      await db.insert(stockMovements).values({
        userId,
        productId: product.id,
        delta: -entry.units,
        balanceAfter: balance,
        reason: 'sale',
        referenceId: sale.id,
        actor: 'user',
        createdAt: soldAt,
      });

      totalSales += 1;
    }
  }

  console.log(`Seeded user ${DEMO_EMAIL}`);
  console.log(`  suppliers: ${SUPPLIER_PLANS.length}`);
  console.log(`  products:  ${PRODUCT_PLANS.length}`);
  console.log(`  sales:     ${totalSales} over the last ${LOOKBACK_DAYS} days`);
  console.log(`  password:  ${DEMO_PASSWORD}`);
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  });
