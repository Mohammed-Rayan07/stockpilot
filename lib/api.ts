import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { AppError, ValidationError } from './errors';

// Every handler shapes its response through here, so the §8.1 envelope is produced in
// exactly one place and no handler can invent its own error format.

export function jsonOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function jsonError(
  code: string,
  status: number,
  message: string,
  details: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

/**
 * Maps a thrown error to the response envelope.
 *
 * Anything that is not an AppError is an unexpected failure: it is logged in full with a
 * correlation id, and the client receives only that id. Returning the underlying message
 * would leak schema details, table names and constraint names to an attacker.
 */
export function handleRouteError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return jsonError(error.code, error.status, error.message, error.details);
  }

  const correlationId = randomUUID();
  console.error(`[INTERNAL ${correlationId}]`, error);

  return jsonError('INTERNAL', 500, 'Something went wrong.', { correlationId });
}

/** Parses a JSON body against a Zod schema, converting failures into a 422. */
export async function parseJsonBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    throw new ValidationError('Request body must be valid JSON.');
  }

  const result = schema.safeParse(raw);

  if (!result.success) {
    throw new ValidationError('Invalid input.', { fields: fieldErrors(result.error) });
  }

  return result.data;
}

export function parseQuery<T>(url: URL, schema: ZodType<T>): T {
  const result = schema.safeParse(Object.fromEntries(url.searchParams));

  if (!result.success) {
    throw new ValidationError('Invalid query parameters.', { fields: fieldErrors(result.error) });
  }

  return result.data;
}

function fieldErrors(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_';
    if (!fields[path]) {
      fields[path] = issue.message;
    }
  }

  return fields;
}
