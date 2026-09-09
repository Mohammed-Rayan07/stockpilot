import { asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { suppliers } from '../db/schema';

export async function listSuppliers(userId: string) {
  return db
    .select()
    .from(suppliers)
    .where(eq(suppliers.userId, userId))
    .orderBy(asc(suppliers.name));
}

export type CreateSupplierInput = {
  name: string;
  email?: string | null;
  leadTimeDays: number;
};

export async function createSupplier(userId: string, input: CreateSupplierInput) {
  const [supplier] = await db
    .insert(suppliers)
    .values({
      userId,
      name: input.name,
      // An empty string from an untouched form field is stored as NULL, so "no email"
      // has one representation rather than two.
      email: input.email ? input.email : null,
      leadTimeDays: input.leadTimeDays,
    })
    .returning();

  return supplier;
}
