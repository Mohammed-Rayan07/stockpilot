import { config } from 'dotenv';

// Loads .env so DATABASE_URL is present before lib/db is imported. Vitest does not read
// .env on its own the way Next.js does.
config({ path: '.env' });

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests run against a real Postgres because they ' +
      'verify row-level locking and tenant scoping, neither of which a mock can prove.',
  );
}
