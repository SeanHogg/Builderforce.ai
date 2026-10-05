/**
 * The grown-up's link — how a parent pays for a player's Spawn without the player's
 * password. Every trial email carries it; it opens `/spawn/parent?t=…`, which can
 * show that one workspace's Spawn status and open ITS checkouts, and nothing else.
 *
 * Signed with the shared state primitive (`oauthState`), the same scheme the email
 * unsubscribe token uses — one signing key, one place to audit. The purpose check
 * stops a token minted for another flow being replayed here. It names the workspace
 * and the player; it grants no session, so it can only ever lead to a payment that
 * the processor collects and the existing verified-checkout path settles.
 */
import { signState, verifyState } from '../../infrastructure/auth/oauthState';
import { SpawnError } from './spawnErrors';

const PURPOSE = 'spawn_parent';

/** Long enough to outlive the trial and a parent who acts a few weeks later. */
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

export interface SpawnParentGrant {
  tenantId: number;
  userId: string;
}

export function signSpawnParentToken(secret: string, grant: SpawnParentGrant): Promise<string> {
  return signState(secret, { purpose: PURPOSE, tenantId: grant.tenantId, userId: grant.userId });
}

export async function readSpawnParentToken(secret: string, token: string): Promise<SpawnParentGrant> {
  const payload = await verifyState<{ purpose?: string; tenantId?: number; userId?: string }>(secret, token, MAX_AGE_MS);
  if (!payload || payload.purpose !== PURPOSE || typeof payload.tenantId !== 'number' || typeof payload.userId !== 'string') {
    throw new SpawnError('That link has expired or is not valid', 403, 'parent_link_invalid');
  }
  return { tenantId: payload.tenantId, userId: payload.userId };
}

export async function spawnParentUrl(secret: string, appUrl: string, grant: SpawnParentGrant): Promise<string> {
  return `${appUrl}/spawn/parent?t=${encodeURIComponent(await signSpawnParentToken(secret, grant))}`;
}
