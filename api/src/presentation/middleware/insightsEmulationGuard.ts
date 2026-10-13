/**
 * Insights is never readable through superadmin emulation (PRD 33 D17: "no
 * superadmin data path").
 *
 * `emulationMiddleware` (mounted on `/api/*`) swaps the caller's workspace for the
 * emulated one and only blocks MUTATING verbs, so without this every Insights GET —
 * recordings, chunk bytes, exports, page captures — would hand an operator a
 * customer's visitors. Builderforce reads its own recordings as a member of its own
 * workspace, never by emulating someone else's.
 *
 * ONE refusal, called from every Insights door: `insightsGate` and `replayScopeOf`
 * (`routes/replayRouteScope.ts`), `replayReadKeyOrMember`, the sites router and the
 * project-site router. Defence in depth on purpose: a route that forgets the gate
 * still resolves its scope through `replayScopeOf`.
 */
import type { Context, MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import { ForbiddenError } from '../../domain/shared/errors';

export const INSIGHTS_EMULATION_REFUSAL = 'Insights data is not available during emulation';

/** Throws 403 when the request runs under an emulation token. */
export function refuseInsightsDuringEmulation(c: Context<HonoEnv>): void {
  if (c.get('isEmulation') === true) throw new ForbiddenError(INSIGHTS_EMULATION_REFUSAL);
}

/** The same refusal as a middleware, for routers that guard a whole path. */
export const insightsEmulationGuard: MiddlewareHandler<HonoEnv> = async (c, next) => {
  refuseInsightsDuringEmulation(c);
  await next();
};
