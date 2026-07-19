/**
 * ciOutcomeDeps — binds a Hono request context to the ports `handleCiEventOutcome`
 * needs (run dispatch + waitUntil). Lives here, not in the application layer, so
 * `application/ci` stays free of route imports. Shared by the GitHub, GitLab and
 * Bitbucket webhooks so the auto-fix wiring exists in exactly one place.
 */
import type { Context } from 'hono';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { CiOutcomeDeps } from '../../application/ci/handleCiEventOutcome';
import type { RuntimeService } from '../../application/runtime/RuntimeService';
import { dispatchCloudRunForTask } from './runtimeRoutes';

export function ciOutcomeDeps(c: Context<HonoEnv>, db: Db, runtimeService: RuntimeService): CiOutcomeDeps {
  const env = c.env as Env;
  const waitUntil = (p: Promise<unknown>): void => c.executionCtx.waitUntil(p);
  return {
    db,
    env,
    waitUntil,
    dispatchRun: (params) => dispatchCloudRunForTask(env, db, runtimeService, waitUntil, params),
  };
}
