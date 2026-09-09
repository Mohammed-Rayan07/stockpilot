# SETUP_SO_FAR.md

Everything you have to do yourself to run what exists after Phases 1–3. Nothing here was
done for you, because none of it can be: it all needs accounts and secrets.

---

## 0. First, rename the project folder

The folder is currently named:

```
AI-Powered Inventory & Stock Tracker
```

The `&` breaks every `node_modules/.bin` shim on Windows, because `cmd.exe` reads it as a
command separator. Every one of `npm test`, `npm run dev`, `npm run db:migrate` and
`npx drizzle-kit` fails with:

```
'Stock' is not recognized as an internal or external command
```

Close your editor and rename the folder so it has no `&` — for example:

```
AI-Powered Inventory and Stock Tracker
```

or just `stockpilot`. Then reopen it and continue. This is a Windows shell quirk, not a
project bug; `package.json` is written the standard way and works as-is on Vercel and CI.

(If you would rather not rename it, every command below also works in the form
`node ./node_modules/<pkg>/<bin>` — that is how they were run during the build — but
renaming is one step and fixes it permanently.)

---

## 1. Accounts to create

| Service | Why | Needed by |
|---|---|---|
| **Neon** (neon.tech) | Postgres database | Phase 1 onwards — required now |
| **Google AI Studio** (aistudio.google.com) | Gemini API key, free tier | Phase 5 — not needed yet |
| **Vercel** (vercel.com) | Hosting | Phase 6 — not needed yet |

Only **Neon** is required to run what exists today.

### Creating the Neon database

1. Sign up at neon.tech and create a project (any name; pick the region closest to you).
2. Open the project's **Connection Details** panel.
3. You need **two different strings** from that panel:
   - With the **"Pooled connection"** toggle **ON** → this is `DATABASE_URL`.
   - With the **"Pooled connection"** toggle **OFF** → this is `DATABASE_URL_UNPOOLED`.

   They differ by one piece of the hostname: the pooled one contains `-pooler`, like
   `ep-cool-name-123456-pooler.ap-southeast-1.aws.neon.tech`. The direct one is the same
   host without `-pooler`. Both end with `?sslmode=require`.

---

## 2. Create your `.env`

```bash
cp .env.example .env
```

Then fill in these four values. **Never commit `.env`** — it is already in `.gitignore`.

| Variable | Where the value comes from | Needed now? |
|---|---|---|
| `DATABASE_URL` | Neon → Connection Details → pooled string (**has `-pooler`**) | **Yes** |
| `DATABASE_URL_UNPOOLED` | Neon → Connection Details → direct string (**no `-pooler`**) | **Yes** |
| `GEMINI_API_KEY` | Google AI Studio → Get API key | No, Phase 5 |
| `APP_ORIGIN` | `http://localhost:3000` for local dev; your real Vercel URL once deployed | **Yes** |
| `NODE_ENV` | leave as `development` locally | **Yes** |

### Which Neon string goes where — and why it matters

- **`DATABASE_URL` (pooled)** is read by `lib/db/index.ts`, which the running app uses.
  Serverless functions open and drop connections constantly; Neon's pooler is what keeps
  that from exhausting the database's connection limit.
- **`DATABASE_URL_UNPOOLED` (direct)** is read by `drizzle.config.ts`, used only by
  `drizzle-kit`. DDL run through a connection pooler can land on different backend
  sessions between statements, which breaks migrations in ways that are painful to debug.

Getting these backwards mostly appears to work and then fails intermittently, which is the
worst failure mode. Check for `-pooler` in the hostname.

---

## 3. Commands, in order

Run from the project root, after the rename in step 0.

```bash
# 1. Install dependencies
npm install

# 2. Apply the migration to your Neon database
#    Creates all 8 tables with their indexes and CHECK constraints.
npm run db:migrate

# 3. Seed the demo dataset
#    1 demo user, 2 suppliers, 6 products, 62 sales over 45 days.
#    Safe to run more than once - it rebuilds the demo data rather than duplicating it.
npm run db:seed

# 4. Run the tests (tests 1 and 2 of the four; 3 and 4 arrive in Phases 4-5)
#    These need DATABASE_URL set - they run against real Postgres on purpose.
npm test

# 5. Start the dev server
npm run dev
```

Then open <http://localhost:3000>.

**Demo credentials created by the seed:**

```
email:    demo@stockpilot.app
password: demo-password-123
```

### Two extra commands you may want

```bash
npm run typecheck    # tsc --noEmit, strict mode
npm run db:generate  # regenerate migration SQL after editing lib/db/schema.ts
```

---

## 4. What to check once it is running

- `http://localhost:3000/dashboard` while signed out → redirects to `/login`.
- Register a new account, then sign out and sign back in.
- Products page → add a product, edit it, adjust its stock, archive it.
- Sales page → log a sale, watch the product's quantity drop by the same amount.
- Try to sell more units than exist → a 409 with "Only N units in stock", and the
  quantity is unchanged afterwards.

### The reconciliation query

Run this in Neon's SQL editor. **It must return zero rows** — that is the §4.2 invariant
that `products.quantity` always agrees with the `stock_movements` ledger.

```sql
SELECT p.id, p.quantity, COALESCE(SUM(m.delta), 0) AS ledger_balance
FROM products p LEFT JOIN stock_movements m ON m.product_id = p.id
GROUP BY p.id, p.quantity HAVING p.quantity <> COALESCE(SUM(m.delta), 0);
```

### If the tests fail on connect

If `npm test` fails with a WebSocket constructor error rather than an assertion failure,
open `lib/db/index.ts` and remove the `if (typeof globalThis.WebSocket === 'undefined')`
guard, so the polyfill is always applied:

```ts
neonConfig.webSocketConstructor = ws;
```

The guard skips the polyfill on Node 24 because a global `WebSocket` exists there, but
Neon's driver does not always accept it. **This is the fix — do not switch to
`drizzle-orm/neon-http`.** That driver cannot hold a transaction open, so `db.transaction()`
and `SELECT ... FOR UPDATE` would stop locking anything, silently, and test 1 would pass
for the wrong reason.

### Cookie check (Phase 2 verification)

In DevTools → Application → Cookies, the `sid` cookie must show **HttpOnly ✓** and
**SameSite = Lax**. `Secure` is off on localhost by design and on in production.

---

## 5. Not built yet

Phases 4–6 are not started: no analytics dashboard, no reorder advisor, no AI assistant,
no purchase orders, no README, no deployment. `GEMINI_API_KEY` and the Vercel account are
not needed until then.
