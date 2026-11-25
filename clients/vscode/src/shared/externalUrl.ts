/**
 * Decide whether a URL a canvas webview asks the editor to open is safe to hand to the
 * OS browser. The webview is untrusted-ish content (it renders model/user output), so
 * `openExternal` must not accept an arbitrary address.
 *
 * Allowed: a route on the configured web app, or an absolute https address on an
 * explicit hosted-checkout origin. Everything else resolves to null.
 */

/** Hosted-checkout origins the API hands back (Stripe Checkout). */
export const HOSTED_CHECKOUT_ORIGINS: readonly string[] = ["https://checkout.stripe.com"];

export function resolveExternalTarget(
  target: string,
  webBase: string,
  checkoutOrigins: readonly string[] = HOSTED_CHECKOUT_ORIGINS,
): string | null {
  let base: URL;
  try {
    base = new URL(webBase);
  } catch {
    return null;
  }
  if (/^https:\/\//i.test(target)) {
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      return null;
    }
    if (url.username || url.password) return null;
    return url.origin === base.origin || checkoutOrigins.includes(url.origin) ? url.toString() : null;
  }
  // A route: one leading slash, never protocol-relative ("//evil.com") and never a
  // userinfo trick ("@evil.com") or a backslash that browsers fold into a slash.
  if (!target.startsWith("/") || target.startsWith("//") || target.includes("\\")) return null;
  let url: URL;
  try {
    url = new URL(target, base);
  } catch {
    return null;
  }
  return url.origin === base.origin ? url.toString() : null;
}
