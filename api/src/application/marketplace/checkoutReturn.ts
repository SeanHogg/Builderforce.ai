/**
 * Where Stripe sends the buyer back to after a listing checkout.
 *
 * Historically only the ORIGIN and PATH of `returnUrl` survived (the query was dropped),
 * which is right for the listing page but loses state on a page whose position lives in
 * the query (a board panel, a template tab). `returnPath` lets the caller name the
 * relative path + query to come back to. It is validated as a same-origin RELATIVE
 * reference so it can never become an open redirect after payment.
 */

export class InvalidReturnPathError extends Error {
  constructor() {
    super('returnPath must be a relative path on this site');
    this.name = 'InvalidReturnPathError';
  }
}

/** `{ successUrl, cancelUrl }` for a checkout; `{CHECKOUT_SESSION_ID}` is Stripe's token. */
export function checkoutReturnUrls(returnUrl: string, returnPath?: string | null): { successUrl: string; cancelUrl: string } {
  const base = new URL(returnUrl);
  let pathname = base.pathname;
  let search = '';
  if (returnPath) {
    // Relative only: a single leading slash, no scheme-relative `//host`, no backslash
    // (browsers treat `\` as `/`), no control characters.
    if (!returnPath.startsWith('/') || returnPath.startsWith('//') || /[\\\u0000-\u001f]/.test(returnPath)) {
      throw new InvalidReturnPathError();
    }
    const resolved = new URL(returnPath, base.origin);
    if (resolved.origin !== base.origin) throw new InvalidReturnPathError();
    pathname = resolved.pathname;
    search = resolved.search;
    // The processor's own param is appended below; never carry a stale one forward.
    const params = new URLSearchParams(search);
    params.delete('checkout');
    const rest = params.toString();
    search = rest ? `?${rest}` : '';
  }
  const join = search ? '&' : '?';
  const stem = `${base.origin}${pathname}${search}`;
  return {
    successUrl: `${stem}${join}checkout={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${stem}${join}checkout=cancelled`,
  };
}

/**
 * The checkout return base: a caller-supplied `returnUrl` is honoured only when its ORIGIN
 * is the app's own (`appBaseUrl`); anything else (another host, a malformed URL) falls back
 * to the app base URL, so a buyer cannot be bounced to a foreign site after paying.
 */
export function sameOriginReturnUrl(candidate: string | null | undefined, appBaseUrl: string): string {
  if (!candidate) return appBaseUrl;
  try {
    return new URL(candidate).origin === new URL(appBaseUrl).origin ? candidate : appBaseUrl;
  } catch {
    return appBaseUrl;
  }
}
