import { UnauthenticatedError } from '../errors';
import { getSession, type SessionUser } from './session';

/**
 * The real authorization boundary. Every route handler and every protected Server
 * Component calls this; nothing trusts `middleware.ts`, which only checks that a cookie
 * is present and cannot tell a valid token from a forged one.
 */
export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();

  if (!session) {
    throw new UnauthenticatedError();
  }

  return session;
}
