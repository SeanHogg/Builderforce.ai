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

import type { Env } from '../../env';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';

export type { Db as DbHandle } from '../../infrastructure/database/connection';

/**
 * The request's ONE database handle.
 *
 * `authMiddleware` builds a `Db` per authenticated request and publishes it as
 * `c.get('db')` so later middleware (`requirePermission`) reuses it. Route
 * handlers did not: 300-odd of them called `buildDatabase(c.env)` themselves, a
 * second client per request on every authenticated path. This is the seam every
 * handler reads through instead — the published handle when one exists, else a
 * client built once here and published for whatever runs after it (a public
 * route's later middleware, a handler that calls a second helper).
 *
 * It lives HERE, beside `DbHandle`, for the reason that type does: the
 * presentation layer depends on the application layer's name for the handle,
 * never on `infrastructure/database/connection` itself. Typed structurally rather
 * than on Hono's `Context` so every route factory's context
 * (`Context<HonoEnv, Path>` for any `Path`) satisfies it without a cast.
 */
export interface RequestDbContext {
  env: Env;
  get(key: 'db'): Db | undefined;
  set(key: 'db', value: Db): void;
}

export function requestDb(c: RequestDbContext): Db {
  const published = c.get('db');
  if (published) return published;
  const db = buildDatabase(c.env);
  c.set('db', db);
  return db;
}
