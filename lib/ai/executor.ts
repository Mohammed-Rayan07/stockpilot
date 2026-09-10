import { ApiError, type Content, type Part } from '@google/genai';
import { db } from '../db';
import { aiToolInvocations } from '../db/schema';
import { AppError, RateLimitedError } from '../errors';
import { getGeminiClient, GEMINI_MODEL } from './client';
import { buildSystemPrompt } from './prompt';
import { findTool, TOOLS } from './tools';

// §7.4: the single code path from a model function call to a database read or write.
// Nothing else in the codebase dynamic-dispatches on a model-supplied tool name --
// findTool() only ever returns a reference from the hand-written TOOLS array (§7.1 rule 2).

const MAX_TOOL_ROUNDS = 5;
const PROPOSAL_TTL_MS = 5 * 60 * 1000;

// §7.1 rule 1: if the model hallucinates one of these into a function call's arguments,
// it is removed before the arguments ever reach Zod validation or a service function.
const IDENTITY_FIELDS = ['userId', 'user_id', 'tenant', 'email'];

export function stripIdentityFields(args: Record<string, unknown>): Record<string, unknown> {
  const clean = { ...args };
  for (const field of IDENTITY_FIELDS) {
    delete clean[field];
  }
  return clean;
}

type InvocationLog = {
  userId: string;
  toolName: string;
  arguments: unknown;
  status: 'executed' | 'proposed' | 'error';
  resultSummary?: string;
  errorMessage?: string;
  expiresAt?: Date;
};

async function logInvocation(entry: InvocationLog) {
  const [row] = await db
    .insert(aiToolInvocations)
    .values({
      userId: entry.userId,
      toolName: entry.toolName,
      arguments: entry.arguments as object,
      status: entry.status,
      resultSummary: entry.resultSummary ?? null,
      errorMessage: entry.errorMessage ?? null,
      expiresAt: entry.expiresAt ?? null,
    })
    .returning();

  return row;
}

// Truncated, not the full payload: this is a human-scannable audit trail, not a second
// copy of the data.
function summarize(result: unknown): string {
  return JSON.stringify(result).slice(0, 500);
}

function describeProposal(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'record_sale': {
      const price = args.unitPrice ? ` at ₹${args.unitPrice} each` : '';
      return `Log a sale of ${args.quantity} unit(s) of product ${args.productId}${price}.`;
    }
    case 'adjust_stock': {
      const delta = args.delta as number;
      const sign = delta > 0 ? '+' : '';
      return `Adjust stock for product ${args.productId} by ${sign}${delta} (${args.reason}).`;
    }
    case 'create_purchase_order_draft': {
      const lineCount = Array.isArray(args.lines) ? args.lines.length : 0;
      return `Create a draft purchase order for supplier ${args.supplierId} with ${lineCount} line(s).`;
    }
    default:
      return `Run ${toolName}.`;
  }
}

export type ToolProposal = { id: string; toolName: string; description: string };

/**
 * Runs one model-requested function call through allowlist -> strip identity -> validate
 * -> branch on mutating -> log (§7.4 steps 1-5). Every branch logs, including failure
 * branches, so the audit trail covers rejected and malformed calls, not just successful ones.
 */
export async function executeToolCall(
  userId: string,
  call: { name: string; args: Record<string, unknown> },
): Promise<{ response: Record<string, unknown>; proposal?: ToolProposal }> {
  // 1. Allowlist check. An unknown name never reaches a handler.
  const tool = findTool(call.name);

  if (!tool) {
    await logInvocation({
      userId,
      toolName: call.name,
      arguments: call.args,
      status: 'error',
      errorMessage: 'Unknown tool',
    });
    return { response: { error: `Unknown tool: ${call.name}` } };
  }

  // 2. Strip identity fields, then 3. Zod-validate what remains.
  const stripped = stripIdentityFields(call.args ?? {});
  const parsed = tool.zodSchema.safeParse(stripped);

  if (!parsed.success) {
    await logInvocation({
      userId,
      toolName: tool.name,
      arguments: stripped,
      status: 'error',
      errorMessage: 'Invalid arguments',
    });
    return {
      response: {
        error: 'Invalid arguments',
        details: parsed.error.issues.map((issue) => issue.message),
      },
    };
  }

  // 4. Branch on mutating.
  if (!tool.mutating) {
    try {
      const result = await tool.handler(userId, parsed.data);
      await logInvocation({
        userId,
        toolName: tool.name,
        arguments: parsed.data,
        status: 'executed',
        resultSummary: summarize(result),
      });
      return { response: { output: result } };
    } catch (error) {
      const message = error instanceof AppError ? error.message : 'Tool execution failed.';
      await logInvocation({
        userId,
        toolName: tool.name,
        arguments: parsed.data,
        status: 'error',
        errorMessage: message,
      });
      return { response: { error: message } };
    }
  }

  // Mutating tools never execute here (§7.4 step 4 / §16 trap 7). A proposal row is the
  // only thing this path writes; the approval route in lib/ai/../app/api/ai/actions is
  // the only code that later calls this same tool's handler.
  const description = describeProposal(tool.name, parsed.data as Record<string, unknown>);
  const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MS);
  const row = await logInvocation({
    userId,
    toolName: tool.name,
    arguments: parsed.data,
    status: 'proposed',
    expiresAt,
  });

  return {
    response: { proposalId: row.id, description, status: 'awaiting_approval' },
    proposal: { id: row.id, toolName: tool.name, description },
  };
}

const toolDeclarations = TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  parameters: tool.parameters,
}));

async function callGemini(contents: Content[], systemInstruction: string, withTools: boolean) {
  const client = getGeminiClient();

  try {
    return await client.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        systemInstruction,
        maxOutputTokens: 1024,
        ...(withTools ? { tools: [{ functionDeclarations: toolDeclarations }] } : {}),
      },
    });
  } catch (error) {
    // Free-tier 429s become a friendly message, never a stack trace (§7.2).
    if (error instanceof ApiError && error.status === 429) {
      throw new RateLimitedError('The assistant is busy right now. Try again in a moment.');
    }
    throw error;
  }
}

export type AssistantTurnResult = {
  text: string;
  history: Content[];
  proposals: ToolProposal[];
};

/**
 * Single entry point from a user's chat message to a model reply (§7.4 "One executor").
 * Owns the whole function-call round trip, capped at MAX_TOOL_ROUNDS so a model that keeps
 * requesting calls cannot run up cost or loop forever.
 */
export async function runAssistantTurn(params: {
  userId: string;
  userName: string;
  message: string;
  history: Content[];
}): Promise<AssistantTurnResult> {
  const systemInstruction = buildSystemPrompt(params.userName);
  const contents: Content[] = [...params.history, { role: 'user', parts: [{ text: params.message }] }];
  const proposals: ToolProposal[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await callGemini(contents, systemInstruction, true);
    const calls = response.functionCalls;

    if (!calls || calls.length === 0) {
      const text = response.text ?? '';
      contents.push({ role: 'model', parts: [{ text }] });
      return { text, history: contents, proposals };
    }

    const modelContent = response.candidates?.[0]?.content;
    if (modelContent) {
      contents.push(modelContent);
    }

    const responseParts: Part[] = [];
    for (const call of calls) {
      const { response: toolResponse, proposal } = await executeToolCall(params.userId, {
        name: call.name ?? '',
        args: (call.args ?? {}) as Record<string, unknown>,
      });

      if (proposal) {
        proposals.push(proposal);
      }

      responseParts.push({ functionResponse: { name: call.name, response: toolResponse } });
    }

    contents.push({ role: 'user', parts: responseParts });
  }

  // Round cap reached with calls still pending: one final call with no tools available,
  // so the model must answer from what has already been gathered instead of requesting
  // another round (§7.4 step 6).
  const finalResponse = await callGemini(contents, systemInstruction, false);
  const text = finalResponse.text ?? "I wasn't able to finish gathering everything in time.";
  contents.push({ role: 'model', parts: [{ text }] });

  return { text, history: contents, proposals };
}
