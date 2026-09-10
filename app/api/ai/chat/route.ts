import type { Content } from '@google/genai';
import { handleRouteError, jsonOk, parseJsonBody } from '@/lib/api';
import { requireSameOrigin } from '@/lib/auth/origin';
import { requireSession } from '@/lib/auth/guard';
import { RateLimitedError } from '@/lib/errors';
import { runAssistantTurn } from '@/lib/ai/executor';
import { AI_CHAT_RATE_LIMIT, aiChatRateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { aiChatSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    requireSameOrigin(request);

    const input = await parseJsonBody(request, aiChatSchema);

    const key = aiChatRateLimitKey(session.userId);
    const limit = checkRateLimit(key, AI_CHAT_RATE_LIMIT.limit, AI_CHAT_RATE_LIMIT.windowMs);

    if (!limit.allowed) {
      throw new RateLimitedError('You have reached the assistant message limit for this hour.');
    }

    const result = await runAssistantTurn({
      userId: session.userId,
      userName: session.name,
      message: input.message,
      history: (input.history ?? []) as Content[],
    });

    return jsonOk({ reply: result.text, history: result.history, proposals: result.proposals });
  } catch (error) {
    return handleRouteError(error);
  }
}
