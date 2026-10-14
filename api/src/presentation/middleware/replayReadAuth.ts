/**
 * The Insights READ API's door (PRD 33 §2.1 "Data export API — documented read API
 * with `replay:read` keys", §8 S4c).
 *
 * Exactly three GETs accept a tenant API key carrying `replay:read`:
 * `GET /api/replay/overview`, `GET /api/replay/recordings` and
 * `GET /api/replay/funnels/:funnelId/evaluate`. Every other Insights route stays
 * member-only. A request whose bearer is a Builderforce key (`bf?_…`) is resolved
 * through the ONE key check (`requirePublicApiKey` → `resolveTenantApiKey` with the
 * required scope, then the key's origin binding); anything else is a session and
 * takes `authMiddleware` verbatim.
 *
 * A key acts for its workspace with no member identity: `tenantId` is set, `userId`
 * is not, and no role is granted — so nothing a write route checks can pass. A
 * `bfr_` site key carries only `replay:ingest` and is refused here like an unknown
 * key, with the same message (a caller learns nothing about which it was).
 *
 * The key's resolution is cached by key hash (`requirePublicApiKeyCached`), since
 * this door is what integrations poll. Under superadmin emulation the door is shut
 * whichever credential is presented (D17: no superadmin data path).
 */

import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import { requestDb } from '../../application/shared/dbHandle';
import { requirePublicApiKeyCached } from '../../application/publicApi/publicApiAuth';
import { authMiddleware } from './authMiddleware';
import { refuseInsightsDuringEmulation } from './insightsEmulationGuard';

/** A Builderforce API key (`bfk_…`, `bfr_…`), as opposed to a session JWT. */
const API_KEY_SHAPE = /^bf[a-z]_/;

export const replayReadKeyOrMember: MiddlewareHandler<HonoEnv> = async (c, next) => {
  refuseInsightsDuringEmulation(c);
  const header = c.req.header('Authorization');
  const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!API_KEY_SHAPE.test(bearer)) return authMiddleware(c, next);

  const auth = await requirePublicApiKeyCached(c.env, requestDb(c), header, c.req.header('Origin') ?? null, 'replay:read');
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);
  c.set('tenantId', auth.tenantId);
  await next();
};
