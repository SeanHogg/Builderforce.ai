/**
 * The signed-in user's id (the tenant token's subject), re-derived whenever the host re-issues the token
 * (refresh / re-auth / workspace switch) so a chat never judges "mine vs a teammate's" against a stale identity.
 */
import { useSyncExternalStore } from 'react';
import { decodeTokenClaims } from '@/lib/tokenClaims';
import { getToken, onTokenChange } from '../vscodeBridge';

const viewerId = (): string | null => decodeTokenClaims(getToken()).sub ?? null;

export function useViewerId(): string | null {
  return useSyncExternalStore(onTokenChange, viewerId, viewerId);
}
