# Tests

Five tests are specified, one per claim. All of them exist and run against a real
Postgres, not a mock. The properties under test are row-level locking, tenant scoping,
model-input authorization, reorder arithmetic and the AI approval race — a mocked
database would report whatever the mock was told to report and prove none of these.
`tests/setup.ts` loads `.env` and fails loudly if `DATABASE_URL` is missing.

Run everything with `npm test`, or one file with `npm test -- tests/<file>`.

## sale-transaction.test.ts

Proves that concurrent sales cannot oversell. It fires two `recordSale` calls for the last
remaining unit simultaneously and asserts that exactly one resolves, the other rejects with
`InsufficientStockError`, the final quantity is 0, and exactly one row exists in `sales` —
the lost update that `SELECT ... FOR UPDATE` exists to prevent, and the test to demo. Two
further cases in the same file assert that a rejected sale is a complete no-op (quantity
unchanged, no sale row, no ledger row), and that repeating an `idempotencyKey` returns the
original sale instead of decrementing stock a second time.

## tenant-isolation.test.ts

Proves that the `user_id` predicate in the service layer is a real boundary. User A holds
user B's exact product id and attempts to read, update, archive and sell it; every attempt
must fail as `NotFoundError` and leave B's row untouched. `NotFoundError` rather than
`ForbiddenError` is itself part of the claim — a 403 would confirm the id exists, turning
any `/api/products/[id]` route into an existence oracle across tenants. A final case
asserts that A's product list never contains B's rows.

## ai-authorization.test.ts

Proves that a `userId` injected into tool arguments by the model cannot redirect a tool
call to another tenant. `stripIdentityFields` is asserted to strip `userId`, `user_id`,
`tenant` and `email` while leaving every other argument alone. Then, calling the executor
with the session's own userId but an injected `userId` belonging to a different tenant: a
read-only tool call resolves against the session user (results contain A's data, never
B's), and a mutating tool call's logged proposal row belongs to the session user, never the
injected one. A final case asserts an unknown tool name is rejected rather than dispatched.

## reorder-math.test.ts

Proves velocity, days of cover, reorder point and suggested quantity match hand-computed
values — both as a pure calculation (`calculateReorderAdvice`) against a fixed input, and
end-to-end (`getReorderAdvice`) against a real sales fixture with two products: one with a
sales history and a linked supplier, one dead-stock product with neither, to exercise the
null-days-of-cover branch and the no-supplier lead-time fallback.

## ai-approval.test.ts

Proves the atomic-claim `UPDATE` in the approve route is a real IDOR and single-use
boundary, not just a status check. User B approving user A's proposal returns
`NOT_FOUND` and changes nothing — not the product, not the ledger, and not even the
invocation row itself (the route's opportunistic cleanup UPDATE has no `userId`
predicate of its own; it is safe only because the SELECT that locates a stale row is
scoped to the caller, and this is the test that would catch that scoping being dropped).
A second approval of an already-approved id also returns `NOT_FOUND` and does not execute
the tool a second time. An expired proposal cannot be approved either, though its own row
is allowed to flip to `'expired'` as a side effect of the route's cleanup — what must not
move is the product and the ledger. The route reads its session via `next/headers`
`cookies()`, which only works inside a live Next.js request, so the test mocks that one
module to a controllable cookie jar backed by real session rows from `createSession`,
leaving the route itself — including the atomic UPDATE — running unmodified against a
real database.
