/**
 * The ONE place the canvas decides what a "web page on the board" is: which
 * object kinds carry a live page, which field on an object holds its address,
 * and what counts as an address worth loading at all.
 *
 * Several objects already pointed at a URL through differently-named fields
 * (`url` on a Browser preview, `siteUrl`/`pathUrl` on a published Website, and
 * `previewUrl` on a Builder), each resolved at its own call site. Resolution
 * lives here so the panel, the tile link and the inspector can never disagree
 * about which address an object is showing.
 */

import type { CreationObjectKind } from '@builderforce/creation-canvas-contract';
import type { CreationNodeData } from '@/components/creation-canvas/types';

/** Objects whose BODY is a live web page rather than a description of one. */
export const WEB_PAGE_KINDS: ReadonlySet<CreationObjectKind> = new Set(['browser', 'url', 'service']);

export function isWebPageKind(kind: CreationObjectKind): boolean {
  return WEB_PAGE_KINDS.has(kind);
}

/**
 * Coerce anything a user might type or drop into a loadable http(s) address, or
 * null when it is not one.
 *
 * A bare host (`example.com`) is the overwhelmingly common paste, so it gains an
 * `https://` rather than being refused. Every other scheme — `javascript:`,
 * `data:`, `file:`, `blob:` — is refused outright: those are the schemes that
 * turn "load a page" into script execution or local-file disclosure inside the
 * board's own document.
 */
export function normalizeWebPageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (!parsed.hostname) return null;
  return parsed.toString();
}

/**
 * The address an object is showing, in the order the object itself means them:
 * a published site outranks a working draft URL, which outranks a preview.
 * Mirrors what the Builder tile has always shown, so nothing moves under it.
 */
export function canvasWebPageUrl(data: CreationNodeData): string | null {
  for (const candidate of [data.siteUrl, data.url, data.previewUrl, data.pathUrl]) {
    const normalized = normalizeWebPageUrl(candidate);
    if (normalized) return normalized;
  }
  return null;
}

/**
 * A loopback / private-network address — a `service` object pointing at a dev
 * server is the everyday case.
 *
 * It matters twice: the gateway can never reach it (so probing it is a wasted,
 * metered request that always fails), and the user's own browser can, so the
 * frame is rendered directly instead.
 */
export function isLocalWebPageUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return host === 'localhost' || host === '::1' || host.endsWith('.local') || host.endsWith('.localhost')
    || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

/**
 * A page served over `http:` cannot be framed by a page served over `https:` —
 * browsers block the mixed content outright and give the embedder no event. The
 * panel has to say so rather than render a frame that will never paint.
 *
 * `pageProtocol` is passed in rather than read from `location` so this stays a
 * pure function (and so the VS Code webview, which is not `https:`, is correct).
 */
export function isMixedContentFrame(url: string, pageProtocol: string): boolean {
  return pageProtocol === 'https:' && url.startsWith('http://');
}

/** Host shown in the panel's address bar chrome (`www.` is noise at this size). */
export function webPageHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Fields the panel writes back after probing an address. Kept together because
 * they are only ever meaningful as a set — a `frameable` verdict without the
 * URL it was measured against would be re-applied to the next address typed.
 */
export interface WebPageProbe {
  frameCheckedUrl: string;
  frameable: boolean;
  frameBlockedBy: string | null;
  pageTitle: string | null;
  content: string;
  fetchedAt: string;
}

/** True when `data` already holds a probe for exactly this address. */
export function hasWebPageProbe(data: CreationNodeData, url: string): boolean {
  return data.frameCheckedUrl === url;
}
