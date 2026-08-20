/**
 * THE marketing-object specification — the brand a board composes against, and the
 * audience a send may lawfully reach.
 *
 * `marketing.ts` in the contract argues why these two are their own vocabulary, why the
 * brand is a bindable OBJECT rather than a canvas setting, and why there is no
 * `campaignCalendar` kind beside the calendar surface. That argument is not repeated
 * here. What this file owns is the SHAPE of each card and which numbers are DERIVED.
 *
 * ── WHY ALMOST EVERY NUMBER ON `audience` IS DERIVED ─────────────────────────────
 * This is the card a person looks at immediately before mailing several thousand people.
 * An authored `size` is a number somebody typed once and never corrected; an authored
 * `suppressedCount` is worse, because it is the field whose wrongness is a legal
 * exposure rather than an embarrassment. So `size`, `suppressedCount` and
 * `sendableCount` are all written by the hydration tool that read the server, marked
 * `derived` so no LLM patch can assert them, and `sendable` is computed from the other
 * two by the SAME function the send control reads (`sendableCount` in the contract) so
 * the number printed on the card cannot disagree with the number that decides whether
 * the button is enabled.
 *
 * ── THE ONE THING THAT IS AUTHORED, AND WHY ──────────────────────────────────────
 * `consentBasis` is authored, and deliberately: no server column records WHY a list was
 * collected — `marketing_audience_members.source` records HOW ('manual', an import, a
 * form) and those are not the same question. The lawful basis is a fact about a business
 * process that only a person knows, and it defaults to `unknown`, which the send
 * readiness treats as a blocker. A card that guessed `optIn` from an import would
 * manufacture the exact consent record it exists to demand.
 */

import {
  AUDIENCE_CONSENT_BASES, BRAND_BINDING_FIELD, BRAND_BOUND_KINDS, brandRefKey, sendableCount,
  type MarketingObjectKind,
} from '@builderforce/creation-canvas-contract';
import {
  deriveNumber, registerSpecObjectSet, SOURCES_FIELD, SUMMARY_FIELD,
  type SpecObjectSpec,
} from './specObjects';

/** i18n namespace for every marketing label, status, field and column. */
export const MARKETING_NAMESPACE = 'creationCanvas.marketing';

const ISO_DATE = 'An ISO date (YYYY-MM-DD) or full instant.';

/**
 * The hint every `brandKitRef` carries, written once.
 *
 * Repeated onto seventeen brand-bound kinds by the registry rather than retyped, because
 * a binding described seventeen slightly different ways is seventeen chances for a model
 * to decide this one means something else.
 */
export const BRAND_BINDING_HINT = 'The `brandKit` card this artifact composes against, by its title. Leave empty on a board with exactly one brand kit — the single kit is used automatically. Naming a kit that is not on the board does NOT fall back to the other one: an unresolved binding composes unbranded rather than silently borrowing the wrong identity.';

/** The consent vocabulary, restated for the model with what each one actually permits. */
const CONSENT_HINT = `The lawful basis this list was collected under: ${AUDIENCE_CONSENT_BASES.join(' | ')}. Only \`optIn\` and \`doubleOptIn\` are evidence of an affirmative act by the person, and only those two let the board fire a send. \`legitimateInterest\` and \`contractual\` may well be defensible and are NOT consent; \`imported\` means a list arrived from somewhere and nobody has established which. NEVER infer this from how the members were loaded — an import is a mechanism, not a permission.`;

export const MARKETING_OBJECT_SPECS: readonly SpecObjectSpec[] = [
  // ── The brand, as a bindable thing ────────────────────────────────────────────
  {
    kind: 'brandKit',
    icon: '◐',
    group: 'Work',
    defaultStatus: 'drafting',
    actions: ['bind', 'apply'],
    fields: [
      {
        name: 'brandKitId', render: 'stat', label: 'brandKitId',
        hint: 'The `brand_kits` row this projects, by id. Empty for a kit authored on a guest board, which is most of them at first.',
        bookkeeping: true,
      },
      { name: 'palette', render: 'chips', label: 'palette', hint: 'The brand colours, PRIMARY FIRST, as hex or as design-token names. Order is meaning: the first entry is what a generated artifact leads with. Include the dark-ground variants too if the brand has them — a palette that only works on white is half a palette.' },
      { name: 'typography', render: 'chips', label: 'typography', hint: 'The faces, DISPLAY FIRST then body. Name them exactly as they are licensed ("Söhne", "Inter Tight") — a near-miss name is what makes a generated deck arrive in Arial.' },
      { name: 'logoUrl', render: 'reference', label: 'logoUrl', hint: 'Where the primary logo lives. A URL, never an inlined image: the local session snapshot serialises node data on every viewport change, and a base64 mark would put megabytes through it.' },
      { name: 'logoDarkUrl', render: 'reference', label: 'logoDarkUrl', hint: 'The mark for dark grounds. Its own field and never a filter over the light one — a logo that is legible inverted is a design decision somebody made, not an image operation.' },
      { name: 'voice', render: 'text', label: 'voice', hint: 'How this brand speaks, in the words the brand team actually uses. "Plain, specific, never breathless. We say what a thing does before we say what it means." Two sentences that a writer could follow beat a list of adjectives.' },
      {
        name: 'doNotSay', render: 'list', label: 'doNotSay',
        hint: 'Claims this brand may NEVER make, one per line, in the shortest wording that would still be recognisable — "HIPAA compliant", "the fastest", "guaranteed". Every generative object bound to this kit is instructed against these AND checked against them after the fact, so a phrase here is a phrase the board will refuse to publish. The board\'s `battlecard.doNotSay` entries are merged in automatically; do not copy them here.',
      },
      {
        name: 'boundObjects', render: 'stat', label: 'boundObjects',
        hint: 'How many objects on this board compose against this kit. Counted from the board, never typed — a kit that says it governs nine artifacts while governing none is the failure this whole binding exists to remove.',
        // Counted the SAME WAY `resolveBrandBinding` resolves: an explicit ref matching
        // this kit's title, plus — when this board holds exactly one kit — every
        // brand-bound object that named nothing, because on a single-brand board those
        // are governed by this kit. A count that ignored the implicit case would report
        // zero on precisely the boards where the binding is working.
        derive: (data, board) => {
          const kits = board.ofKind('brandKit');
          const mine = brandRefKey(data.title);
          const sole = kits.length === 1;
          let count = 0;
          for (const kind of BRAND_BOUND_KINDS) {
            for (const object of board.ofKind(kind)) {
              const ref = brandRefKey(object[BRAND_BINDING_FIELD]);
              if (ref ? ref === mine : sole) count += 1;
            }
          }
          return count;
        },
      },
      SOURCES_FIELD,
      SUMMARY_FIELD,
    ],
  },

  // ── Who a send reaches, and who it must not ───────────────────────────────────
  {
    kind: 'audience',
    icon: '◔',
    group: 'Integrations',
    defaultStatus: 'notCounted',
    actions: ['refresh', 'bind'],
    fields: [
      {
        name: 'audienceId', render: 'stat', label: 'audienceId',
        hint: 'The `marketing_audiences` row this projects, by id. THE MEMBERS LIVE THERE and are never copied onto the card: a board holding several thousand email addresses is a board that has become a personal-data store with no access control on a guest surface.',
        bookkeeping: true,
      },
      { name: 'rules', render: 'rows', label: 'rules', columns: ['field', 'operator', 'value'], hint: 'One row per segment rule: {field, operator, value}. Rules are ANDed. This is the DEFINITION of who is in the audience; the counts below are what the server said when it was last asked to evaluate it.' },
      { name: 'consentBasis', render: 'stat', label: 'consentBasis', hint: CONSENT_HINT },
      { name: 'consentEvidence', render: 'text', label: 'consentEvidence', hint: 'Where the consent record lives — the form, the checkbox wording, the contract clause, the date of the double opt-in confirmation. The field an audit asks for, and the one nobody can reconstruct two years later.' },
      {
        name: 'size', render: 'stat', label: 'size',
        hint: 'Members in this audience, as the server last counted them. Written by the refresh, never typed.',
        derived: true,
      },
      {
        name: 'suppressedCount', render: 'stat', label: 'suppressedCount',
        hint: 'How many of those members are on the tenant-wide do-not-contact list. Written by the refresh, never typed. ABSENT is not zero: absent means nobody has asked, and the board refuses a send until it has.',
        derived: true,
      },
      {
        name: 'sendableCount', render: 'stat', label: 'sendableCount',
        hint: 'Members who may actually be mailed — the size less the suppressions. Computed from the two numbers above by the same function the send control reads, so the count on the card and the count that decides whether the button is enabled cannot disagree.',
        derive: (data) => sendableCount(data.size, data.suppressedCount),
      },
      {
        name: 'suppressedShare', render: 'meter', label: 'suppressedShare',
        hint: 'Suppressions as a share of the audience, 0-100. Over about 10% is a list that has been mailed too often rather than a list with a compliance problem, and the two need opposite fixes.',
        derive: (data) => {
          const total = deriveNumber(data.size);
          const blocked = deriveNumber(data.suppressedCount);
          if (!total || total <= 0 || blocked == null) return undefined;
          return Math.min(100, Math.round((blocked / total) * 1000) / 10);
        },
      },
      { name: 'refreshedAt', render: 'stat', label: 'refreshedAt', hint: `When the counts above were last read from the server. ${ISO_DATE} A count from three weeks ago is a count, not an answer.`, derived: true },
      SOURCES_FIELD,
      SUMMARY_FIELD,
    ],
  },
];

/** English fallbacks the palette shows before `creationCanvas.marketing.label.*` resolves. */
export const MARKETING_LABELS: Record<MarketingObjectKind, string> = {
  brandKit: 'Brand kit',
  audience: 'Audience',
};

/**
 * Blank-object status fallbacks under `creationCanvas.marketing.status.*`.
 *
 * `notCounted` rather than `Ready`, for the reason the whole audience card exists: a
 * blank audience that read "Ready" would be a card asserting it is safe to mail before
 * anybody has counted it or checked a suppression list.
 */
export const MARKETING_STATUSES: Record<string, string> = {
  drafting: 'Drafting',
  notCounted: 'Not counted',
};

/** The one field name every brand-bound kind gains. Re-exported here so the registry has
 *  a single import site for the binding and its hint. */
export { BRAND_BINDING_FIELD };

registerSpecObjectSet({
  id: 'marketing',
  namespace: MARKETING_NAMESPACE,
  specs: MARKETING_OBJECT_SPECS,
});
