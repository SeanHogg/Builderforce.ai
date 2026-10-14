/**
 * Privacy in the browser (PRD 33 §1.7, D9, D10) — the ONLY place masking is decided.
 *
 * - Every input value is masked: `maskAllInputs: true` is hard-coded and no
 *   site setting can turn it off.
 * - Password fields and payment-card fields (`autocomplete^="cc-"`) are never
 *   captured at all, not even as a masked length.
 * - `[data-bf-mask]` masks text (every text node when the site sets
 *   `maskAllText`); `[data-bf-block]` replaces a region with a placeholder.
 * - Canvas frames only when the site enables `recordCanvas` (2 fps, JPEG 0.4).
 */

import type { ReplayClientConfig } from '@builderforce/interaction-contract';

export const MASK_SELECTOR = '[data-bf-mask]';
export const BLOCK_SELECTOR = '[data-bf-block]';

const NEVER_CAPTURED = 'input[type="password" i], [autocomplete^="cc-" i]';

/** Password and payment-card fields: their value is never recorded. */
export function isNeverCaptured(el: Element | null | undefined): boolean {
  if (!el || typeof el.matches !== 'function') return false;
  try {
    return el.matches(NEVER_CAPTURED);
  } catch {
    return (el.getAttribute('type') ?? '').toLowerCase() === 'password';
  }
}

/** rrweb `maskInputFn`: nothing for never-captured fields, a same-length mask otherwise. */
export function maskInputFn(text: string, el: HTMLElement): string {
  if (isNeverCaptured(el)) return '';
  return '*'.repeat(text ? text.length : 0);
}

/** Whether an element's text must not leave the page (labels, selectors). */
export function isMaskedText(el: Element, maskAllText: boolean): boolean {
  if (maskAllText) return true;
  try {
    return el.closest(`${MASK_SELECTOR},${BLOCK_SELECTOR}`) !== null;
  } catch {
    return true;
  }
}

/** The rrweb options that carry privacy and sampling. `maskAllInputs` is always true. */
export function rrwebPrivacyOptions(config: Pick<ReplayClientConfig, 'maskAllText' | 'recordCanvas'>) {
  const canvas = config.recordCanvas === true;
  return {
    maskTextSelector: config.maskAllText ? '*' : MASK_SELECTOR,
    blockSelector: BLOCK_SELECTOR,
    maskInputFn,
    sampling: canvas
      ? { mousemove: 50, scroll: 150, input: 'last' as const, canvas: 2 }
      : { mousemove: 50, scroll: 150, input: 'last' as const },
    recordCanvas: canvas,
    ...(canvas ? { dataURLOptions: { type: 'image/jpeg', quality: 0.4 } } : {}),
    // Last, so nothing above (or any future spread) can turn it off.
    maskAllInputs: true as const,
  };
}

/**
 * A link target safe to keep on a click mark: `mailto:` / `tel:` without the
 * address, a same-site link as its path, another site as host + path. Never
 * a query string or fragment.
 */
export function sanitizeHref(raw: string | null | undefined, base: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
  if (scheme) {
    const name = scheme[1]!.toLowerCase();
    if (name === 'mailto' || name === 'tel' || name === 'sms') return `${name}:`;
    if (name !== 'http' && name !== 'https') return undefined;
  }
  try {
    const url = new URL(trimmed, base);
    const own = new URL(base).host;
    const out = url.host === own ? url.pathname : `${url.host}${url.pathname}`;
    return out.slice(0, 200);
  } catch {
    return undefined;
  }
}
