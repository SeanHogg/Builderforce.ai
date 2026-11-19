/**
 * `__Host-` cookies for every builderforce.ai-domain origin we set state on.
 *
 * In-browser preview origins (`<key>-preview.builderforce.ai`) run untrusted code and
 * are SAME-SITE with `builderforce.ai` and every published site `<slug>.builderforce.ai`.
 * That code can `document.cookie = 'name=x; Domain=builderforce.ai'` and shadow or
 * fixate a host-only cookie of the same name on a sibling host. A `__Host-` cookie is
 * refused by the browser unless it is `Secure`, `Path=/` and has NO `Domain` — so a
 * tossed cookie can never carry the prefixed name, and readers that trust only the
 * prefixed name cannot be shadowed.
 *
 * Writers set ONLY {@link hostCookieName}. Readers use {@link readHostCookie}, which
 * prefers the prefixed name and falls back to the legacy un-prefixed name for one
 * release so sessions issued before the rename survive the deploy.
 */

/** The browser-enforced prefix: Secure, Path=/, no Domain. */
export const HOST_COOKIE_PREFIX = '__Host-';

/** The `__Host-` name for a base cookie name. */
export const hostCookieName = (base: string): string => `${HOST_COOKIE_PREFIX}${base}`;

/**
 * EVERY non-empty value a `Cookie` header carries under one name, in header order
 * (URI-decoded; a malformed escape is skipped). A browser sends one entry per matching
 * cookie — a sibling-planted `Domain=`/longer-`Path` cookie arrives beside the real one.
 */
export function readCookieValues(header: string | null | undefined, name: string): string[] {
  if (!header) return [];
  const values: string[] = [];
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      const value = decodeURIComponent(part.slice(eq + 1).trim());
      if (value) values.push(value);
    } catch {
      continue; // a malformed escape (URIError) is not a value: skip this entry, read the rest
    }
  }
  return values;
}

/** One cookie's value from a `Cookie` header: the first non-empty one, or null. */
export function readCookie(header: string | null | undefined, name: string): string | null {
  return readCookieValues(header, name)[0] ?? null;
}

/** Which name a `__Host-` cookie was read under. */
export interface HostCookieRead {
  value: string;
  /** Read under the legacy un-prefixed name (no `__Host-` cookie present). */
  legacy: boolean;
  /**
   * Legacy, and the ONLY legacy value carried — the condition for upgrade-on-read
   * ({@link hostCookieUpgrade}). Two legacy values mean one may be a sibling-planted
   * cookie, and promoting the wrong one to `__Host-` would make a fixation durable.
   */
  upgradable: boolean;
}

/** The `__Host-` cookie: the prefixed name first, else the legacy base name. Empty reads as absent. */
export function readHostCookieEntry(header: string | null | undefined, base: string): HostCookieRead | null {
  const prefixed = readCookie(header, hostCookieName(base));
  if (prefixed) return { value: prefixed, legacy: false, upgradable: false };
  // legacy name: drop after 2026-12-18
  const legacy = readCookieValues(header, base);
  return legacy.length > 0 ? { value: legacy[0]!, legacy: true, upgradable: legacy.length === 1 } : null;
}

/** The value of a `__Host-` cookie (prefixed name first, else the legacy name), or null. */
export function readHostCookie(header: string | null | undefined, base: string): string | null {
  return readHostCookieEntry(header, base)?.value ?? null;
}

/**
 * Every distinct value carried under the prefixed AND the legacy name, ALL occurrences of
 * each — for a revocation (sign-out) that must kill every one: a planted extra cookie
 * listed first must not hide the user's real one.
 */
export function readHostCookieValues(header: string | null | undefined, base: string): string[] {
  // legacy name: drop after 2026-12-18
  return [...new Set([...readCookieValues(header, hostCookieName(base)), ...readCookieValues(header, base)])];
}

/**
 * A `Set-Cookie` value under the `__Host-` name. `Secure; Path=/` and no `Domain` are
 * fixed here because the prefix requires them; callers pass only the extra attributes.
 */
export function hostSetCookie(base: string, value: string, attributes: string): string {
  return `${hostCookieName(base)}=${value}; Path=/; Secure${attributes ? `; ${attributes}` : ''}`;
}

/** The `Set-Cookie` that deletes the legacy un-prefixed (host-only, `Path=/`) cookie. */
export function legacyCookieExpiry(base: string, attributes: string): string {
  // legacy name: drop after 2026-12-18
  return `${base}=; Path=/; Secure${attributes ? `; ${attributes}` : ''}; Max-Age=0`;
}

/**
 * Upgrade on read — THE one place that decides it. For a request whose VALIDATED cookie
 * was read under the legacy name only (and unambiguously), the two `Set-Cookie` values
 * that re-issue it as `__Host-` and expire the legacy one; otherwise none. `attributes`
 * are the cookie's own extras (no `Max-Age`); `maxAgeSeconds` is the remaining lifetime,
 * omitted for a browser-session cookie. The caller validates the value first — never
 * promote a value nothing has checked.
 */
export function hostCookieUpgrade(
  read: HostCookieRead | null | undefined,
  base: string,
  attributes: string,
  maxAgeSeconds?: number,
): string[] {
  if (!read?.upgradable) return [];
  if (maxAgeSeconds !== undefined && maxAgeSeconds <= 0) return [];
  const setAttributes = [attributes, maxAgeSeconds === undefined ? '' : `Max-Age=${maxAgeSeconds}`].filter(Boolean).join('; ');
  return [hostSetCookie(base, encodeURIComponent(read.value), setAttributes), legacyCookieExpiry(base, attributes)];
}

/** A copy of `response` with extra `Set-Cookie` headers (the original's may be immutable). */
export function withSetCookies(response: Response, cookies: readonly string[]): Response {
  if (cookies.length === 0 || response.status === 101) return response;
  const headers = new Headers(response.headers);
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
