/**
 * Smart-event rules — the conversion / CTA catalogue Insights highlights
 * without the site owner configuring anything.
 *
 * Patterns are lowercase substrings matched against path, label or href.
 * Multilingual on purpose: a Spanish `/gracias` and a Japanese `/ありがとう`
 * are the same conversion as `/thank-you`.
 */

export type SmartEventMatchKind = 'path' | 'click' | 'submit';

export interface SmartEventRule {
  id: string;
  label: string;
  match: {
    kind: SmartEventMatchKind;
    patterns: readonly string[];
  };
}

export const BUILTIN_SMART_EVENTS: readonly SmartEventRule[] = [
  {
    id: 'conversion.thank-you',
    label: 'Thank-you / confirmation page',
    match: {
      kind: 'path',
      patterns: [
        'thank',
        'thanks',
        'gracias',
        'merci',
        'obrigad',
        'danke',
        'grazie',
        'tack',
        'bedankt',
        'dziek',
        'spasibo',
        'arigato',
        'ありがとう',
        'thankyou',
        'success',
        'confirmed',
        'confirmation',
        'order-complete',
        'order_complete',
        'purchase-complete',
      ],
    },
  },
  {
    id: 'conversion.checkout',
    label: 'Checkout',
    match: {
      kind: 'path',
      patterns: ['checkout', 'panier', 'warenkorb', 'carrito', 'carrinho', 'kassa', 'cassa'],
    },
  },
  {
    id: 'cta.buy',
    label: 'Buy / purchase',
    match: {
      kind: 'click',
      patterns: ['buy', 'purchase', 'comprar', 'acheter', 'kaufen', 'acquista', 'купить', '買う'],
    },
  },
  {
    id: 'cta.signup',
    label: 'Sign up / register',
    match: {
      kind: 'click',
      patterns: [
        'sign up',
        'signup',
        'register',
        'registr',
        'inscri',
        'anmeld',
        'cadastr',
        '登録',
        'create account',
        'get started',
        'empezar',
        'commencer',
      ],
    },
  },
  {
    id: 'cta.demo',
    label: 'Book a demo',
    match: {
      kind: 'click',
      patterns: ['demo', 'book a call', 'schedule', 'talk to sales', 'contact sales', 'hablar'],
    },
  },
  {
    id: 'cta.subscribe',
    label: 'Subscribe',
    match: {
      kind: 'click',
      patterns: ['subscribe', 'newsletter', 'abon', 'inscrev', '購読'],
    },
  },
  {
    id: 'form.lead',
    label: 'Lead form submit',
    match: {
      kind: 'submit',
      patterns: ['contact', 'lead', 'quote', 'demo', 'trial', 'newsletter', 'signup', 'sign-up'],
    },
  },
];

export interface SmartEventMark {
  kind: string;
  label?: string | null;
  path?: string | null;
  href?: string | null;
}

/**
 * Whether a captured mark matches a smart-event rule. Comparison is
 * case-insensitive substring against the fields the rule's `kind` names.
 */
export function markMatchesRule(mark: SmartEventMark, rule: SmartEventRule): boolean {
  const haystacks: string[] = [];
  if (rule.match.kind === 'path') {
    if (mark.path) haystacks.push(mark.path);
    if (mark.href) haystacks.push(mark.href);
  } else if (rule.match.kind === 'click') {
    if (mark.kind !== 'click') return false;
    if (mark.label) haystacks.push(mark.label);
    if (mark.href) haystacks.push(mark.href);
  } else if (rule.match.kind === 'submit') {
    if (mark.kind !== 'submit' && mark.kind !== 'form') return false;
    if (mark.label) haystacks.push(mark.label);
    if (mark.path) haystacks.push(mark.path);
  } else {
    return false;
  }
  if (haystacks.length === 0) return false;
  const lower = haystacks.map((h) => h.toLowerCase());
  return rule.match.patterns.some((pattern) => lower.some((h) => h.includes(pattern.toLowerCase())));
}

/** First builtin rule the mark matches, if any. */
export function matchingSmartEvent(mark: SmartEventMark): SmartEventRule | null {
  for (const rule of BUILTIN_SMART_EVENTS) {
    if (markMatchesRule(mark, rule)) return rule;
  }
  return null;
}
