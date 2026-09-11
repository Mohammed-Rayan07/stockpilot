import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { aiToolInvocations, products, stockMovements } from '@/lib/db/schema';
import { executeToolCall } from '@/lib/ai/executor';
import { createSession } from '@/lib/auth/session';
import { POST as approveRoute } from '@/app/api/ai/actions/[id]/approve/route';
import { createTestProduct, createTestUser, deleteTestUser } from './helpers';

// Proves the atomic-claim UPDATE in app/api/ai/actions/[id]/approve/route.ts (§7.5) is a
// real IDOR and single-use boundary, not just a status check:
//
//   (a) another tenant approving a proposal they don't own gets NOT_FOUND and changes
//       nothing -- not the product, not the ledger, not even the invocation row itself
//       (the cleanup UPDATE that flips a stale row to 'expired' has no userId predicate
//       of its own; it is safe only because the SELECT that finds `stale` is scoped to
//       the caller, and this test is what would catch that scoping being dropped);
//   (b) a second approval of an already-approved id fails and does not execute twice;
//   (c) an expired proposal cannot be approved, though its own row is allowed to flip to
//       'expired' as a side effect -- what must not move is the product and the ledger.
//
// The route reads the session via next/headers `cookies()`, which only works inside a
// live Next.js request. next/headers is mocked here to a controllable cookie jar backed
// by real session rows from `createSession`, so the route itself runs unmodified against
// a real database -- the same reasoning as testing a locked transaction against real
// Postgres rather than a mock.

const sessionState = vi.hoisted(() => ({ token: null as string | null }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'sid' && sessionState.token ? { name, value: sessionState.token } : undefined,
  }),
}));

let userA: string;
let userB: string;
let tokenA: string;
let tokenB: string;

beforeAll(async () => {
  const [a, b] = await Promise.all([
    createTestUser('ai-approval-a'),
    createTestUser('ai-approval-b'),
  ]);
  userA = a.id;
  userB = b.id;
  [tokenA, tokenB] = await Promise.all([createSession(userA), createSession(userB)]);
});

afterAll(async () => {
  await deleteTestUser(userA);
  await deleteTestUser(userB);
});

function approveRequest(id: string) {
  return new Request(`${process.env.APP_ORIGIN}/api/ai/actions/${id}/approve`, {
    method: 'POST',
    headers: { origin: process.env.APP_ORIGIN! },
  });
}

async function stockState(productId: string) {
  const [product] = await db.select().from(products).where(eq(products.id, productId));
  const movements = await db
    .select()
    .from(stockMovements)
    .where(eq(stockMovements.productId, productId));

  return { quantity: product.quantity, movementCount: movements.length };
}

async function proposeAdjustment(userId: string, productId: string, delta: number) {
  const { proposal } = await executeToolCall(userId, {
    name: 'adjust_stock',
    args: { productId, delta, reason: 'restock' },
  });

  return proposal!.id;
}

test("approving another tenant's proposal returns not-found and mutates nothing", async () => {
  const product = await createTestProduct(userA, { quantity: 10 });
  const proposalId = await proposeAdjustment(userA, product.id, 5);
  const before = await stockState(product.id);

  sessionState.token = tokenB;
  const response = await approveRoute(approveRequest(proposalId), {
    params: Promise.resolve({ id: proposalId }),
  });
  const body = await response.json();

  expect(response.status).toBe(404);
  expect(body.error.code).toBe('NOT_FOUND');

  expect(await stockState(product.id)).toEqual(before);

  // The row itself is untouched too -- B's request must not be able to reach the
  // cleanup UPDATE, which is scoped only via the preceding (correctly-scoped) SELECT.
  const [invocation] = await db
    .select()
    .from(aiToolInvocations)
    .where(eq(aiToolInvocations.id, proposalId));
  expect(invocation.status).toBe('proposed');
});

test('a second approval of the same proposal fails after the first succeeds', async () => {
  const product = await createTestProduct(userA, { quantity: 10 });
  const proposalId = await proposeAdjustment(userA, product.id, 5);

  sessionState.token = tokenA;

  const first = await approveRoute(approveRequest(proposalId), {
    params: Promise.resolve({ id: proposalId }),
  });
  expect(first.status).toBe(200);

  const afterFirst = await stockState(product.id);
  expect(afterFirst.quantity).toBe(15);

  const second = await approveRoute(approveRequest(proposalId), {
    params: Promise.resolve({ id: proposalId }),
  });
  const secondBody = await second.json();

  expect(second.status).toBe(404);
  expect(secondBody.error.code).toBe('NOT_FOUND');

  // Not executed a second time: quantity and ledger count are exactly what the first
  // approval left them at.
  expect(await stockState(product.id)).toEqual(afterFirst);
});

test('an expired proposal cannot be approved and leaves stock untouched', async () => {
  const product = await createTestProduct(userA, { quantity: 10 });
  const proposalId = await proposeAdjustment(userA, product.id, 5);

  await db
    .update(aiToolInvocations)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(aiToolInvocations.id, proposalId));

  const before = await stockState(product.id);

  sessionState.token = tokenA;
  const response = await approveRoute(approveRequest(proposalId), {
    params: Promise.resolve({ id: proposalId }),
  });
  const body = await response.json();

  expect(response.status).toBe(404);
  expect(body.error.code).toBe('NOT_FOUND');

  // What must not move: the product and its ledger. The invocation row is allowed to --
  // and does -- flip to 'expired' as the route's own opportunistic cleanup.
  expect(await stockState(product.id)).toEqual(before);

  const [invocation] = await db
    .select()
    .from(aiToolInvocations)
    .where(eq(aiToolInvocations.id, proposalId));
  expect(invocation.status).toBe('expired');
});
