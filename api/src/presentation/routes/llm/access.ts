/**
 * Gateway auth as the LLM route modules see it. The resolution itself lives in the
 * application layer (`application/llm/gatewayAccess`); this module adds only the
 * HTTP mapping of a rejection. `presentation/routes/llmRoutes.ts` re-exports all of
 * it for the other route modules and middleware that authenticate the same way.
 */
import type { Context } from 'hono';
import type { HonoEnv } from '../../../env';
import { TenantAccessError } from '../../../application/llm/gatewayAccess';

export {
  requireTenantAccess,
  resolveBearerTenantId,
  TenantAccessError,
  type TenantAccess,
} from '../../../application/llm/gatewayAccess';

/** Convert any throwable from `requireTenantAccess` into a Hono JSON response. */
export function respondToAccessError(c: Context<HonoEnv>, err: unknown) {
  if (err instanceof TenantAccessError) {
    return c.json({ error: err.message, code: err.code }, err.status);
  }
  return c.json({ error: (err as Error).message || 'Unauthorized' }, 401);
}
