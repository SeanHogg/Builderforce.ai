/**
 * Smart events (PRD 33 §3.4) — named moments derived from marks, retroactively.
 *
 * A rule matches ONE mark: a `page` rule a page mark's route, a `click` rule
 * a click mark's label or link target, a `custom` rule a `BFReplay.event`
 * name. Site rules live in `replay_smart_events`; the built-ins are this data.
 * One matcher (`markMatchesRule`) serves the recorder's goal trigger, ingest
 * and the funnel / filter compiler.
 */

import type { ReplayMark } from './chunk';

export type SmartEventRuleKind = 'page' | 'click' | 'custom';
export type SmartEventMatchMode = 'equals' | 'prefix' | 'contains';

export interface SmartEventRule {
  name: string;
  ruleKind: SmartEventRuleKind;
  /** Compared case-insensitively. */
  match: string;
  matchMode: SmartEventMatchMode;
}

export const BUILTIN_SMART_EVENT_NAMES = [
  'sign up',
  'purchase',
  'add to cart',
  'begin checkout',
  'contact',
  'download',
] as const;

export type BuiltinSmartEventName = (typeof BUILTIN_SMART_EVENT_NAMES)[number];

/** Built-in names that make an unkept session worth keeping (`keep: 'goal'`). */
export const GOAL_SMART_EVENTS: readonly BuiltinSmartEventName[] = ['sign up', 'purchase', 'begin checkout'];

function rules(
  name: BuiltinSmartEventName,
  ruleKind: SmartEventRuleKind,
  matchMode: SmartEventMatchMode,
  matches: readonly string[],
): SmartEventRule[] {
  return matches.map((match) => ({ name, ruleKind, match, matchMode }));
}

/**
 * Click labels in en / zh / es / fr / de, link targets and paths. Several
 * rules share a name; any one matching names the mark.
 */
export const BUILTIN_SMART_EVENTS: readonly SmartEventRule[] = [
  ...rules('sign up', 'click', 'contains', [
    'sign up', 'signup', 'create account', 'register',
    '注册', '创建账户',
    'registrarse', 'regístrate', 'crear cuenta',
    "s'inscrire", 'inscrivez-vous', 'créer un compte',
    'registrieren', 'konto erstellen',
  ]),
  ...rules('sign up', 'page', 'contains', ['/signup/complete', '/welcome']),
  ...rules('purchase', 'click', 'contains', [
    'place order', 'complete purchase', 'pay now', 'buy now',
    '提交订单', '立即购买', '立即支付',
    'realizar pedido', 'comprar ahora', 'pagar ahora',
    'passer la commande', 'acheter maintenant', 'payer maintenant',
    'jetzt kaufen', 'kaufen', 'zahlungspflichtig bestellen', 'jetzt bezahlen',
  ]),
  ...rules('purchase', 'page', 'contains', ['/order-confirmation', '/order-complete', '/checkout/success', '/thank-you-for-your-order']),
  ...rules('add to cart', 'click', 'contains', [
    'add to cart', 'add to bag', 'add to basket',
    '加入购物车',
    'añadir al carrito', 'agregar al carrito',
    'ajouter au panier',
    'in den warenkorb',
  ]),
  ...rules('begin checkout', 'click', 'contains', [
    'checkout', 'check out', 'proceed to payment',
    '结账', '去结算',
    'finalizar compra', 'tramitar pedido',
    'paiement', 'commander',
    'zur kasse',
  ]),
  ...rules('begin checkout', 'page', 'prefix', ['/checkout']),
  ...rules('contact', 'click', 'prefix', ['mailto:', 'tel:']),
  ...rules('contact', 'click', 'contains', [
    'contact us', 'contact sales', 'get in touch',
    '联系我们',
    'contáctanos', 'contactar',
    'nous contacter', 'contactez-nous',
    'kontakt aufnehmen', 'kontaktieren',
  ]),
  ...rules('download', 'click', 'contains', [
    '.pdf', '.zip', '.dmg', '.exe', '.msi', '.pkg', '.apk', '.csv', '.xlsx', '.docx',
    'download', '下载', 'descargar', 'télécharger', 'herunterladen',
  ]),
];

function textMatches(text: string, rule: SmartEventRule): boolean {
  const haystack = text.toLowerCase();
  const needle = rule.match.toLowerCase();
  if (!needle) return false;
  switch (rule.matchMode) {
    case 'equals':
      return haystack === needle;
    case 'prefix':
      return haystack.startsWith(needle);
    case 'contains':
      return haystack.includes(needle);
  }
}

/** The mark fields a rule reads. */
export type SmartEventMark = Pick<ReplayMark, 'kind' | 'key' | 'label' | 'href'>;

/**
 * Whether one mark matches one rule. `page` → a `page` mark's `key` (route);
 * `click` → a `click` mark's `label` or `href`; `custom` → an `event` mark's
 * `key` (event name).
 */
export function markMatchesRule(mark: SmartEventMark, rule: SmartEventRule): boolean {
  switch (rule.ruleKind) {
    case 'page':
      return mark.kind === 'page' && textMatches(mark.key, rule);
    case 'click':
      if (mark.kind !== 'click') return false;
      return (!!mark.label && textMatches(mark.label, rule)) || (!!mark.href && textMatches(mark.href, rule));
    case 'custom':
      return mark.kind === 'event' && textMatches(mark.key, rule);
  }
}

/** Every distinct smart-event name the mark matches, in rule order. */
export function smartEventsForMark(
  mark: SmartEventMark,
  ruleSet: readonly SmartEventRule[] = BUILTIN_SMART_EVENTS,
): string[] {
  const names: string[] = [];
  for (const rule of ruleSet) {
    if (!names.includes(rule.name) && markMatchesRule(mark, rule)) names.push(rule.name);
  }
  return names;
}
