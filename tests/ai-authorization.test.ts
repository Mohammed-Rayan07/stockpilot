import { afterAll, beforeAll, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { executeToolCall, stripIdentityFields } from '@/lib/ai/executor';
import { db } from '@/lib/db';
import { aiToolInvocations } from '@/lib/db/schema';
import { createTestProduct, createTestUser, deleteTestUser } from './helpers';

// Proves one claim: calling the executor with an injected userId belonging to another
// tenant does not let that value influence anything. The field is stripped before
// validation, and every query the resulting tool call makes resolves against the
// session's own userId -- never one supplied by the model.

test('stripIdentityFields removes every identity field, keeps everything else', () => {
  const cleaned = stripIdentityFields({
    userId: 'attacker-supplied',
    user_id: 'attacker-supplied',
    tenant: 'attacker-supplied',
    email: 'attacker@example.com',
    productId: 'keep-me',
    quantity: 3,
  });

  expect(cleaned).toEqual({ productId: 'keep-me', quantity: 3 });
});

let userA: string;
let userB: string;

beforeAll(async () => {
  const [a, b] = await Promise.all([
    createTestUser('ai-auth-a'),
    createTestUser('ai-auth-b'),
  ]);
  userA = a.id;
  userB = b.id;

  await createTestProduct(userA, { quantity: 5, sku: 'AI-AUTH-A-PRODUCT' });
  await createTestProduct(userB, { quantity: 9, sku: 'AI-AUTH-B-PRODUCT' });
});

afterAll(async () => {
  await deleteTestUser(userA);
  await deleteTestUser(userB);
});

test('a read-only tool call resolves against the session user, not an injected userId', async () => {
  // The executor is called exactly as the model-facing pipeline would call it: with the
  // session's own userId as the first argument, and a raw, model-supplied arguments
  // object that carries an injected userId belonging to a different tenant.
  const { response } = await executeToolCall(userA, {
    name: 'list_products',
    args: { userId: userB, search: 'AI-AUTH' },
  });

  const output = response.output as { sku: string }[];
  const skus = output.map((p) => p.sku);

  expect(skus).toContain('AI-AUTH-A-PRODUCT');
  expect(skus).not.toContain('AI-AUTH-B-PRODUCT');
});

test('a mutating tool call proposes against the session user, not an injected userId', async () => {
  const [productA] = (
    await executeToolCall(userA, { name: 'list_products', args: { search: 'AI-AUTH-A' } })
  ).response.output as { id: string }[];

  const { response, proposal } = await executeToolCall(userA, {
    name: 'adjust_stock',
    args: {
      userId: userB, // injected -- must not redirect this proposal to user B
      productId: productA.id,
      delta: 1,
      reason: 'restock',
    },
  });

  expect(proposal).toBeDefined();
  expect(response.status).toBe('awaiting_approval');

  const [row] = await db
    .select()
    .from(aiToolInvocations)
    .where(eq(aiToolInvocations.id, proposal!.id));

  // The logged proposal belongs to the session user, never the injected one.
  expect(row.userId).toBe(userA);
});

test('an unknown tool name is rejected rather than dispatched', async () => {
  const { response, proposal } = await executeToolCall(userA, {
    name: 'run_sql',
    args: { query: 'SELECT * FROM users' },
  });

  expect(proposal).toBeUndefined();
  expect(response.error).toContain('Unknown tool');
});
