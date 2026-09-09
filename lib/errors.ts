// One error class per code in the §8.1 envelope. Route handlers map these to HTTP
// status codes in one place, so no handler invents its own error shape.

export type AppErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'INSUFFICIENT_STOCK'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(
    code: AppErrorCode,
    status: number,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'You must be signed in.') {
    super('UNAUTHENTICATED', 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have access to this resource.') {
    super('FORBIDDEN', 403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found.') {
    super('NOT_FOUND', 404, message);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid input.', details: Record<string, unknown> = {}) {
    super('VALIDATION_ERROR', 422, message, details);
  }
}

export class InsufficientStockError extends AppError {
  constructor(available: number, requested: number) {
    super('INSUFFICIENT_STOCK', 409, `Only ${available} units in stock.`, {
      available,
      requested,
    });
  }
}

export class RateLimitedError extends AppError {
  constructor(message = 'Too many requests. Try again shortly.') {
    super('RATE_LIMITED', 429, message);
  }
}

/** Postgres unique-violation SQLSTATE. */
export const POSTGRES_UNIQUE_VIOLATION = '23505';

/**
 * Pulls the Postgres SQLSTATE out of a thrown error.
 *
 * Drizzle wraps driver errors in DrizzleQueryError and hangs the original pg error off
 * `.cause` (see drizzle-orm/pg-core/session.js), so reading `error.code` directly finds
 * nothing and every constraint check silently returns false. Both shapes are checked
 * rather than depending on the Drizzle version.
 */
export function pgErrorCode(error: unknown): string | undefined {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];

  for (const candidate of candidates) {
    if (typeof candidate === 'object' && candidate !== null && 'code' in candidate) {
      const code = (candidate as { code?: unknown }).code;
      if (typeof code === 'string') {
        return code;
      }
    }
  }

  return undefined;
}

export function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === POSTGRES_UNIQUE_VIOLATION;
}
