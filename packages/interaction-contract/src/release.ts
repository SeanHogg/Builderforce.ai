/**
 * Release fingerprint (PRD 33 §3.1, step 4) — the release key of a page that
 * names none: the first 12 hex of SHA-256 over the sorted asset URLs whose
 * path carries a build hash.
 *
 * "Carries a build hash" means a `[.-][0-9a-f]{6,}[.-]` segment
 * (`app.3f9a1c2b.js`, `chunk-8d7e6f.css`), which is how webpack, vite and most
 * CDNs fingerprint a build. Unhashed URLs (a favicon, an unversioned
 * stylesheet) are ignored so swapping one does not mint a release.
 *
 * WebCrypto (`crypto.subtle`) is global in Workers, Node 18+ and the browser.
 */

const BUILD_HASH = /[.-][0-9a-f]{6,}[.-]/i;

function pathOf(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/** Null when no URL carries a build hash. */
export async function releaseKeyFromAssets(urls: readonly string[]): Promise<string | null> {
  const hashed = urls.filter((url) => BUILD_HASH.test(pathOf(url))).slice().sort();
  if (hashed.length === 0) return null;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hashed.join('\n'))));
  let hex = '';
  for (let i = 0; i < 6; i++) hex += digest[i]!.toString(16).padStart(2, '0');
  return hex;
}
