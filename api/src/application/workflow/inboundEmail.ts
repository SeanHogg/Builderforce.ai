/**
 * Inbound-email trigger handler — fires a workflow when an email arrives at its
 * addressed inbox. The inbox local-part IS the trigger token, so an address like
 *   wf+<token>@inbound.builderforce.ai
 * routes to the trigger whose `token` matches `<token>`.
 *
 * Invoked from the Worker `email()` handler (Cloudflare Email Routing). The
 * Email Routing binding must be provisioned in the dashboard + wrangler for the
 * `email()` handler to receive messages — see the Gap Register for the deploy
 * step. This module is transport-agnostic: it takes the already-parsed envelope
 * so it is unit-testable without the binding.
 */

import { eq } from 'drizzle-orm';
import { buildDatabase } from '../../infrastructure/database/connection';
import { workflowTriggers } from '../../infrastructure/database/schema';
import { fireAddressedTrigger } from '../../presentation/routes/workflowTriggerRoutes';

export interface InboundEmailEnv {
  NEON_DATABASE_URL: string;
}

export interface InboundEmailMessage {
  to: string;
  from: string;
  subject?: string;
  text?: string;
  raw?: string;
}

/**
 * Extract the trigger token from a recipient address. Supports both the
 * plus-tagged form (`anything+<token>@domain`) and a bare local-part
 * (`<token>@domain`). Returns null when no token-shaped local-part is present.
 */
export function tokenFromAddress(address: string): string | null {
  const at = address.indexOf('@');
  if (at <= 0) return null;
  const local = address.slice(0, at).trim().toLowerCase();
  const plus = local.lastIndexOf('+');
  const candidate = plus !== -1 ? local.slice(plus + 1) : local;
  return /^[0-9a-f]{32}$/.test(candidate) ? candidate : null;
}

/**
 * Handle one inbound email: resolve its trigger by the recipient token and fire
 * the workflow with the message as payload. Returns the outcome for logging.
 */
export async function handleInboundEmail(
  env: InboundEmailEnv,
  message: InboundEmailMessage,
): Promise<{ ok: true; workflowId: string } | { ok: false; error: string }> {
  const token = tokenFromAddress(message.to);
  if (!token) return { ok: false, error: 'no trigger token in recipient address' };

  const db = buildDatabase(env as unknown as Parameters<typeof buildDatabase>[0]);
  const [row] = await db.select().from(workflowTriggers).where(eq(workflowTriggers.token, token));
  if (!row || !row.enabled || row.triggerType !== 'inbound-email') {
    return { ok: false, error: 'unknown or disabled inbound-email trigger' };
  }

  const payload = {
    from: message.from,
    to: message.to,
    subject: message.subject ?? '',
    text: message.text ?? '',
  };
  return fireAddressedTrigger(db, row, payload, `inbound-email:${row.nodeId}`);
}
