# Tests

Four tests are specified, one per claim. Two exist; the other two belong to phases that
have not been built yet.

All of them run against a real Postgres, not a mock. The properties under test are
row-level locking and tenant scoping — a mocked database would report whatever the mock
was told to report and prove neither. `tests/setup.ts` loads `.env` and fails loudly if
`DATABASE_URL` is missing.

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

## ai-authorization.test.ts — not yet written

Belongs to Phase 5. Will assert that a `userId` injected into tool arguments by the model
is stripped before validation and that the query resolves against the session user only.

## reorder-math.test.ts — not yet written

Belongs to Phase 4. Will assert velocity, days of cover and suggested quantity against
hand-computed values from a fixed sales fixture.
