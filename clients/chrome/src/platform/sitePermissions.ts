/**
 * The PER-SITE ALLOW LIST — and it is Chrome's own permission grant, not a list Rovr
 * keeps beside it. The manifest declares `https://*\/*` / `http://*\/*` as OPTIONAL host
 * permissions; a site is allowed exactly when the person has granted Rovr that origin,
 * and the page agent physically cannot be injected anywhere else. Allowing a site is
 * `chrome.permissions.request` (which must run inside the person's click — the confirm
 * card's Allow button), removing it is `chrome.permissions.remove`.
 */
import { LOOPBACK_ORIGINS, PLATFORM_ORIGINS } from '../config';

/** Origins granted by the manifest itself — infrastructure, not sites the person allowed. */
const BUILT_IN = new Set<string>([...PLATFORM_ORIGINS, ...LOOPBACK_ORIGINS]);

const patternFor = (origin: string): string => `${origin}/*`;

/** `https://example.com/*` → `https://example.com` (null for wildcards and non-http). */
export function originOfPattern(pattern: string): string | null {
  const m = /^(https?:\/\/[^/*]+)\/\*$/.exec(pattern);
  return m && !m[1]!.includes('*') ? m[1]! : null;
}

export interface SitePermissions {
  list(): Promise<string[]>;
  /** MUST be called from a user gesture. Resolves true when the person granted it. */
  request(origin: string): Promise<boolean>;
  remove(origin: string): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export function createSitePermissions(): SitePermissions {
  return {
    async list() {
      const granted = await chrome.permissions.getAll();
      return (granted.origins ?? [])
        .map(originOfPattern)
        .filter((o): o is string => !!o && !BUILT_IN.has(o))
        .sort();
    },
    request: (origin) => chrome.permissions.request({ origins: [patternFor(origin)] }),
    async remove(origin) {
      await chrome.permissions.remove({ origins: [patternFor(origin)] });
    },
    subscribe(listener) {
      chrome.permissions.onAdded.addListener(listener);
      chrome.permissions.onRemoved.addListener(listener);
      return () => {
        chrome.permissions.onAdded.removeListener(listener);
        chrome.permissions.onRemoved.removeListener(listener);
      };
    },
  };
}
