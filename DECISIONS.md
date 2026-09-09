# DECISIONS

A running log of the judgement calls made while implementing `BUILD_SPEC.md`, one
section per phase. Where the spec left something genuinely ambiguous, the option most
consistent with the rest of the spec was chosen and recorded here.

---

## Phase 1 — Foundation

### What was built

- Next.js 15.5.25 (App Router, TypeScript `strict`, Tailwind v4), scaffolded with
  `create-next-app@15`.
- `lib/db/schema.ts` — all eight tables from §4, with every CHECK, index, partial
  unique index and foreign-key action the spec lists.
- `lib/db/index.ts` — `@neondatabase/serverless` **Pool** + `drizzle-orm/neon-serverless`.
- `lib/money.ts` — `toMinor` / `toMajor` / `formatINR`, integer minor units only.
- `lib/errors.ts` — one error class per §8.1 code, each carrying its HTTP status.
- `drizzle.config.ts` — reads `DATABASE_URL_UNPOOLED` for migrations.
- `lib/db/migrations/0000_init.sql` — generated from the schema, not hand-written.
- `lib/db/seed.ts` — demo user, 2 suppliers, 6 products, 62 sales across 45 days.
- `.env.example` with every §10 variable and empty values.

### Key decisions

**`toMinor` parses the decimal string rather than doing `Number(v) * 100`.** The whole
point of §2.2 is that float arithmetic corrupts money; doing a float multiply inside the
helper meant to prevent that would undercut the claim. It splits on the decimal point,
takes two digits, and rounds half-up on the third — one rounding step, integers only.

**Status/reason/actor columns are `text` with a TypeScript union via Drizzle's
`$type<>()`, not Postgres enums.** §4 specifies `text` and lists the allowed values in a
comment. `$type<>()` buys compile-time safety without changing the emitted DDL, so the
migration still matches the spec byte for byte. A real `CREATE TYPE` enum would have
been a schema change the spec did not ask for.

**The seed deletes the demo user's rows in explicit child-first order rather than
deleting the user and relying on `ON DELETE CASCADE`.** `sales` and `stock_movements`
reference `products` with `ON DELETE RESTRICT`; Postgres does not guarantee the order in
which cascaded deletes fire, so the cascade could hit the RESTRICT and abort. Explicit
ordering is the only version certain to succeed. This is what makes the seed idempotent:
re-running rebuilds the dataset rather than appending to it.

**The seed uses a seeded LCG, not `Math.random`.** Re-runs must produce identical data,
otherwise the hand-computed analytics figures that Phase 4 verifies against would drift
between runs.

**The seed derives opening stock as `finalQuantity + unitsSold`.** Quantities are planned
backwards from the desired end state so that `products.quantity` and the
`stock_movements` ledger agree — the §4.2 reconciliation query returns zero rows on
seeded data by construction, not by luck.

**`@types/node` was bumped from `^20` to `^24`.** `vitest@5` declares a peer dependency of
`@types/node@^22 || >=24` and npm refused to install otherwise. This is a type-definition
version bump matching the installed Node 24 runtime, not a library substitution.

### Environment note — not a code decision

The project folder is named `AI-Powered Inventory & Stock Tracker`. The `&` breaks every
`node_modules/.bin` shim on Windows `cmd.exe`, so `npm run db:migrate`, `npm test` and
`npx drizzle-kit` all fail with `'Stock' is not recognized as an internal or external
command`. The `package.json` scripts are written the standard way (correct on Vercel, CI
and any non-`&` path); the fix is to rename the folder so it contains no `&`. See
`SETUP_SO_FAR.md`.

### What to understand before the interview

- **Why the WebSocket pool driver and not `neon-http`.** `neon-http` sends each statement
  as an independent HTTP request, so it cannot hold a transaction open across statements.
  `db.transaction()` and `SELECT ... FOR UPDATE` would compile and run but not actually
  lock anything — the failure is silent, which is what makes it dangerous.
- **Why `numeric` comes back as a string.** `numeric` holds more precision than a JS
  `number` can represent, so the driver refuses to lose data by coercing it. Every money
  value therefore enters the app as a string and must go through `toMinor` before any
  arithmetic touches it.
- **Why `(user_id, sku)` and not a global unique `sku`.** A global constraint would let
  one tenant's SKU collide with another's, which both blocks a legitimate signup and
  leaks the fact that another tenant holds that SKU.
- **Why `products.quantity` and `stock_movements` both exist.** Deliberate
  denormalisation: reading current stock is one indexed lookup instead of a `SUM` over
  the whole ledger, while the ledger preserves a full audit trail. The invariant that
  keeps them honest is that only two functions may write `products.quantity`, and both do
  it inside a transaction that also appends the matching ledger row.

---

## Phase 2 — Authentication

### What was built

- `lib/auth/password.ts` — bcrypt cost 12.
- `lib/auth/session.ts` — token generation, sha256 hashing, cookie set/clear, `getSession`,
  `destroySession`.
- `lib/auth/guard.ts` — `requireSession()`, the real authorization boundary.
- `lib/auth/origin.ts` — `requireSameOrigin()`, the second CSRF layer.
- `lib/rate-limit.ts` — in-memory fixed-window counter, 10 attempts / 15 min per `ip:email`.
- `lib/services/auth.ts` — `registerUser`, `authenticateUser`.
- `lib/api.ts` — the §8.1 error envelope and Zod body/query parsing, in one place.
- `lib/validation/schemas.ts` — every input schema, defined once.
- `lib/client-api.ts` — browser fetch wrapper that unwraps the error envelope.
- `POST /api/auth/register`, `/login`, `/logout`.
- `middleware.ts` — cookie-presence redirect only, no database access.
- Login and register pages, the `(app)` shell with sign-out, a placeholder dashboard.
- shadcn/ui initialised; 10 primitives added.

### Key decisions

**Login hashes a dummy password when the email is unknown.** Without it, an unknown email
returns in ~1ms and a known one in ~250ms, because only the known path runs bcrypt.
§5.8 requires that failures be indistinguishable, and response time is part of the
response. `DUMMY_HASH` is a fixed cost-12 hash used purely to burn the same CPU.

**A missing `Origin` header is rejected, not allowed.** Browsers attach `Origin` to every
request whose method is not GET/HEAD, including same-origin ones, so a legitimate
mutation from the app always carries it. Treating "absent" as "trusted" is the standard
way this check gets bypassed by a non-browser client.

**`quantity` is deliberately absent from `updateProductSchema`.** Stock may only change
through `recordSale` and `adjustStock`, which write the ledger in the same transaction.
Allowing a generic product edit to set the quantity would break the §4.2 invariant
silently, so the field is simply not accepted.

**The rate-limit key is `ip:email`, not just `email`.** Keying on the email alone would let
an attacker lock a victim out of their own account by burning the limit from anywhere.

**The `(app)` layout calls `getSession()` and redirects rather than calling
`requireSession()` and throwing.** A thrown error in a layout renders an error page; a
signed-out visitor should see the login form. Route handlers and leaf pages still use
`requireSession()`, which throws, because there the caller wants a 401.

**shadcn's current registry (`base-nova`) is built on Base UI, not Radix.** Its `Button`
takes a `render` prop rather than `asChild`, so links styled as buttons use
`buttonVariants({...})` as a `className` on `next/link`. This is a CLI default, not a
library substitution — §2 says shadcn/ui, and this is what shadcn/ui installs today.

### What to understand before the interview

- **Why the session token is sha256'd but the password is bcrypt'd.** The token is 256
  bits of CSPRNG output and is not guessable, so a slow hash buys nothing and costs
  latency on every request. Passwords are low-entropy and human-chosen, so slowness is
  exactly the point.
- **Why there is a session table rather than a stateless JWT.** A session row can be
  deleted, which revokes access instantly. A JWT stays valid until it expires no matter
  what happens server-side. For an app that mutates business data, revocability is worth
  one indexed read per request.
- **Why `middleware.ts` is not the security boundary.** It runs on the Edge runtime, which
  has no Node APIs, so it cannot reach the pool driver. It checks only that a `sid`
  cookie exists — a completely forged cookie passes it. Say this plainly; the two-layer
  split is the point, not an oversight.
- **Why registration returns "could not create account" on a duplicate email.** Saying
  "that email is taken" turns the signup form into a membership oracle for any address.
- **The honest limit of the rate limiter.** The `Map` lives in one serverless instance's
  memory. Vercel runs many and recycles them, so an attacker spreading attempts across
  instances sees a much higher effective limit. Redis or Upstash is the correct
  production answer. Disclose this rather than let a reviewer find it.

---

## Phase 3 — Core domain

### What was built

- `lib/services/sales.ts` — `recordSale` (§6.1), `adjustStock` (§6.2), `listSales`.
- `lib/services/products.ts` — `listProducts`, `getProduct`, `createProduct`,
  `updateProduct`, `archiveProduct`.
- `lib/services/suppliers.ts` — `listSuppliers`, `createSupplier`.
- Routes: `GET|POST /api/products`, `PATCH|DELETE /api/products/[id]`,
  `GET|POST /api/suppliers`, `GET|POST /api/sales`, `POST /api/stock/adjust`.
- Products page (table, create/edit dialog, archive, stock-adjust dialog, supplier
  dialog) and Sales page (log-a-sale form, sales history).
- `tests/sale-transaction.test.ts` and `tests/tenant-isolation.test.ts`, plus
  `vitest.config.ts`, `tests/setup.ts` and `tests/helpers.ts`.

### Key decisions

**Idempotency is handled outside `db.transaction()`, not inside it.** §6.1's prose says to
catch `23505` from the sales insert and return the existing sale, but the moment that
insert raises inside the transaction, Postgres marks the transaction aborted — every
subsequent statement in it fails with "current transaction is aborted". A catch placed
inside the callback therefore could not run the follow-up SELECT. The catch sits around
the whole `db.transaction()` call, and the lookup runs on a fresh connection.

**`adjustStock` lives in `lib/services/sales.ts` alongside `recordSale`.** §9 defines no
`stock.ts`, and §4.2's invariant is that *exactly two* functions may write
`products.quantity`. Keeping both in one file means that claim can be verified by reading
a single file rather than trusting a grep.

**`createProduct` writes an `initial` ledger row inside a transaction when opening stock
is non-zero.** Creating a product with `quantity: 50` is a write to `products.quantity`.
Without the matching ledger row, the §4.2 reconciliation query would report a mismatch on
every newly created product. This is a third writer of `products.quantity` in the literal
sense, but it writes the value at *insert* time rather than mutating an existing row; the
invariant that matters — no change to quantity without a ledger row in the same
transaction — holds.

**Cross-tenant access returns `NOT_FOUND`, never `FORBIDDEN`.** A 403 confirms that the id
exists, which turns every `/api/products/[id]` route into an existence oracle across
tenants. Same reasoning as the generic registration error.

**Supplier creation is a dialog on the products page, not a `/suppliers` route.** §9's
file structure defines no suppliers page and §3.3 forbids adding features or restructuring
folders, but Phase 3 asks for supplier CRUD with UI. A dialog satisfies both. The service
layer implements only `listSuppliers` and `createSupplier`, which is exactly what §6.4
lists — there is no supplier update or delete anywhere in the spec.

**`listProducts` excludes archived products.** §8 has no `includeArchived` parameter and
archiving is the app's stand-in for deletion, so an archived product should disappear from
the working list. Its sales history is untouched.

### What to understand before the interview

- **The exact race `recordSale` prevents.** Two transactions read `quantity = 1` from
  their own READ COMMITTED snapshots, both pass `1 >= 1`, both write `0`. One unit, two
  sales. `SELECT ... FOR UPDATE` makes the second transaction block until the first
  commits, after which it re-reads the *updated* row and fails correctly.
- **Why the stock check sits after the lock and not before.** The check is only meaningful
  against a value nobody else can change underneath you. Checking first and locking after
  reintroduces exactly the window the lock exists to close.
- **Why `CHECK (quantity >= 0)` is not redundant.** The lock is the primary defence and the
  constraint is defence in depth: if the application logic were ever wrong, the database
  still refuses to record negative stock. Name both, in that order.
- **The alternatives, and why `FOR UPDATE` was chosen.** `SERIALIZABLE` isolation with a
  retry loop on serialization failure, or an atomic conditional update
  (`UPDATE ... SET quantity = quantity - $1 WHERE id = $2 AND quantity >= $1`, then check
  the affected row count). Both are correct. `FOR UPDATE` was chosen because the intent is
  explicit in the code and reads clearly in review.
- **Why deadlock is impossible here.** Exactly one product row is locked per transaction.
  Deadlock needs two transactions each holding a lock the other wants, which needs at
  least two rows. If a future feature locked several rows, they would have to be locked in
  a consistent order — ascending `id`.
- **Why price and cost are copied onto the sale row.** Joining back to
  `products.unit_price` for historical reporting would make last month's revenue change
  when today's price changes. That is a correctness bug, not a shortcut.
