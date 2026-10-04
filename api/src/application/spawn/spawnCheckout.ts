/**
 * Read a returned Spawn checkout back from the processor — the ONE verification
 * both of Spawn's purchases (a membership, a token pack) go through before
 * anything is granted. It is the shared five-check primitive with Spawn's
 * refusal codes attached, so the website can say which check failed in the
 * player's language.
 */
import type { Env } from '../../env';
import { verifyPaidCheckout, type VerifiedCheckout } from '../finance/verifiedCheckout';
import { SpawnError, type SpawnErrorCode } from './spawnErrors';

const MESSAGES = {
  notConfigured: 'Payments are not configured',
  notFound: 'That payment could not be found',
  notPaid: 'That payment has not completed',
  wrongKind: 'That payment was not for Spawn',
  notYours: 'That payment belongs to a different account',
} as const;

const CODE_OF: Record<string, SpawnErrorCode> = {
  [MESSAGES.notConfigured]: 'payments_unavailable',
  [MESSAGES.notFound]: 'payment_not_found',
  [MESSAGES.notPaid]: 'payment_not_paid',
  [MESSAGES.wrongKind]: 'payment_wrong_kind',
  [MESSAGES.notYours]: 'payment_not_yours',
};

export function verifySpawnCheckout(
  env: Env,
  input: { checkoutSessionId: string; purchaseKind: string; tenantId: number },
): Promise<VerifiedCheckout> {
  return verifyPaidCheckout(env, {
    checkoutSessionId: input.checkoutSessionId,
    purchaseKind: input.purchaseKind,
    // The check that stops one account's paid session crediting another's wallet.
    owner: { tenantId: input.tenantId },
    messages: MESSAGES,
    refuse: (message, status) => new SpawnError(message, status, CODE_OF[message] ?? 'payment_not_found'),
  });
}
