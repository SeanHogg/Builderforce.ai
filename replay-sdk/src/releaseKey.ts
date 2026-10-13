/**
 * The page's release key (PRD 33 §3.1). First match wins:
 * 1. `data-release` on the loader tag (hosted apps and builderforce.ai write
 *    their version token / app version there), then `window.BF_RELEASE`;
 * 2. the asset fingerprint (`releaseKeyFromAssets`) over the page's
 *    `script[src]` and `link[rel=stylesheet][href]` URLs;
 * 3. '' — unknown.
 */

import { REPLAY_STRING_LIMITS, releaseKeyFromAssets } from '@builderforce/interaction-contract';

export function explicitRelease(dataRelease?: string): string {
  const fromWindow = typeof window.BF_RELEASE === 'string' ? window.BF_RELEASE : '';
  return (dataRelease || fromWindow || '').trim().slice(0, REPLAY_STRING_LIMITS.release);
}

export function pageAssetUrls(doc: Document = document): string[] {
  const urls: string[] = [];
  doc.querySelectorAll<HTMLScriptElement>('script[src]').forEach((s) => urls.push(s.src));
  doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]').forEach((l) => urls.push(l.href));
  return urls;
}

export async function resolveRelease(dataRelease?: string): Promise<string> {
  const explicit = explicitRelease(dataRelease);
  if (explicit) return explicit;
  try {
    return (await releaseKeyFromAssets(pageAssetUrls())) ?? '';
  } catch {
    return '';
  }
}
