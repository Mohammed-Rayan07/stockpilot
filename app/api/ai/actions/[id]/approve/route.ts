import { and, eq, gt } from 'drizzle-orm';
import { handleRouteError, jsonOk } from '@/lib/api';
import { requireSameOrigin } from '@/lib/auth/origin';
import { requireSession } from '@/lib/auth/guard';
import { findTool } from '@/lib/ai/tools';
import { db } from '@/lib/db';
import { aiToolInvocations } from '@/lib/db/schema';
import { AppError, NotFoundError } from '@/lib/errors';

export const runtime = 'nodejs';

// §7.5. "Single-use -- a second approval fails" is a concurrency property, not just a
// status check: two simultaneous approvals of the same proposal must not both execute.
// The claim below is one conditional UPDATE whose WHERE clause is the ownership check,
// the status check and the expiry check together -- there is no separate read-then-write,
// so there is no window for two requests to both observe status='proposed' and both act
// on it. This is the same reasoning as the FOR UPDATE lock in recordSale (§4.1), applied
// to a row instead of a stock quantity.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireSameOrigin(request);
    const { id } = await params;

    const [claimed] = await db
      .update(aiToolInvocations)
      .set({ status: 'approved' })
      .where(
        and(
          eq(aiToolInvocations.id, id),
          eq(aiToolInvocations.userId, session.userId),
          eq(aiToolInvocations.status, 'proposed'),
          gt(aiToolInvocations.expiresAt, new Date()),
        ),
      )
      .returning();

    if (!claimed) {
      // Opportunistic cleanup, same idea as getSession() expiring stale sessions on read:
      // if this row is ours and still 'proposed' but past its expiry, the claim above
      // correctly did not match it. Mark it expired here rather than leaving it stuck.
      const [stale] = await db
        .select()
        .from(aiToolInvocations)
        .where(
          and(
            eq(aiToolInvocations.id, id),
            eq(aiToolInvocations.userId, session.userId),
            eq(aiToolInvocations.status, 'proposed'),
          ),
        );

      if (stale) {
        await db
          .update(aiToolInvocations)
          .set({ status: 'expired' })
          .where(eq(aiToolInvocations.id, id));
        throw new NotFoundError('This proposal has expired.');
      }

      // Cross-tenant, nonexistent, or already approved/rejected: all collapse to
      // NOT_FOUND. A more specific FORBIDDEN would confirm the id exists (§6.1's
      // reasoning, applied here).
      throw new NotFoundError('Proposal not found or no longer awaiting approval.');
    }

    const tool = findTool(claimed.toolName);

    if (!tool) {
      await db
        .update(aiToolInvocations)
        .set({ status: 'error', errorMessage: 'Unknown tool' })
        .where(eq(aiToolInvocations.id, id));
      throw new AppError('INTERNAL', 500, 'Could not execute this action.');
    }

    try {
      // The ledger records actor='ai_assistant' inside recordSale/adjustStock because
      // the tool's own handler passes it, not because this route does anything special.
      const result = await tool.handler(session.userId, claimed.arguments);

      await db
        .update(aiToolInvocations)
        .set({ resultSummary: JSON.stringify(result).slice(0, 500) })
        .where(eq(aiToolInvocations.id, id));

      return jsonOk({ ok: true, result });
    } catch (error) {
      const message = error instanceof AppError ? error.message : 'Execution failed.';
      await db
        .update(aiToolInvocations)
        .set({ status: 'error', errorMessage: message })
        .where(eq(aiToolInvocations.id, id));
      throw error;
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
