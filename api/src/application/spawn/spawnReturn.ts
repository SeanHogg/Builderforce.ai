/**
 * Where a Spawn checkout comes back to — the ONE place both purchases (membership,
 * token pack) build their return URL. The player's own account page by default; the
 * parent page when a grown-up pays from an emailed link (`spawnParent.ts`), carrying
 * that link's token so the page can settle the payment without anyone signing in.
 *
 * The result ends in `?` or `&`, ready for the purchase's own `joined=` / `tokens=`.
 */
export type SpawnReturn = { kind: 'account' } | { kind: 'parent'; token: string };

export function spawnReturnUrl(appUrl: string, returnTo: SpawnReturn = { kind: 'account' }): string {
  return returnTo.kind === 'parent'
    ? `${appUrl}/spawn/parent?t=${encodeURIComponent(returnTo.token)}&`
    : `${appUrl}/spawn/account?`;
}
