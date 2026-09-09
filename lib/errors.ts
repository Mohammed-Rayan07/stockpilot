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
