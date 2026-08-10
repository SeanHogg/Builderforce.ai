/**
 * Brief → {@link ChallengeSpec}. The front door of the challenge pipeline.
 *
 * The input is whatever a human pasted: a sponsor's onboarding email, a hackathon
 * prompt, an RFP section, a Slack message. The output is a structured statement
 * of what WINNING requires, because everything downstream — blueprint matching,
 * the plan, the acceptance criteria — is a function of that and nothing else.
 *
 * ── WHY THERE IS A NON-LLM FALLBACK ─────────────────────────────────────────
 * Extraction runs through a model, and the model can be unavailable, rate-limited
 * or wrong. A pipeline whose first step can fail open is a pipeline that
 * intermittently produces nothing from a brief the customer can plainly read, so
 * {@link heuristicSpec} always runs and the model's answer is MERGED over it
 * rather than replacing it. The worst case is a coarse but honest reading; there
 * is no case where a pasted brief yields an empty spec.
 */

import type { LlmComplete } from '../compile';
import { normalizeCapabilities, type Capability } from './blueprint';

export interface ChallengeSpec {
  title: string;
  /** Who set the challenge — a vendor, a hackathon, a client. Display only. */
  sponsor: string | null;
  /** One sentence: what the finished system must do. */
  goal: string;
  capabilities: Capability[];
  /** Vendor/product names the brief names, as written. */
  integrations: string[];
  /** Concrete things that must exist at the end. */
  deliverables: string[];
  /** Limits: allowances, deadlines, plan restrictions, rules. */
  constraints: string[];
  /** How a judge (or the customer) decides it worked. */
  successCriteria: string[];
}

const SYSTEM = `You read a challenge brief and extract what BUILDING AND WINNING it requires.

Return ONLY minified JSON, no prose, no code fence, with exactly this shape:
{"title":string,"sponsor":string|null,"goal":string,"capabilities":string[],"integrations":string[],"deliverables":string[],"constraints":string[],"successCriteria":string[]}

Rules:
- title: a short name for the challenge (max 80 chars).
- sponsor: the organisation that set it, or null.
- goal: ONE sentence describing the system that must exist at the end.
- capabilities: technical capabilities the system needs, chosen from this list where they apply:
  sms, mms, whatsapp, voice, ivr, email, chat, inbound-webhook, verification, notifications,
  scheduling, payments, crm, ecommerce, dashboard, analytics, auth, ai-agent, search,
  file-storage, data-import.
  Include "inbound-webhook" whenever the system must RECEIVE events (an incoming message,
  a call, a status callback) — not only when the brief uses the word webhook.
- integrations: named products/vendors, as written in the brief.
- deliverables: concrete artefacts that must exist.
- constraints: hard limits — quotas, allowances, deadlines, plan or rule restrictions. Quote numbers exactly.
- successCriteria: observable outcomes a judge could check. Prefer things a person can DO and SEE.
Every array may be empty. Never invent a constraint the brief does not state.`;

/** Vendor words worth recognising without a model — these decide connector wiring. */
const KNOWN_INTEGRATIONS = [
  'twilio', 'sendgrid', 'whatsapp', 'slack', 'discord', 'stripe', 'shopify', 'salesforce',
  'hubspot', 'zendesk', 'jira', 'github', 'gitlab', 'notion', 'airtable', 'mailchimp',
  'google', 'microsoft', 'openai', 'anthropic', 'aws', 'cloudflare', 'vercel',
];

/**
 * Phrases that imply a capability. Distinct from the alias table in blueprint.ts:
 * that maps a capability-ish WORD onto the vocabulary, this scans free prose for
 * the things a brief actually says ("two-way customer support" → sms + webhook).
 */
const CAPABILITY_PHRASES: Array<[RegExp, Capability[]]> = [
  [/\bsms\b|text message|texting/i, ['sms']],
  [/\bmms\b|picture message/i, ['mms']],
  [/whats\s?app/i, ['whatsapp']],
  [/\bvoice\b|phone call|click-to-call|call tracking|outbound dial/i, ['voice']],
  [/\bivr\b|phone menu|auto attendant/i, ['ivr', 'voice']],
  [/\bemail\b|password reset|receipt|onboarding email|re-engagement/i, ['email']],
  [/two-way|inbound|webhook|callback|notification/i, ['inbound-webhook']],
  [/\botp\b|two-factor|verification code|\b2fa\b/i, ['verification']],
  [/notification|alert/i, ['notifications']],
  [/dashboard|console|admin panel|portal/i, ['dashboard']],
  [/analytic|report|metric|insight/i, ['analytics']],
  [/\bagent\b|\bai\b|\bllm\b|assistant|chatbot/i, ['ai-agent']],
  [/payment|billing|checkout|invoice/i, ['payments']],
  [/\bcrm\b|customer record|contact list|lead/i, ['crm']],
  [/order|cart|storefront|ecommerce|e-commerce/i, ['ecommerce']],
  [/schedul|appointment|booking|calendar/i, ['scheduling']],
  [/sign in|log in|login|authentication|\bsso\b/i, ['auth']],
  [/survey|conversational support|chat/i, ['chat']],
];

/** Sentences that read like a limit. Quoted verbatim — a paraphrased quota is a lie. */
const CONSTRAINT_HINT = /\b(\d[\d,]*)\s*(sms|messages?|minutes?|emails?|calls?|days?|credits?)\b|\btrial\b|\bdeadline\b|\bby [A-Z][a-z]+ \d/i;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12 && s.length < 320);
}

/**
 * A usable spec derived from the text alone. Never throws, never empty-handed —
 * this is the floor the model's answer is merged on top of.
 */
export function heuristicSpec(brief: string): ChallengeSpec {
  const lines = sentences(brief);
  const lower = brief.toLowerCase();

  const capabilities = new Set<Capability>();
  for (const [pattern, caps] of CAPABILITY_PHRASES) {
    if (pattern.test(brief)) for (const c of caps) capabilities.add(c);
  }
  // Anything that receives a message or a call needs an endpoint, whether or not
  // the brief says so — this is the inference that decides a backend is required.
  if (capabilities.has('sms') || capabilities.has('voice') || capabilities.has('whatsapp')) {
    capabilities.add('inbound-webhook');
  }

  const integrations = KNOWN_INTEGRATIONS.filter((v) => lower.includes(v)).map(
    (v) => v.charAt(0).toUpperCase() + v.slice(1),
  );

  const constraints = lines.filter((l) => CONSTRAINT_HINT.test(l)).slice(0, 6);

  const sponsor = integrations[0] ?? null;
  const firstLine = lines[0] ?? brief.trim().slice(0, 80);

  return {
    title: (sponsor ? `${sponsor} challenge` : firstLine).slice(0, 80) || 'Untitled challenge',
    sponsor,
    goal: firstLine.slice(0, 280),
    capabilities: [...capabilities],
    integrations,
    deliverables: [],
    constraints,
    successCriteria: [],
  };
}

const asStrings = (v: unknown, cap = 12): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim()).slice(0, cap) : [];

/** Pull the first JSON object out of a model reply (tolerates code fences). */
function parseJsonObject(raw: string): Record<string, unknown> | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Extract a {@link ChallengeSpec}. The heuristic reading is computed first and
 * the model's answer merged over it — UNION for the lists, model-wins for the
 * scalars. Union rather than replace because the two readings fail differently:
 * the heuristic catches the vendor names and quoted quotas reliably, the model
 * catches intent and implied capabilities, and dropping either loses information
 * the brief plainly contained.
 */
export async function parseBrief(brief: string, llm?: LlmComplete): Promise<ChallengeSpec> {
  const base = heuristicSpec(brief);
  if (!llm || !brief.trim()) return base;

  let extracted: Record<string, unknown> | null = null;
  try {
    // Long briefs are truncated rather than rejected: an RFP's first pages carry
    // the requirements, and failing on length would be a worse answer than a
    // slightly incomplete one.
    const reply = await llm([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: brief.slice(0, 12_000) },
    ]);
    extracted = parseJsonObject(reply);
  } catch {
    extracted = null;
  }
  if (!extracted) return base;

  const union = (a: string[], b: string[], cap = 12): string[] => [...new Set([...a, ...b])].slice(0, cap);

  return {
    title: (typeof extracted.title === 'string' && extracted.title.trim()) || base.title,
    sponsor: typeof extracted.sponsor === 'string' && extracted.sponsor.trim() ? extracted.sponsor.trim() : base.sponsor,
    goal: (typeof extracted.goal === 'string' && extracted.goal.trim()) || base.goal,
    capabilities: [...new Set([...base.capabilities, ...normalizeCapabilities(asStrings(extracted.capabilities, 20))])],
    integrations: union(base.integrations, asStrings(extracted.integrations)),
    deliverables: union(base.deliverables, asStrings(extracted.deliverables)),
    constraints: union(base.constraints, asStrings(extracted.constraints)),
    successCriteria: union(base.successCriteria, asStrings(extracted.successCriteria)),
  };
}
