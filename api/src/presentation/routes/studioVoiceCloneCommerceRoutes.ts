/**
 * Voice-clone marketplace commerce routes (`/api/studio/voice-clones/marketplace/:id/*`):
 * acquire a marketplace voice (free → licensed at once; priced → the platform's one
 * hosted checkout) and complete that checkout. Registered onto the voice-clone
 * router by `createStudioVoiceCloneRoutes`, behind its auth middleware.
 */

import type { Hono } from 'hono';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  acquireFreeVoiceLicense,
  VoiceCloneLicensePaymentRequired,
} from '../../application/studio/voiceLicenseService';
import { completeVoiceCheckout, startVoiceCheckout } from '../../application/studio/voiceCommerce';
import { invalidateUsableClones } from '../../application/studio/voiceCloneCatalog';
import { ListingError } from '../../application/marketplace/creationListings';
import { parseBody, parseOptionalBody, z, zNonEmptyString } from './requestBody';
import { mapVoiceCloneError } from './studioVoiceCloneErrors';

const VoiceCheckoutStartBody = z.object({ returnUrl: z.string().optional(), buyerEmail: z.string().optional() });
const VoiceCheckoutCompleteBody = z.object({ checkoutSessionId: zNonEmptyString });

export function registerVoiceCloneCommerceRoutes(router: Hono<HonoEnv>, db: Db): void {
  // ── Acquire a marketplace voice ──────────────────────────────────────────
  // FREE → licensed at once. PRICED → the platform's one hosted checkout
  // (`startVoiceCheckout`); the license is granted by `/checkout/complete` or the
  // webhook (purchaseRegistry), each after re-reading the session from the processor.
  router.post('/marketplace/:id/license', async (c) => {
    const cloneId = Number(c.req.param('id'));
    if (!Number.isInteger(cloneId)) return c.json({ error: 'invalid clone id' }, 400);
    const tenantId = c.get('tenantId');
    const userId = c.get('userId') ?? null;
    try {
      const out = await acquireFreeVoiceLicense(db, { cloneId, tenantId, userId });
      // A revoked license stays revoked: 409, and nothing changed so the cache is left alone.
      if ('applied' in out) return c.json({ reason: out.reason }, 409);
      // The caller's cached list merges in licensed clones — refresh it.
      await invalidateUsableClones(c.env as Env, tenantId);
      return c.json(out, 201);
    } catch (err) {
      if (err instanceof VoiceCloneLicensePaymentRequired) {
        if (!userId) return c.json({ error: 'Sign in to buy this voice' }, 401);
        const body = await parseOptionalBody(c, VoiceCheckoutStartBody);
        const { checkoutUrl } = await startVoiceCheckout(db, c.env as Env, {
          tenantId,
          buyerUserId: userId,
          buyerEmail: body.buyerEmail ?? null,
          cloneId,
          ...(body.returnUrl ? { returnUrl: body.returnUrl } : {}),
        });
        return c.json({ checkoutUrl }, 200);
      }
      if (err instanceof ListingError) throw err;
      return mapVoiceCloneError(c, err);
    }
  });

  // The processor's redirect lands here; the session is re-read FROM the processor.
  router.post('/marketplace/:id/checkout/complete', async (c) => {
    const tenantId = c.get('tenantId');
    const body = await parseBody(c, VoiceCheckoutCompleteBody);
    const purchase = await completeVoiceCheckout(db, c.env as Env, {
      tenantId,
      buyerUserId: c.get('userId') as string,
      checkoutSessionId: body.checkoutSessionId,
    });
    // A revoked license (refunded / disputed) is never reported as purchased.
    if (!purchase.applied) return c.json({ purchased: false, reason: purchase.reason }, 409);
    return c.json({ purchased: true, purchase });
  });
}
