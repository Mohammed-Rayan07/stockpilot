import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from './schema';

// The WebSocket pool driver, NOT drizzle-orm/neon-http. neon-http cannot hold an
// interactive transaction open, so db.transaction() and SELECT ... FOR UPDATE --
// the row lock that recordSale depends on -- would silently not work.
//
// Browsers and modern Node supply a global WebSocket; the `ws` polyfill is here so
// the driver also works under Vitest and older Node, where the global is absent.
if (typeof globalThis.WebSocket === 'undefined') {
  neonConfig.webSocketConstructor = ws;
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

// Use Neon's POOLED connection string here; drizzle-kit migrations use the
// direct/unpooled string instead (see drizzle.config.ts).
const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });
