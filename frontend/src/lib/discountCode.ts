export const DISCOUNT_CODE_STORAGE_KEY = 'builderforce.discountCode';

export function normalizeDiscountCode(value: string): string {
  return value.trim().toUpperCase();
}

export function getRetainedDiscountCode(): string {
  if (typeof window === 'undefined') return '';
  try { return localStorage.getItem(DISCOUNT_CODE_STORAGE_KEY) ?? ''; } catch { return ''; }
}

export function retainDiscountCode(value: string): void {
  if (typeof window === 'undefined') return;
  const code = normalizeDiscountCode(value);
  try {
    if (code) localStorage.setItem(DISCOUNT_CODE_STORAGE_KEY, code);
    else localStorage.removeItem(DISCOUNT_CODE_STORAGE_KEY);
  } catch { /* storage can be disabled; the current form value still works */ }
}
