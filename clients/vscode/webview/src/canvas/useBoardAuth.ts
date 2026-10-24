/**
 * May the board mount yet? The ONE answer both board screens (the chat panel's
 * `WorkspaceScreen` and the split's `VisualizationScreen`) read.
 *
 * The canvas's API client is the web app's (`@/lib/apiClient`), which reads the
 * tenant token synchronously at call time from `setEmbedAuth()`. So this hook owns
 * the bridge: it hands the host-minted token to that override before first paint and
 * again on every re-mint.
 *
 * A board persisted on the server (`durable`) fires presence, ceremonies and its
 * session reads on mount — without a token every one of them is a 401 ("Missing or
 * malformed Authorization header"). It waits for the token, and asks for one itself:
 * the root only mints for its own sign-in gate, which a pinned on-device model skips
 * (that model frees the CHAT from needing an account; it does not free the board).
 * A local board (`durable === false`) never calls the gateway and mounts at once.
 */
import { useCallback, useEffect, useState } from 'react';
import { setEmbedAuth } from '@/lib/auth';
import { getToken, onTokenChange, refreshToken, type InitData } from '../vscodeBridge';

/** `none`: no session, so no board. Otherwise why a server board is not drawn yet. */
export type BoardAuthState = 'ready' | 'none' | 'connecting' | 'failed' | 'signedOut';

export interface BoardAuth {
  state: BoardAuthState;
  retry: () => Promise<void>;
}

export function useBoardAuth(session: InitData['session'], signedIn: boolean): BoardAuth {
  // Before first paint: the canvas fires its first fetch on mount.
  const [tokenReady, setTokenReady] = useState(() => {
    setEmbedAuth(getToken());
    return getToken() != null;
  });
  const [failed, setFailed] = useState(false);

  useEffect(() => onTokenChange(() => {
    setEmbedAuth(getToken());
    setTokenReady(getToken() != null);
  }), []);

  const needsToken = !!session && session.durable !== false;

  // A mint that comes back empty is a gateway we cannot reach — say so, never spin.
  const retry = useCallback(async () => {
    setFailed(false);
    await refreshToken();
    if (!getToken()) setFailed(true);
  }, []);

  useEffect(() => {
    if (needsToken && signedIn && !getToken()) void retry();
  }, [needsToken, signedIn, retry]);

  const state: BoardAuthState = !session
    ? 'none'
    : !needsToken || tokenReady
      ? 'ready'
      : !signedIn
        ? 'signedOut'
        : failed
          ? 'failed'
          : 'connecting';
  return { state, retry };
}
