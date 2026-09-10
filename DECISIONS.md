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

**The seed uses a seeded LCG, not `Math.random`.** Re-runs produce identical quantities,
prices and per-sale unit counts, so the hand-computed analytics figures Phase 4 verifies
against stay stable. Timestamps are the exception: `soldAt` is derived from `Date.now()`
minus a fixed day offset, so the absolute dates shift with each run while their spacing
does not. Revenue-over-time buckets therefore move between runs; totals do not.

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

### Phase 3 review fixes

Three defects found in review after the Phase 3 commit, all of which typecheck and build
cleanly and so could not have been caught without reading the library source:

**1. `error.code === '23505'` never matched.** Drizzle wraps every driver error in
`DrizzleQueryError` and hangs the original pg error off `.cause`
(`drizzle-orm/pg-core/session.js:41`). Reading `error.code` on the thrown object therefore
found nothing, and all three unique-violation checks silently returned `false`. The
consequences were real spec violations: a duplicate registration email would have returned
`INTERNAL 500` instead of the generic 422 §5.1 requires, and a double-clicked sale would
have returned 500 instead of the original sale. `pgErrorCode` in `lib/errors.ts` now
unwraps one level of `.cause` and checks both shapes, and the three duplicated local
helpers were replaced by one shared `isUniqueViolation`.

**2. Middleware could produce an infinite redirect loop.** The original
"has cookie → redirect off `/login`" branch fought the `(app)` layout: with a cookie
present but its session row gone, `/dashboard` passed middleware, the layout resolved no
session and redirected to `/login`, and middleware sent it straight back. Re-running the
seed while signed in as the demo user is enough to trigger it. The branch is removed,
which also aligns middleware with §5.4, where its only stated job is redirecting
unauthenticated users away from `/(app)` routes.

**3. `ws` was a devDependency but is imported by `lib/db/index.ts`.** Moved to
`dependencies`, since it is a runtime import on any host whose global `WebSocket` is
absent.

---

## Phase 4 — Analytics

### What was built

- `lib/services/analytics.ts` — `getDashboardMetrics` (revenue, units, margin,
  revenue-over-time, top products by units and by revenue) and `getInventoryHealth`
  (stock value at cost, counts by health band).
- `lib/services/reorder.ts` — `getReorderAdvice` per §6.3, plus a pure
  `calculateReorderAdvice` the formula lives in so it can be unit-tested without a live
  sales fixture for every edge case.
- Routes: `GET /api/analytics/dashboard`, `GET /api/analytics/reorder-advice`.
- Dashboard page: 4 KPI cards, a Recharts revenue-over-time line chart, a top-products bar
  chart, and a low-stock table — each with a real empty state and a `loading.tsx` skeleton.
- `tests/reorder-math.test.ts`.
- Installed `recharts` and `@google/genai` (the latter used starting Phase 5).

### Key decisions

**Revenue-over-time buckets on IST calendar days, not UTC.** `date_trunc('day', sold_at AT
TIME ZONE 'Asia/Kolkata')` in SQL, and the day-key array on the app side built with
`Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })`. `date_trunc` on a bare
`timestamptz` buckets on the server's UTC day; a sale at 1am IST would land in the
previous day's bucket and the chart would be quietly wrong for exactly the hours a small
business is open early or late.

**All dashboard money aggregates are summed in Postgres `numeric`, not JS.**
`SUM(total_amount) - SUM(quantity * unit_cost)` for margin, `SUM(quantity * cost_price)`
for stock value — both stay `numeric` through the whole SQL expression and the driver
returns a string, exactly like every other money value in this codebase. §2.2's rule
against float arithmetic on money applies to aggregates as much as to a single price.

**`getReorderAdvice` returns only products at or below their own reorder threshold**, not
every product with a computed (and mostly irrelevant) suggestion. §3.2 describes the
Reorder Advisor as showing exactly that set, and the dashboard's low-stock table reuses
this same function's output rather than a second hand-rolled query — one function backs
both call sites.

**`get_low_stock` and `get_reorder_advice` (§7.3) will both be backed by
`getReorderAdvice`.** The AI tool table lists them as separate tools with different
"Returns" columns, but the underlying data and filter (at/below threshold) are identical;
`get_low_stock`'s handler will just project a smaller shape from the same result. Two
functions computing the same set independently is how they'd eventually disagree.

**`getDashboardMetrics` will also back the `get_sales_summary` AI tool** rather than a
separate service function. §6.4's "remaining services" list has no `getSalesSummary`, and
`get_sales_summary`'s required shape (revenue, units, margin, top products) is a subset of
what the dashboard already computes. The tool's handler must project down to only that
subset before it reaches the model — a full daily series is token cost with no benefit,
and less surface for injected product-name text (§7.6) to ride along on.

**Health bands are relative to each product's own `reorder_threshold`, not a fixed
number.** `out_of_stock` (quantity 0), `low` (0 < quantity ≤ its threshold), `healthy`
(above it). A fixed cutoff like "under 10 units" would call a product with a
threshold of 50 healthy at 20 units, which is backwards.

### What to understand before the interview

- **Why revenue-over-time is bucketed in IST and not UTC.** The business, its users, and
  its "today" are all IST. Bucketing on the server's UTC day is the kind of bug that never
  shows up in testing during the day and quietly misattributes late-night sales to the
  wrong day in the chart.
- **Why the low-stock table and the Reorder Advisor page (Phase 6) will share one query.**
  Both need "products at or below their reorder point." Computing that twice is exactly
  the kind of duplicated logic that drifts — the general reason §6 requires the AI tool
  layer and the REST API to call the same service functions, applied here to two UI
  surfaces instead.

---

## Phase 5 — AI assistant

### What was built

- `lib/ai/client.ts`, `lib/ai/prompt.ts`, `lib/ai/tools.ts` (§7.3's 9-tool registry, hand-
  written JSON Schema per tool), `lib/ai/executor.ts` (§7.4).
- `lib/services/purchase-orders.ts` — `createPurchaseOrderDraft` only; see below.
- Routes: `POST /api/ai/chat`, `POST /api/ai/actions/[id]/approve`,
  `POST /api/ai/actions/[id]/reject`.
- `components/assistant/chat.tsx` + `app/(app)/assistant/page.tsx` — chat UI with inline
  confirmation cards for proposals.
- `tests/ai-authorization.test.ts` (test 3).

### Key decisions

**The approve route claims a proposal with one conditional `UPDATE`, not a read-then-
write.** The spec's own prose for §7.5 ("load the invocation row; checks
`row.user_id === session.userId`; checks `status === 'proposed'`; checks not expired;
executes the service; sets `status='approved'`") describes those as sequential steps, but
implemented literally that way, two simultaneous approval requests both read
`status='proposed'`, both pass every check, and both execute the underlying service call —
the exact lost-update shape §4.1 exists to prevent, just on `ai_tool_invocations` instead
of `products`. The fix is the same shape as `recordSale`'s row lock, translated to a
single statement: `UPDATE ai_tool_invocations SET status='approved' WHERE id=$1 AND
user_id=$2 AND status='proposed' AND expires_at > now()`. Zero rows affected is the
single failure signal for "not yours," "doesn't exist," "already handled," and "expired
by the letter of the check" all at once — which is also the `NOT_FOUND`-not-`FORBIDDEN`
reasoning from §6.1 applied to this table. This is not a deviation from §7.5; it is the
same requirement ("single-use — a second approval fails") implemented so that it is
actually true under concurrency, not just true when tested serially.

**`status='expired'` is written lazily, on a failed approval claim past `expires_at`, not
by a scheduled job.** §0 rule 3 rules out queues and cron. `getSession()` already expires
stale sessions the same way — on read, opportunistically — so the approve route does the
same thing: if the atomic claim above matches nothing, but the row is still ours and still
`status='proposed'`, it is past its expiry; mark it `expired` there and return
`NOT_FOUND`.

**`get_low_stock` and `get_reorder_advice` are both thin projections of
`getReorderAdvice`.** Decided in Phase 4, implemented here: one query backs both tools'
"Returns" shapes from §7.3 rather than two independent implementations of "products at or
below threshold" that could disagree.

**`get_sales_summary` is a thin projection of `getDashboardMetrics`,** trimmed to
`{revenue, units, margin, topProducts}` before the result reaches the model. §6.4 lists
no separate `getSalesSummary`, and the tool's required shape is a strict subset of what
the dashboard already computes. Projecting matters here specifically: the full response
includes a 30-plus-point daily series and an inventory-health breakdown neither needed by
this tool nor free to hand to a model — extra tokens, and extra surface for injected
product-name text (§7.6) to travel on.

**`lib/services/purchase-orders.ts` ships with only `createPurchaseOrderDraft` in this
phase.** The `create_purchase_order_draft` tool needs it to exist and compile; the file
is complete and correct for what it does, but `listPurchaseOrders`, `updatePurchaseOrder`,
the PO list/detail UI, and AI-drafted email generation are Phase 6 work (§12 places the PO
draft *feature* there) and will extend this same file rather than create a second one.

**The PO email draft (Phase 6) will call the Gemini client directly, with no `tools:`
array.** Handing the tool registry to a second generation path would create a second code
path from model output to the database, breaking §7.1 rule 3 ("one executor"). A plain
`generateContent` call that only produces prose has nowhere to cause a write.

**Conversation history is a client-held, opaque round-trip value, not a server-persisted
table.** The schema (§4) has no chat-messages table, and §0 rule 3 rules out adding
infrastructure to fake statelessness another way. `POST /api/ai/chat` accepts the prior
`history` array back from the client and returns the updated one; the server holds no
conversation state between requests. `aiChatSchema` validates its shape (an array of
`{role, parts}`), not its exact contents, since the client only ever resends what this
same endpoint returned.

### What to understand before the interview

- **Why the approve route's `UPDATE` is the actual answer to "how do you stop a proposal
  being approved twice," not the `status='proposed'` check in isolation.** A status check
  followed by a separate write has a window between them; a single conditional `UPDATE`
  does not. This is the same principle as `SELECT ... FOR UPDATE` in `recordSale`, applied
  without a lock because a single-statement conditional update doesn't need one — the
  atomicity comes from the statement itself, not from holding a lock across several.
- **Why this uses `NOT_FOUND` for "already approved" and "not yours" alike.** Distinguishing
  them in the response would tell an attacker whether a given proposal id exists and
  belongs to someone else — an oracle, for the same reason a product `[id]` route never
  returns `FORBIDDEN`.
- **Why the identity-stripping step exists even though the Zod schemas already exclude
  `userId`.** Zod's default `.object()` behavior silently drops unrecognized keys anyway,
  so the explicit `stripIdentityFields` call is not the only thing preventing a
  hallucinated `userId` from reaching a handler — the handler's signature
  (`handler(userId, args)`) takes it as a separate argument the caller controls, not a
  field read out of `args`, at all. The explicit strip is defence in depth and an
  auditable step in the pipeline, not the sole safeguard; test 3 asserts the end state
  (results resolve against the session user) rather than assuming the strip alone is what
  guarantees it.
- **Why `get_sales_summary` and `get_low_stock` don't have their own service functions.**
  Two implementations of "revenue over a window" or "products below threshold" are two
  places for that logic to quietly diverge. One function, two callers, is the same
  argument §6 makes for the REST API and the AI tool layer sharing service functions in
  the first place — applied one level down, to tools sharing functions with each other.

---

## Phase 6 — Innovation + ship

### What was built

- `app/(app)/reorder/page.tsx` + `components/reorder/reorder-table.tsx` — the Reorder
  Advisor UI: every at/below-threshold product with velocity, days of cover, lead time,
  suggested quantity, and the four assumptions on screen, plus select-and-draft grouped by
  supplier.
- `lib/services/purchase-orders.ts` extended with the AI email draft,
  `listPurchaseOrders`, `updatePurchaseOrder`.
- Routes: `GET/POST /api/purchase-orders`, `PATCH /api/purchase-orders/[id]`.
- `components/purchase-orders/purchase-order-list.tsx` + page — list, line detail, editable
  email draft, mark sent/cancelled.
- `README.md`, all eleven §13 sections.

### Key decisions

**The AI email-drafting call passes no `tools:` array and is not routed through
`lib/ai/executor.ts`.** It only ever produces prose stored in `purchase_orders.email_draft`
for a human to review and edit before the (human) sends it themselves — the app never
sends email (§3.2, explicitly out of scope). Handing this call the tool registry would
create a second code path from model output to the database, which is exactly what §7.1
rule 3 ("one executor") forbids. A generation call with no tools has nowhere to cause a
write, so it does not need the executor's pipeline.

**`thinkingConfig: { thinkingBudget: 0 }` on the email-drafting call, found by testing
against the live API, not assumed.** The first live draft came back truncated to a single
greeting line under `maxOutputTokens: 400` — Gemini 2.5 Flash's extended thinking consumes
part of that budget before any visible text is emitted, and for a short, non-reasoning
task like a business email, thinking bought nothing while quietly eating the output. This
is scoped to this one call: the chat assistant's `maxOutputTokens: 1024` in
`lib/ai/executor.ts` is §7.2's explicit value and was left untouched, since thinking is
plausibly useful there for tool selection across a 5-round loop, and the spec does not
authorize changing that number.

**A purchase order's `status` only ever moves one way out of `'draft'`, and only
`emailDraft` and `status` are editable — never the lines or the total.** A sent or
cancelled PO is a historical record of what was actually ordered, at what cost, at that
time — the same reasoning §4's schema notes give for snapshotting sale price and cost
rather than joining back to `products`. Letting a "draft" edit silently rewrite quantities
after the fact would make that record unreliable.

**Items with no supplier cannot be selected on the Reorder Advisor page**, rather than
being selectable and failing on submit. `createPurchaseOrderDraft` requires a
`supplierId`; a product with `supplier_id IS NULL` has nowhere for an order to go, and the
UI says so on the row instead of letting the user discover it from a 404 after clicking
Draft.

### What to understand before the interview

- **Why the PO email generation is architecturally separate from the chat assistant**,
  despite both calling the same Gemini client. One is inside the executor's allowlist/
  validate/authorize/log pipeline and can request tool calls that read or propose writes;
  the other is a single bounded prompt-to-string call with no tools, invoked directly by a
  service function, that cannot request anything. Two different trust levels for two
  different jobs, not an inconsistency.
- **Why disabling thinking for the email call was a testing finding, not a guess.** The
  first version used `maxOutputTokens: 400` with thinking enabled by default and produced
  a truncated email in the live response — caught by actually reading what came back, not
  by assuming a reasonable-sounding token budget would work. Say this if asked how bugs
  were caught during the build: by running the real thing against the real API and
  reading the real output, not by code review alone.
- **Why POs don't support editing line quantities after creation.** The moment a line is
  drafted it is a record of what was proposed to a supplier at a specific cost; changing
  it later would be indistinguishable from rewriting history. Cancel and re-draft is the
  correct path for "I ordered the wrong quantity," the same way sales are never edited,
  only ever followed by a new movement.
