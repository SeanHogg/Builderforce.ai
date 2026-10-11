/**
 * Release fingerprint — SHA-256 of the sorted hashed asset URLs on the page,
 * truncated to 12 hex chars.
 *
 * "Hashed" means the URL's pathname contains an 8+ hex run, which is how
 * webpack / vite / most CDNs fingerprint a build. Unhashed URLs (a favicon,
 * an unversioned CSS file) are dropped so a one-off asset swap does not
 * mint a new release.
 *
 * WebCrypto (`crypto.subtle`) is on the global in Workers, Node 18+ and
 * the browser, so there is no platform branch here.
 */

const HASH_LIKE = /[a-f0-9]{8,}/i;

function pathnameOf(url: string): string {
  try {
    return new URL(url, 'https://example.invalid').pathname;
  } catch {
    return url;
  }
}

/** URLs whose pathname contains a hash-like segment, sorted for stability. */
export function hashedAssetUrls(urls: readonly string[]): string[] {
  return urls.filter((url) => HASH_LIKE.test(pathnameOf(url))).slice().sort();
}

/** 12-char hex SHA-256 of the sorted hashed asset URLs, joined by newline. */
export async function releaseKeyFromAssets(urls: readonly string[]): Promise<string> {
  const hashed = hashedAssetUrls(urls);
  const payload = hashed.join('\n');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload)));
  let hex = '';
  for (let i = 0; i < digest.length; i++) hex += digest[i]!.toString(16).padStart(2, '0');
  return hex.slice(0, 12);
}
