import bcrypt from 'bcryptjs';

// Cost 12: roughly 250ms per hash on typical hardware. Deliberately slow, because the
// threat model is an attacker who has stolen the password_hash column and is running
// offline guesses. Every doubling of cost doubles their work too.
const BCRYPT_COST = 12;

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
