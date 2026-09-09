import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { sessions, users } from '../db/schema';

export const SESSION_COOKIE_NAME = 'sid';

const SESSION_TTL_DAYS = 7;
const SESSION_TTL_SECONDS = SESSION_TTL_DAYS * 24 * 60 * 60;

export type SessionUser = {
  userId: string;
  email: string;
  name: string;
};

/**
 * sha256, not bcrypt. The token is already 256 bits of CSPRNG output, so it is not
 * brute-forceable and a deliberately slow hash would buy nothing while costing latency
 * on every single request. Slow hashing exists for low-entropy human passwords.
 */
function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Creates a session row and returns the RAW token for the cookie. Only the hash is
 * persisted, so a database leak yields hashes rather than usable sessions.
 */
export async function createSession(userId: string): Promise<string> {
  const rawToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(rawToken),
    expiresAt,
  });

  return rawToken;
}

export async function setSessionCookie(rawToken: string): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true, // JavaScript cannot read it, so XSS cannot exfiltrate the session
    secure: process.env.NODE_ENV === 'production', // HTTPS only off localhost
    sameSite: 'lax', // not sent on cross-site POSTs, which blocks classic CSRF
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

/**
 * Resolves the current session, or null. This is the only place a raw cookie value is
 * turned into a user identity.
 */
export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!rawToken) {
    return null;
  }

  const tokenHash = hashToken(rawToken);

  const [row] = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      email: users.email,
      name: users.name,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, tokenHash));

  // No matching row means the cookie is forged, stale or from a deleted session. Return
  // without writing: an unauthenticated request with a garbage cookie must not be able to
  // make the server issue a DELETE, or every such request becomes a free write.
  if (!row) {
    return null;
  }

  if (row.expiresAt <= new Date()) {
    // Opportunistic cleanup, and only here — the token did match a real row, it has just
    // expired. Deleting it on presentation avoids needing a scheduled job.
    await db.delete(sessions).where(eq(sessions.id, row.sessionId));
    return null;
  }

  return { userId: row.userId, email: row.email, name: row.name };
}

/** Deletes the session row itself, not just the cookie (see §5.6). */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (rawToken) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(rawToken)));
  }

  await clearSessionCookie();
}
