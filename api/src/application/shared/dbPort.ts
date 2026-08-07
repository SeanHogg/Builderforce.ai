/**
 * The database handle, re-exported as an application-layer type.
 *
 * A route factory has to name the type of the `db` it is handed, but the
 * layering guard (`scripts/check-layering.mjs`) forbids `src/presentation/`
 * importing from `src/infrastructure/` — and it does not exempt type-only
 * imports, correctly: a presentation module that knows Drizzle's concrete type
 * is one refactor away from writing a query. Routes import `Db` from here
 * instead, so the presentation layer depends on the application layer's
 * vocabulary and the driver stays behind it.
 */
export type { Db } from '../../infrastructure/database/connection';
