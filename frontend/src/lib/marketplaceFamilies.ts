/**
 * The marketplace families (PRD 21 §11.5).
 *
 * Before this the storefront had eight tabs — `all · personas · skills ·
 * workforce · talent · models · gigs · publish` — which mixed *what is being
 * sold* with *who is selling it* with *a verb*. Adding companies as a ninth is
 * how that list reaches fifteen.
 *
 * Four families, and ONE derivation for each family's label, its publish call
 * to action and the FLOW that action runs. Four buttons written by hand drift
 * from the filter above them within a release; `FAMILIES[active].publishKey`
 * cannot. The `flow` matters as much as the label — **"Publish a company" runs
 * the claim-and-verify flow, not a listing form**, because a company you do not
 * own is not yours to list.
 *
 * There is deliberately no `/agents` destination: an agent is a *listing* whose
 * purchase writes a roster row, so the catalogue and the footer are the same
 * rows at two rungs and cannot drift apart. Agents split OUT of Talent rather
 * than nesting inside it because, although a person and an agent are the same
 * kind of participant to a session, they are not the same kind of listing —
 * one has availability and a rate, the other a price and a seat, and one
 * publish form serving both is where the honest flow dies.
 *
 * A note on the fourth name: it was drafted as "Things", which fails the CTA
 * test — no product ships a button reading *Publish a thing*. **A family name
 * that cannot complete "Publish a ___" is not a family name.** That is also why
 * Talent's CTA is "Publish a listing" rather than the ungrammatical alternative.
 */

import { LISTING_KIND_IDS, MARKETPLACE_LISTING_KINDS } from '@builderforce/creation-canvas-contract';

/** The kinds the existing marketplace sections already render, keyed by family. */
export type FamilyId = 'talent' | 'company' | 'agent' | 'asset';

export interface MarketplaceFamily {
  id: FamilyId;
  /** i18n key under `marketplace.family`. */
  labelKey: string;
  /** i18n key for the publish CTA — derived, never written per tab. */
  publishKey: string;
  /**
   * What the CTA actually does. `claim` is not a listing form: it verifies
   * ownership of a business before anything is published.
   */
  flow: 'listing' | 'claim' | 'agent' | 'asset';
  /** The seat hue this family is tinted with, from `lib/seats.ts`. */
  hueVar: string;
  /** Sub-filters inside the family. The first is the default. */
  kinds: string[];
  /** i18n key for the one-line explanation under the grid. */
  noteKey: string;
}

/**
 * Which kind chip a CANVAS-PUBLISHED creation files under, when it is not simply
 * its own chip.
 *
 * `MARKETPLACE_LISTING_KINDS` already declares the family each sellable kind
 * belongs to, so the asset kinds (game, app, course, …) become chips verbatim.
 * The one `agent` kind is the exception: an agent somebody built and published
 * IS a community agent, and a chip labelled "Agent" sitting inside the Agents
 * family would only repeat the family's own name. It rides Community instead,
 * so that one grid shows both the registry's agents and the canvas's.
 */
const CREATION_CHIP: Record<string, string> = { agent: 'community' };

/** The chip a creation kind renders under. */
const chipFor = (kindId: string) => CREATION_CHIP[kindId] ?? kindId;

/**
 * A family's kind chips: the ones its own sections have always rendered, plus
 * the sellable canvas kinds the listing registry files under it.
 *
 * Read from the registry rather than restated, because a second hand-written
 * list of kinds is exactly how the storefront ended up with TWO kind filters —
 * one governing the canvas feed and one governing everything else — and a
 * visitor picking "Course" watching the agents below ignore them.
 */
function familyKinds(family: FamilyId, own: readonly string[]): string[] {
  return Array.from(new Set([
    ...own,
    ...MARKETPLACE_LISTING_KINDS.filter((spec) => spec.family === family).map((spec) => chipFor(spec.id)),
  ]));
}

/**
 * The creation listing kind a given (family, kind) chip filters the canvas feed
 * by, or null when the chip is not a creations view at all.
 *
 * ONE derivation, so the chip a person presses and the `kind` the browse call
 * sends cannot disagree.
 */
export function creationKindForChip(family: FamilyId, kind: string): string | null {
  return MARKETPLACE_LISTING_KINDS
    .find((spec) => spec.family === family && chipFor(spec.id) === kind)?.id ?? null;
}

/**
 * The catalogue key a kind chip's label comes from.
 *
 * A canvas kind is named by the listing vocabulary that DEFINES it, and every
 * other kind by the family bar's own copy. One derivation rather than two,
 * because the alternative is the same twelve labels living in two namespaces —
 * and a kind renamed in one of them keeping its old name in the other. The
 * message test asserts against this function, so a chip can never render a key
 * the catalogs do not carry.
 */
export function kindLabelKey(kind: string): string {
  return LISTING_KIND_IDS.includes(kind)
    ? `marketplaceCreations.kind.${kind}`
    : `marketplace.family.kind.${kind}`;
}

export const FAMILIES: Record<FamilyId, MarketplaceFamily> = {
  talent: {
    id: 'talent',
    labelKey: 'talent',
    publishKey: 'publishTalent',
    flow: 'listing',
    hueVar: '--seat-manager',
    kinds: ['person', 'gig'],
    noteKey: 'note.talent',
  },
  company: {
    id: 'company',
    labelKey: 'company',
    publishKey: 'publishCompany',
    flow: 'claim',
    hueVar: '--seat-cmo',
    kinds: ['business', 'storefront'],
    noteKey: 'note.company',
  },
  agent: {
    id: 'agent',
    labelKey: 'agent',
    publishKey: 'publishAgent',
    flow: 'agent',
    hueVar: '--seat-cfo',
    kinds: familyKinds('agent', ['builtin', 'community']),
    noteKey: 'note.agent',
  },
  asset: {
    id: 'asset',
    labelKey: 'asset',
    publishKey: 'publishAsset',
    flow: 'asset',
    hueVar: '--seat-ceo',
    kinds: familyKinds('asset', ['model', 'skill', 'persona', 'knowledge']),
    noteKey: 'note.asset',
  },
};

export const FAMILY_IDS = Object.keys(FAMILIES) as FamilyId[];

export function isFamilyId(value: string): value is FamilyId {
  return value in FAMILIES;
}

/**
 * The legacy `?category=` values, mapped onto (family, kind).
 *
 * Old links are everywhere — the freelancer nav, the tutorial CTAs, the blog,
 * saved bookmarks — and breaking them to rename a tab would be a poor trade. A
 * data table rather than a branch, so a fifth legacy value is a row.
 */
const LEGACY_CATEGORY: Record<string, { family: FamilyId; kind?: string }> = {
  all: { family: 'talent' },
  talent: { family: 'talent', kind: 'person' },
  gigs: { family: 'talent', kind: 'gig' },
  workforce: { family: 'agent', kind: 'community' },
  agents: { family: 'agent', kind: 'community' },
  models: { family: 'asset', kind: 'model' },
  skills: { family: 'asset', kind: 'skill' },
  personas: { family: 'asset', kind: 'persona' },
  knowledge: { family: 'asset', kind: 'knowledge' },
  // `publish` was never a category — it is the verb, and it is a button now.
  publish: { family: 'talent' },
};

export function familyFromLegacyCategory(category: string | null): { family: FamilyId; kind?: string } | null {
  if (!category) return null;
  return LEGACY_CATEGORY[category] ?? null;
}

/** Resolve the active family + kind from the URL, tolerating both vocabularies. */
export function resolveFamily(familyParam: string | null, kindParam: string | null, categoryParam: string | null): {
  family: FamilyId;
  kind: string;
} {
  if (familyParam && isFamilyId(familyParam)) {
    const family = FAMILIES[familyParam];
    const kind = kindParam && family.kinds.includes(kindParam) ? kindParam : family.kinds[0];
    return { family: familyParam, kind };
  }
  const legacy = familyFromLegacyCategory(categoryParam);
  if (legacy) {
    const family = FAMILIES[legacy.family];
    return { family: legacy.family, kind: legacy.kind ?? family.kinds[0] };
  }
  return { family: 'agent', kind: FAMILIES.agent.kinds[0] };
}
