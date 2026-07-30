/**
 * The database handle as the PRESENTATION layer is allowed to know it.
 *
 * Route modules are constructed with a `Db` and pass it to application services; they
 * must never query with it (`npm run check:layering`). Today 104 of 147 route files
 * import `infrastructure/database/schema` and issue SQL inline — that is frozen debt,
 * and the guard exists so it can only shrink.
 *
 * But the guard matches ANY import from `src/infrastructure/`, including the
 * type-only `import type { Db } from '../../infrastructure/database/connection'` that a
 * well-behaved route still needs in its factory signature. Without this re-export a
 * NEW, correctly-layered route could not be written at all — the ratchet would be a
 * wall rather than a ratchet.
 *
 * So: the application layer owns the name the presentation layer depends on
 * (Dependency Inversion, in the small). It is deliberately a pure type re-export —
 * nothing is wrapped, so there is no runtime cost and no second abstraction to keep in
 * sync. New route modules should import `DbHandle` from here; the 104 legacy files
 * migrate to it as they are touched.
 */

export type { Db as DbHandle } from '../../infrastructure/database/connection';
