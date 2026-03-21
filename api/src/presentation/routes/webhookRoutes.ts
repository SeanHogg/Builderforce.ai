/**
 * POST /api/webhooks/payment
 *
 * Receives raw webhook payloads from the active payment provider.
 * This route MUST NOT parse the body — signature verification requires the raw bytes.
 * Mounted BEFORE the JSON body-parser middleware in index.ts.
 */

import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import type { TenantService } from '../../application/tenant/TenantService';
import type { PaymentProvider } from '../../infrastructure/payment/PaymentProvider';

export function createWebhookRoutes(
  tenantService: TenantService,
  paymentProvider: PaymentProvider,
): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  /**
   * POST /payment
   * Provider posts here after checkout completion, renewal, cancellation, etc.
   * Returns 200 quickly — processing happens synchronously but is idempotent.
   */
  router.post('/payment', async (c) => {
    // Read raw body before any JSON parsing
    const rawBody = await c.req.text();
    const signatureHeader =
      c.req.header('Stripe-Signature') ??     // Stripe
      c.req.header('X-Helcim-Signature') ??   // Helcim
      c.req.header('X-Signature') ??           // generic fallback
      '';

    let event;
    try {
      event = await paymentProvider.parseWebhook(rawBody, signatureHeader);
    } catch (err) {
      console.error('[webhook] signature verification failed:', err);
      return c.json({ error: 'Invalid signature' }, 401);
    }

    if (!event) {
      // Provider returned null — unhandled event type, acknowledge without processing
      return c.json({ received: true, processed: false });
    }

    try {
      await tenantService.handleWebhookEvent(event);
    } catch (err) {
      console.error('[webhook] handleWebhookEvent failed:', err);
      // Return 500 so the provider retries
      return c.json({ error: 'Processing failed' }, 500);
    }

    return c.json({ received: true, processed: true });
  });

  return router;
}
