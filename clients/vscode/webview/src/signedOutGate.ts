/**
 * What the workspace root does for each account state — kept pure so the rule is tested
 * rather than inferred from JSX.
 *
 * Offline-first contract: signing in is OPTIONAL. A signed-out user still gets the chat
 * surface (their own machine, their own provider keys, local files). The only things an
 * account adds are gateway-backed extras, and those degrade on their own.
 *
 *   - `connecting` / `connect-failed`: the host says we are signed in but the tenant JWT has
 *     not landed (or could not be minted). Transient — never a sign-in prompt.
 *   - `ready`: render the surface. Signed out with NO local route renders it too; the chat
 *     shows an inline, non-blocking banner (`needsRouteBanner`) instead of a wall.
 */
export type RootGate = 'ready' | 'connecting' | 'connect-failed';

export function rootGate(input: {
  signedIn: boolean;
  hasToken: boolean;
  localRoute: boolean;
  tokenFailed: boolean;
}): RootGate {
  if (!input.signedIn || input.localRoute) return 'ready';
  if (input.hasToken) return 'ready';
  return input.tokenFailed ? 'connect-failed' : 'connecting';
}

/**
 * Whether the chat should show the inline "Sign in / Connect a provider / use a local
 * model" banner: signed out and nothing on this machine is pinned as the route. It never
 * blocks the composer — a BYO key or an unpinned local-first model may still serve the
 * turn, and if nothing can, the failed turn's own banner says so.
 */
export function needsRouteBanner(input: { signedIn: boolean; localRoute: boolean; localModelCount: number }): boolean {
  return !input.signedIn && !input.localRoute && input.localModelCount === 0;
}
