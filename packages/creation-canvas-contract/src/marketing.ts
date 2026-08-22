/**
 * The MARKETING vocabulary — the brand a generative board composes against, and the
 * audience a send is actually allowed to reach.
 *
 * ── THE TWO GAPS THIS CLOSES ─────────────────────────────────────────────────────
 * `api/src/infrastructure/database/schema/growth.ts` has declared `brand_kits`,
 * `marketing_audiences`/`_members` and `marketing_suppressions` since the growth domain
 * landed, and `CREATION_OBJECT_REGISTRY` exposed none of it. Two consequences, and they
 * are not the same size:
 *
 *  1. **Unbranded by construction.** `image`, `video`, `animation`, `comic`, `podcast`,
 *     `website`, `prototype`, `emailTemplate` and `socialCampaign` all reach
 *     `builtin_creative_compose` (or the website/email authoring fields) with NO brand
 *     binding — no palette, no logo, no typography, no voice, no claim list. Output is
 *     per-object plausible and cross-object inconsistent, which is the exact failure
 *     that makes a generative marketing tool unusable at brand scale. `battlecard`
 *     already models `doNotSay` — the claims a company may not make — and no generative
 *     path consulted it, so the one piece of brand safety the product already had was
 *     unreachable from every surface that could violate it.
 *
 *  2. **A send with no visible consent state.** `emailCampaign` declares `audienceId`
 *     and `audienceName` as authorable fields with no object that produces one, and
 *     `marketing_suppressions` — the tenant-wide do-not-contact list checked at send
 *     time — was unreadable from the board. An operator could author and fire a send
 *     from the canvas with no visible consent or unsubscribe state. That is a
 *     CAN-SPAM / GDPR exposure CREATED BY THE SURFACE rather than by the sender, which
 *     is why it is treated here as the priority of the two.
 *
 * ── WHY THIS IS A CONTRACT MODULE AND NOT FRONTEND-ONLY ──────────────────────────
 * Both halves are read by more than one runtime. The brand directive is composed into a
 * prompt by the browser AND has to be legible to the API's creative route when a compose
 * is dispatched server-side; the sendable arithmetic is printed on the campaign card AND
 * decides whether the send button refuses. Two spellings of "how many of these may we
 * lawfully mail" is exactly how a card comes to disagree with the sender that ran.
 *
 * ── WHY `brandKit` IS AN OBJECT AND NOT A CANVAS SETTING ─────────────────────────
 * A canvas-level setting would be one brand per board, and the boards that most need
 * this are the ones holding two: a company and the product it is launching, a house
 * brand and a co-marketing partner, the current identity and the rebrand being tested.
 * A binding — `brandKitRef` naming a `brandKit` card by title — lets a board carry
 * several and lets each generative object say which one it answers to, while a board
 * holding exactly one gets the single-brand behaviour for free (see
 * {@link resolveBrandBinding}, which falls back to the only kit present).
 */


/**
 * The marketing objects. Two kinds, and both of them exist because a TABLE existed with
 * nothing on the board that could read it.
 */
export const MARKETING_OBJECT_KINDS = [
  // THE BRAND, AS A BINDABLE THING. Palette, typography, logo, voice, and the claims
  // that may never be made. Projects `brand_kits`; the claim list is the board's own,
  // because `battlecard.doNotSay` is where the product already records a forbidden
  // claim and a second store for the same sentence is how the two come to disagree.
  'brandKit',
  // WHO A SEND REACHES, AND WHO IT MUST NOT. Rules, size, and the suppression count —
  // the last of which is the whole reason the kind exists: an audience card that showed
  // a size and not a suppression count would make the surface's own legal exposure
  // invisible in exactly the place a person decides to press send.
  'audience',
] as const;

export type MarketingObjectKind = typeof MARKETING_OBJECT_KINDS[number];

const MARKETING_KIND_SET: ReadonlySet<string> = new Set<string>(MARKETING_OBJECT_KINDS);

/** True for the marketing objects declared above — the set `marketingObjects.ts` specs. */
export function isMarketingObjectKind(value: unknown): value is MarketingObjectKind {
  return typeof value === 'string' && MARKETING_KIND_SET.has(value);
}

// ---------------------------------------------------------------------------
// The brand binding
// ---------------------------------------------------------------------------

/**
 * The field every brand-bound object carries, on every one of them, spelled once.
 *
 * A string naming a `brandKit` card by its title rather than an id, for the same reason
 * `jobApplication.jobRef` names a `job` by title: a guest board has no server ids at
 * all, and a binding that only works once the board is saved is a binding that does not
 * work while the board is being made.
 */
export const BRAND_BINDING_FIELD = 'brandKitRef';

/**
 * Every kind whose output a brand governs.
 *
 * The nine the review named, and no more: a `dataset` has no visual identity and a
 * `task` has no voice. Exported so the registry adds `brandKitRef` to exactly these
 * kinds' authorable fields from ONE list, rather than nine hand-edits that drift.
 */
export const BRAND_BOUND_KINDS: readonly string[] = [
  // The `creative.*` capabilities — every one of them reaches `builtin_creative_compose`.
  'image', 'video', 'animation', 'comic', 'podcast', 'drawing', 'model3d', 'cad',
  // The authored surfaces, which do not go through the creative route but carry the same
  // identity: a site and an email that ignore the palette are as off-brand as a poster.
  'website', 'prototype', 'emailTemplate', 'emailCampaign', 'socialCampaign', 'socialPost',
  // Slides and mockups are shown to customers more often than any image on this list.
  'slides', 'mockup', 'mockupSet',
];

const BRAND_BOUND_SET: ReadonlySet<string> = new Set<string>(BRAND_BOUND_KINDS);

/** True when this kind's output is governed by a brand. Read by the registry and by the
 *  compose path, so "is this brand-bound" has one answer. */
export function isBrandBoundKind(kind: unknown): boolean {
  return typeof kind === 'string' && BRAND_BOUND_SET.has(kind);
}

/**
 * A resolved brand, in the shape a generator can actually use.
 *
 * Everything is optional because a half-filled kit is the normal state of a real one —
 * a company has colours long before it has a written tone of voice — and a binding that
 * only applied once every field was present would apply to almost nothing.
 */
export interface BrandBinding {
  /** The kit's own name, so a composed artifact can say which brand it answers to. */
  name: string;
  /** Hex or token values in declaration order; the first is the primary. */
  palette: readonly string[];
  /** Display and body faces, in that order. */
  typography: readonly string[];
  /** Absolute URL of the primary logo, when the kit has one. */
  logoUrl?: string;
  /** Absolute URL of the logo for dark grounds. Its own field, never a filter applied
   *  to the light one: a mark that is legible inverted is a design decision, not an
   *  image operation. */
  logoDarkUrl?: string;
  /** How the brand speaks, in the kit author's own words. */
  voice?: string;
  /**
   * Claims this brand may never make.
   *
   * Merged from the kit's own list AND every `battlecard.doNotSay` on the board — see
   * {@link resolveBrandBinding}. The merge is the point: the product already models a
   * forbidden claim in the object a competitor argument is written on, and the surface
   * that could violate it was the one place that could not read it.
   */
  doNotSay: readonly string[];
}

/** A board object as this module needs to see it. Structural, so nothing here depends on
 *  the canvas node type or on a saved row's column names. */
export interface BrandBoardObject {
  kind: string;
  title?: string | null;
  data: Record<string, unknown>;
}

function stringList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => {
        if (typeof entry === 'string') return entry.trim();
        if (entry && typeof entry === 'object') {
          const record = entry as Record<string, unknown>;
          const value = record.value ?? record.claim ?? record.color ?? record.name ?? record.label;
          return typeof value === 'string' ? value.trim() : '';
        }
        return '';
      })
      .filter((entry) => entry.length > 0);
  }
  if (typeof raw === 'string') {
    return raw.split(/[\n,;]/).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  }
  return [];
}

function text(raw: unknown): string | undefined {
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value.length > 0 ? value : undefined;
}

/** Normalise the reference on a bound object, so `"Acme"`, `" acme "` and `"ACME"` are
 *  one binding. Exported because the card renders the match and the compose path
 *  resolves it, and a second casing rule is a binding that silently misses. */
export function brandRefKey(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

/**
 * The brand one object composes against, resolved from the whole board.
 *
 * ── THE THREE RULES, IN ORDER ────────────────────────────────────────────────────
 *  1. An explicit `brandKitRef` wins. The author said which brand this is.
 *  2. Otherwise, if the board holds EXACTLY ONE `brandKit`, that is the brand. A board
 *     with one identity should not require every card to name it — that would make the
 *     common case the one with the most bookkeeping, and an unbound card on a
 *     single-brand board is not ambiguous, it is obvious.
 *  3. Otherwise there is no binding, and the caller composes unbranded exactly as it
 *     did before. Guessing between two kits would put the wrong logo on a launch asset,
 *     which is worse than putting none on it.
 *
 * The `doNotSay` merge runs in every case a kit resolves: the board's `battlecard`
 * claims are constraints on the COMPANY, not on the kit, so they apply to whichever kit
 * is in force.
 */
export function resolveBrandBinding(
  object: Pick<BrandBoardObject, 'data'>,
  board: readonly BrandBoardObject[],
): BrandBinding | undefined {
  const kits = board.filter((entry) => entry.kind === 'brandKit');
  if (kits.length === 0) return undefined;
  const ref = brandRefKey(object.data[BRAND_BINDING_FIELD]);
  const kit = ref
    ? kits.find((entry) => brandRefKey(entry.title) === ref || brandRefKey(entry.data.title) === ref)
    : (kits.length === 1 ? kits[0] : undefined);
  if (!kit) return undefined;

  const boardClaims = board
    .filter((entry) => entry.kind === 'battlecard')
    .flatMap((entry) => stringList(entry.data.doNotSay));
  const kitClaims = stringList(kit.data.doNotSay);
  const seen = new Set<string>();
  const doNotSay = [...kitClaims, ...boardClaims].filter((claim) => {
    const key = claim.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    name: text(kit.title) ?? text(kit.data.title) ?? 'Brand',
    palette: stringList(kit.data.palette),
    typography: stringList(kit.data.typography),
    ...(text(kit.data.logoUrl) ? { logoUrl: text(kit.data.logoUrl)! } : {}),
    ...(text(kit.data.logoDarkUrl) ? { logoDarkUrl: text(kit.data.logoDarkUrl)! } : {}),
    ...(text(kit.data.voice) ? { voice: text(kit.data.voice)! } : {}),
    doNotSay,
  };
}

/**
 * The brand, as an instruction a generator can be given.
 *
 * ONE composer, because the browser composes it into a `creative.*` prompt and the API
 * composes it into a server-side dispatch, and a brand stated two ways is a brand
 * applied two ways. Returns an empty string when there is nothing to say, so a caller
 * can concatenate unconditionally rather than branching.
 *
 * `doNotSay` is stated LAST and in the imperative, because a constraint buried in the
 * middle of a style description is a constraint a model drops first.
 */
export function brandDirective(binding: BrandBinding | undefined): string {
  if (!binding) return '';
  const parts: string[] = [`Compose this on brand for "${binding.name}".`];
  if (binding.palette.length) parts.push(`Palette, primary first: ${binding.palette.join(', ')}. Use these colours; do not introduce others.`);
  if (binding.typography.length) parts.push(`Typography, display first: ${binding.typography.join(', ')}.`);
  if (binding.logoUrl) parts.push(`Logo: ${binding.logoUrl}${binding.logoDarkUrl ? ` (on dark grounds: ${binding.logoDarkUrl})` : ''}. Never redraw, recolour or distort it.`);
  if (binding.voice) parts.push(`Voice and tone: ${binding.voice}`);
  if (binding.doNotSay.length) {
    parts.push(`NEVER make any of these claims, in any wording: ${binding.doNotSay.map((claim) => `"${claim}"`).join('; ')}. If the brief asks for one, produce the artifact without it and say which claim you dropped.`);
  }
  return parts.join(' ');
}

/**
 * Claims in a drafted body that a bound brand forbids.
 *
 * Substring-and-case-insensitive rather than clever: the forbidden claims a company
 * writes down are short phrases ("HIPAA compliant", "the fastest"), and a matcher that
 * tried to be smarter would produce misses nobody could explain. Exported so the card
 * can WARN as well as the prompt instruct — an instruction the model ignored and nothing
 * checked is the failure mode this whole binding exists to remove.
 */
export function forbiddenClaimsIn(body: unknown, binding: BrandBinding | undefined): readonly string[] {
  if (!binding?.doNotSay.length) return [];
  const haystack = String(body ?? '').toLowerCase();
  if (!haystack.trim()) return [];
  return binding.doNotSay.filter((claim) => claim.length > 2 && haystack.includes(claim.toLowerCase()));
}

// ---------------------------------------------------------------------------
// The audience, and what a send is allowed to reach
// ---------------------------------------------------------------------------

/**
 * The lawful basis a list was collected under.
 *
 * Restated on the card rather than left to a policy document because it is the field
 * that decides whether the send is legal, and a person deciding to press send is not
 * going to go and read the policy. `unknown` is FIRST and is the default: a blank
 * audience must not claim a consent it has no evidence of.
 */
export const AUDIENCE_CONSENT_BASES = [
  'unknown', 'optIn', 'doubleOptIn', 'legitimateInterest', 'contractual', 'imported',
] as const;

export type AudienceConsentBasis = typeof AUDIENCE_CONSENT_BASES[number];

/** The bases that are evidence of an affirmative act by the person. Everything else is
 *  a basis that may be defensible and is not consent, which is a distinction the card
 *  has to keep because CAN-SPAM and GDPR keep it. */
const AFFIRMATIVE_BASES: ReadonlySet<string> = new Set<string>(['optIn', 'doubleOptIn']);

export function isAffirmativeConsent(basis: unknown): boolean {
  return AFFIRMATIVE_BASES.has(String(basis ?? '').trim());
}

/**
 * How many of an audience may actually be mailed.
 *
 * `size - suppressed`, floored at zero and `undefined` when the size is unknown — a
 * sendable count computed from a missing size would print a confident zero over a list
 * nobody has counted yet, which reads as "this audience is empty" rather than "we do not
 * know". The floor matters too: a suppression list larger than the audience is normal
 * (suppressions are tenant-wide) and a negative sendable count is nonsense on a card.
 */
export function sendableCount(size: unknown, suppressed: unknown): number | undefined {
  const total = Number(size);
  if (!Number.isFinite(total)) return undefined;
  const blocked = Number(suppressed);
  return Math.max(0, Math.round(total) - (Number.isFinite(blocked) ? Math.round(blocked) : 0));
}

/** Why a send is being refused, or `null` when nothing on the surface objects. */
export type SendBlocker =
  | 'noAudience'
  | 'unknownConsent'
  | 'noSuppressionCheck'
  | 'emptyAfterSuppression'
  | 'forbiddenClaim';

export interface SendReadiness {
  /** True only when nothing above objects. The send control reads this. */
  ready: boolean;
  blockers: readonly SendBlocker[];
  sendable?: number;
}

/**
 * Whether this campaign may lawfully be fired FROM THE BOARD.
 *
 * ── WHY THE SURFACE REFUSES RATHER THAN WARNS ────────────────────────────────────
 * The exposure the register describes is created by the surface: the sender is doing
 * exactly what the board offered. A warning beside an enabled button is the same
 * product with a paper trail. So the four blockers below disable the control, and each
 * one names the single thing to do about it.
 *
 * `noSuppressionCheck` is a blocker and not a warning for the reason that took the
 * longest to argue: a `suppressedCount` of `undefined` means the board never asked,
 * which is indistinguishable on screen from a genuine zero. Treating "not asked" as
 * "nobody has unsubscribed" is precisely the assumption that mails a person who opted
 * out, so the absent answer refuses and the count of zero — actually retrieved — does
 * not.
 */
export function sendReadiness(input: {
  audienceId?: unknown;
  audienceName?: unknown;
  size?: unknown;
  suppressedCount?: unknown;
  consentBasis?: unknown;
  forbiddenClaims?: readonly string[];
}): SendReadiness {
  const blockers: SendBlocker[] = [];
  const named = String(input.audienceId ?? '').trim() || String(input.audienceName ?? '').trim();
  if (!named) blockers.push('noAudience');
  if (!isAffirmativeConsent(input.consentBasis)) blockers.push('unknownConsent');

  const suppressedKnown = input.suppressedCount !== undefined && input.suppressedCount !== null
    && input.suppressedCount !== '' && Number.isFinite(Number(input.suppressedCount));
  if (!suppressedKnown) blockers.push('noSuppressionCheck');

  const sendable = sendableCount(input.size, suppressedKnown ? input.suppressedCount : 0);
  if (suppressedKnown && sendable === 0) blockers.push('emptyAfterSuppression');
  if (input.forbiddenClaims?.length) blockers.push('forbiddenClaim');

  return {
    ready: blockers.length === 0,
    blockers,
    ...(sendable === undefined ? {} : { sendable }),
  };
}
