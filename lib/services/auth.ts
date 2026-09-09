import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import { isUniqueViolation, UnauthenticatedError, ValidationError } from '../errors';
import { hashPassword, verifyPassword } from '../auth/password';

// Deliberately identical for "no such account" and "wrong password". Differentiating
// them turns the login form into an account-existence oracle.
//
// Raised as UnauthenticatedError (401), not ValidationError (422): the credentials are
// well-formed, they just do not authenticate. 422 is reserved for input that failed Zod
// validation, so the two cases stay distinguishable to a client without either of them
// revealing which email addresses exist.
const LOGIN_FAILED_MESSAGE = 'Email or password is incorrect.';

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function registerUser(input: {
  email: string;
  password: string;
  name: string;
}): Promise<{ userId: string }> {
  const email = normaliseEmail(input.email);
  const passwordHash = await hashPassword(input.password);

  try {
    const [created] = await db
      .insert(users)
      .values({ email, passwordHash, name: input.name.trim() })
      .returning({ id: users.id });

    return { userId: created.id };
  } catch (error) {
    // A generic message, never "that email is taken": confirming which addresses are
    // registered leaks the user list to anyone with a signup form.
    if (isUniqueViolation(error)) {
      throw new ValidationError('Could not create account.');
    }
    throw error;
  }
}

// A fixed bcrypt hash at cost 12 of an arbitrary string. Only ever used to burn the same
// amount of CPU as a real comparison.
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.7Y1kQ0DkE4cS/PgFPPa2Yl0Uu.mSHKe';

export async function authenticateUser(input: {
  email: string;
  password: string;
}): Promise<{ userId: string }> {
  const email = normaliseEmail(input.email);

  const [user] = await db.select().from(users).where(eq(users.email, email));

  if (!user) {
    // Hash the supplied password against a throwaway value anyway, so that an unknown
    // email costs the same ~250ms as a known one. Without this, response time alone
    // reveals which addresses exist.
    await verifyPassword(input.password, DUMMY_HASH);
    throw new UnauthenticatedError(LOGIN_FAILED_MESSAGE);
  }

  const valid = await verifyPassword(input.password, user.passwordHash);

  if (!valid) {
    throw new UnauthenticatedError(LOGIN_FAILED_MESSAGE);
  }

  return { userId: user.id };
}
