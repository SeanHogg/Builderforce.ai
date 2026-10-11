/**
 * Input masking — fail closed. Everything is masked unless explicitly unmasked.
 *
 * Default mask: password/email/tel, autocomplete credit-card / SSN fields,
 * `input`/`textarea`, and `[data-bf-mask]`. `[data-bf-unmask]` and selectors
 * passed to `unmask()` opt out.
 */

const DEFAULT_MASK_SELECTOR =
  'input, textarea, [data-bf-mask], [autocomplete*="cc-"], [autocomplete="cc-number"], [autocomplete="cc-csc"], [name*="ssn" i], [name*="social" i]';

const UNMASK_ATTR = '[data-bf-unmask]';

const extraUnmask: string[] = [];

export function unmask(selector: string): void {
  if (selector && !extraUnmask.includes(selector)) extraUnmask.push(selector);
}

export function resetUnmaskForTests(): void {
  extraUnmask.length = 0;
}

export function defaultMaskSelector(): string {
  return DEFAULT_MASK_SELECTOR;
}

export function isUnmasked(el: Element): boolean {
  if (el.closest(UNMASK_ATTR)) return true;
  for (const sel of extraUnmask) {
    try {
      if (el.matches(sel) || el.closest(sel)) return true;
    } catch {
      /* invalid selector — ignore */
    }
  }
  return false;
}

export function shouldMask(el: Element): boolean {
  if (isUnmasked(el)) return false;
  try {
    if (el.matches(DEFAULT_MASK_SELECTOR) || el.closest(DEFAULT_MASK_SELECTOR)) return true;
  } catch {
    return true;
  }
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  if (type === 'password' || type === 'email' || type === 'tel') return true;
  return false;
}

/** rrweb `maskInputFn`: replace with bullets unless the field is unmasked. */
export function maskInputFn(text: string, el: { type?: string } | Element): string {
  if (el && typeof (el as Element).matches === 'function' && isUnmasked(el as Element)) {
    return text;
  }
  return text ? '•'.repeat(Math.min(text.length, 24)) : text;
}
