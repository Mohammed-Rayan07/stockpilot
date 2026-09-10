import { and, eq } from 'drizzle-orm';
import { handleRouteError, jsonOk } from '@/lib/api';
import { requireSameOrigin } from '@/lib/auth/origin';
import { requireSession } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { aiToolInvocations } from '@/lib/db/schema';
import { NotFoundError } from '@/lib/errors';

export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireSameOrigin(request);
    const { id } = await params;

    // Same atomic-claim shape as approve, minus the expiry check: rejecting an already
    // expired-but-not-yet-cleaned-up proposal is harmless and should still succeed.
    const [rejected] = await db
      .update(aiToolInvocations)
      .set({ status: 'rejected' })
      .where(
        and(
          eq(aiToolInvocations.id, id),
          eq(aiToolInvocations.userId, session.userId),
          eq(aiToolInvocations.status, 'proposed'),
        ),
      )
      .returning();

    if (!rejected) {
      throw new NotFoundError('Proposal not found or no longer awaiting approval.');
    }

    return jsonOk({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
