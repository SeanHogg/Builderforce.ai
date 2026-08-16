/**
 * Blueprints — the reusable answer to "a brief like this one".
 *
 * The challenge pipeline has to work for a brief nobody anticipated, which means
 * the general path is "ask a model to design it". That path is capable but
 * unreliable in exactly the places that decide whether the result WORKS: the
 * signature-verification kind on a webhook, the order of SendGrid's content
 * array, whether an outbound call needs a `Url` or inline `Twiml`. Those are not
 * judgement calls — they are facts, and a model that gets one wrong produces a
 * system that looks right and answers nothing.
 *
 * A blueprint is where those facts are pinned. It carries the handlers, the
 * scaffold, the connectors, the secrets and the acceptance criteria for a KIND of
 * brief, written and tested once. Matching is deliberately boring — capability
 * overlap plus vendor signals — so the same brief always lands on the same
 * blueprint and a customer can see WHY.
 *
 * When nothing matches well enough, `generic` takes over and the model designs
 * the system against the same interfaces. So the framework degrades to "AI builds
 * it" rather than to "nothing happens", and every blueprint added afterwards
 * upgrades a class of briefs from generated to guaranteed.
 */

import type { BackendStrategyKey } from '../backend/hostingStrategy';
import type { RequiredConnector, RequiredSecret } from '../../domain/guidedSetup/guidedStep';

/**
 * The capability vocabulary. A closed set on purpose: matching two free-text
 * capability lists is a similarity problem with no right answer, while matching
 * two sets of these is exact. The extractor's job is to map a brief's prose onto
 * these; the blueprint's job is to declare which it delivers.
 */
export const CAPABILITIES = [
  'sms',
  'mms',
  'whatsapp',
  'voice',
  'ivr',
  'email',
  'chat',
  'inbound-webhook',
  'verification',
  'notifications',
  'scheduling',
  'payments',
  'crm',
  'ecommerce',
  'dashboard',
  'analytics',
  'auth',
  'ai-agent',
  'search',
  'file-storage',
  'data-import',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export function isCapability(v: unknown): v is Capability {
  return typeof v === 'string' && (CAPABILITIES as readonly string[]).includes(v);
}

/**
 * A connector the built system needs a live connection for, and a secret the
 * running backend reads.
 *
 * Declared in `domain/guidedSetup` rather than here because a template's guided
 * setup states exactly the same two facts about exactly the same catalog, and
 * two structurally identical declarations of "which integration this needs and
 * why" is how the Connect button ends up rendering one shape on the challenge
 * page and a different one in the template wizard. Re-exported so every existing
 * caller keeps importing it from where it already looks.
 */
export type { RequiredConnector, RequiredSecret };

export interface BlueprintTask {
  title: string;
  description: string;
  /** Ordering hint on the board; lower runs first. */
  order: number;
  /**
   * `setup` is work only a human can do — connect an account, paste a URL into a
   * provider console, verify a sender. `build` is work a coding agent can pick
   * up.
   *
   * Absent means `setup`, and that default is load-bearing: dispatching a coding
   * agent at "go and connect your Twilio account" burns a run to produce nothing,
   * and does it on a ticket whose whole content is a human instruction. A wrong
   * `build` costs a run; a wrong `setup` costs a click.
   */
  kind?: 'setup' | 'build';
}

/** Whether a seeded ticket is eligible for autonomous dispatch. */
export const isBuildTask = (task: BlueprintTask): boolean => task.kind === 'build';

export interface Blueprint {
  key: string;
  name: string;
  summary: string;
  /** Vendor/product words in a brief that point here (lowercased, matched as substrings). */
  signals: readonly string[];
  capabilities: readonly Capability[];
  requiredConnectors: readonly RequiredConnector[];
  requiredSecrets: readonly RequiredSecret[];
  /** Recommended hosting strategy — declarative unless the design needs real code. */
  strategy: BackendStrategyKey;
  /** Non-handler canvas files: the front end, the docs, the demo console. */
  files: Readonly<Record<string, string>>;
  /** `handlers/<name>.json` documents, as objects (serialised at materialise time). */
  handlers: Readonly<Record<string, unknown>>;
  tasks: readonly BlueprintTask[];
  /** What the customer must be able to demonstrate. Becomes the acceptance list. */
  successCriteria: readonly string[];
}

/** How a brief matched a blueprint — surfaced so the choice is never a black box. */
export interface BlueprintMatch {
  blueprint: Blueprint;
  /** 0–1. Below {@link MATCH_THRESHOLD} the generic blueprint is used instead. */
  score: number;
  reasons: string[];
  matchedCapabilities: Capability[];
  missingCapabilities: Capability[];
  /** Vendor/product words from the blueprint that the brief actually names. */
  signalHits: string[];
}

/**
 * Minimum score for a specific blueprint to beat `generic`.
 *
 * Set where it is because a WRONG specific blueprint is worse than the generic
 * path: generic produces a plausible design the customer reviews, while a wrong
 * specific one produces a confident, wrong, Twilio-shaped system for a brief
 * about invoicing. Half the capabilities plus a vendor signal is the bar.
 *
 * The score is NOT sufficient on its own — see {@link requiresSignal}.
 */
export const MATCH_THRESHOLD = 0.5;

/**
 * A specific blueprint must also be NAMED by the brief, not merely shaped like it.
 *
 * Capability overlap alone tops out at `1 - SIGNAL_WEIGHT` = 0.65, which clears
 * the threshold — so without this gate a brief wanting nothing but "payments and
 * email" would land on the Stripe dunning blueprint with no mention of Stripe
 * anywhere in it. That failure mode gets WORSE with every blueprint added, since
 * each one is another confident wrong answer competing on generic capabilities.
 * Requiring one vendor/product word makes the catalog safe to grow.
 */
export function requiresSignal(match: BlueprintMatch): boolean {
  return match.blueprint.signals.length > 0 && match.signalHits.length === 0;
}

/** Vendor signals are worth this much of the score; capability overlap the rest. */
const SIGNAL_WEIGHT = 0.35;

/**
 * Score one blueprint against an extracted brief.
 *
 * Capability overlap is measured against the BLUEPRINT's capabilities, not the
 * brief's: a brief asking for SMS + email + a dashboard should match a blueprint
 * that covers SMS + email + voice + WhatsApp + a dashboard, even though the
 * blueprint offers more than was asked. Penalising a blueprint for being MORE
 * capable would push every brief toward the thinnest possible match.
 */
export function scoreBlueprint(
  blueprint: Blueprint,
  briefCapabilities: readonly Capability[],
  briefText: string,
): BlueprintMatch {
  const wanted = new Set(briefCapabilities);
  const offered = new Set(blueprint.capabilities);
  const matched = [...wanted].filter((c) => offered.has(c));
  const missing = [...wanted].filter((c) => !offered.has(c));

  const haystack = briefText.toLowerCase();
  const hitSignals = blueprint.signals.filter((s) => haystack.includes(s));

  const capabilityScore = wanted.size === 0 ? 0 : matched.length / wanted.size;
  const signalScore = blueprint.signals.length === 0 ? 0 : Math.min(1, hitSignals.length / 2);
  const score = capabilityScore * (1 - SIGNAL_WEIGHT) + signalScore * SIGNAL_WEIGHT;

  const reasons: string[] = [];
  if (matched.length) reasons.push(`Covers ${matched.length} of ${wanted.size} required capabilities: ${matched.join(', ')}`);
  if (hitSignals.length) reasons.push(`The brief names ${hitSignals.join(', ')}`);
  if (missing.length) reasons.push(`Does not cover: ${missing.join(', ')}`);

  return {
    blueprint,
    score,
    reasons,
    matchedCapabilities: matched,
    missingCapabilities: missing,
    signalHits: hitSignals,
  };
}

/**
 * Map a raw capability-ish string onto the vocabulary. Tolerant on purpose — the
 * extractor is a model and will say "text messaging" where the vocabulary says
 * `sms`, and a brief that mentions "IVR" should not fail to match because the
 * model wrote "phone tree".
 */
const CAPABILITY_ALIASES: Record<string, Capability> = {
  'text message': 'sms', 'text messaging': 'sms', texting: 'sms', 'short message': 'sms', messaging: 'sms',
  picture: 'mms', 'picture message': 'mms', multimedia: 'mms',
  'whats app': 'whatsapp', wa: 'whatsapp',
  telephony: 'voice', calling: 'voice', 'phone call': 'voice', calls: 'voice', 'click-to-call': 'voice', 'call tracking': 'voice',
  'phone tree': 'ivr', 'auto attendant': 'ivr', 'voice menu': 'ivr', menu: 'ivr',
  mail: 'email', 'transactional email': 'email', newsletter: 'email',
  conversation: 'chat', chatbot: 'chat', 'live chat': 'chat',
  webhook: 'inbound-webhook', webhooks: 'inbound-webhook', callback: 'inbound-webhook', 'two-way': 'inbound-webhook',
  otp: 'verification', '2fa': 'verification', 'two-factor': 'verification', verify: 'verification',
  alerts: 'notifications', alerting: 'notifications', push: 'notifications',
  calendar: 'scheduling', booking: 'scheduling', appointments: 'scheduling',
  billing: 'payments', checkout: 'payments', stripe: 'payments',
  'customer records': 'crm', contacts: 'crm', leads: 'crm',
  shop: 'ecommerce', orders: 'ecommerce', store: 'ecommerce', cart: 'ecommerce',
  ui: 'dashboard', console: 'dashboard', portal: 'dashboard', 'admin panel': 'dashboard',
  reporting: 'analytics', metrics: 'analytics', insights: 'analytics',
  login: 'auth', 'sign in': 'auth', authentication: 'auth', sso: 'auth',
  agent: 'ai-agent', llm: 'ai-agent', ai: 'ai-agent', 'ai assistant': 'ai-agent',
  upload: 'file-storage', files: 'file-storage', storage: 'file-storage',
  import: 'data-import', csv: 'data-import', migration: 'data-import',
};

export function normalizeCapability(raw: string): Capability | null {
  const key = raw.trim().toLowerCase().replace(/[_\s]+/g, ' ');
  if (isCapability(key.replace(/ /g, '-'))) return key.replace(/ /g, '-') as Capability;
  if (isCapability(key)) return key;
  if (CAPABILITY_ALIASES[key]) return CAPABILITY_ALIASES[key]!;
  // Substring pass: "two-way SMS support" → sms. Longest alias wins so
  // "whats app" is not shadowed by a shorter accidental hit.
  const aliases = Object.keys(CAPABILITY_ALIASES).sort((a, b) => b.length - a.length);
  for (const alias of aliases) if (key.includes(alias)) return CAPABILITY_ALIASES[alias]!;
  for (const cap of CAPABILITIES) if (key.includes(cap)) return cap;
  return null;
}

/** Normalise + dedupe a raw capability list from the extractor. */
export function normalizeCapabilities(raw: readonly unknown[]): Capability[] {
  const out = new Set<Capability>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const cap = normalizeCapability(item);
    if (cap) out.add(cap);
  }
  return [...out];
}
