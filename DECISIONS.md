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
