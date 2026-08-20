/**
 * THE founder-object specification — one declaration per kind, read by everything.
 *
 * ── WHAT THIS EXISTS TO PREVENT ──────────────────────────────────────────────────
 * The canvas grew to seventy-nine object kinds, and the cost of each one was paid four
 * times: a `createData` entry, a `MUTABLE_FIELDS` row, an entry in `CONTEXT_FIELDS`, and
 * a hand-written `{data.kind === 'x' && <XBody/>}` branch in a 138KB component. Those
 * four lists are maintained independently and they drift — `value`, `target`, `unit` and
 * `trend` were authorable on a `kpi` and absent from `CONTEXT_FIELDS`, so Brain could
 * write a KPI's number onto the board and could never read it back. The card showed a
 * number the model was blind to.
 *
 * The founder kinds are declared ONCE, here — `FOUNDER_OBJECT_KINDS` in the contract is the
 * list, and a test holds the two in step, which is why no count is written into this prose.
 * This module is the single source
 * for:
 *   • the node body           — `SpecObjectBody` renders these sections generically
 *   • the AI field contract   — `founderFieldGuidance()` documents them to the model
 *   • the registry            — `createData`, mutable fields and context fields are
 *                               DERIVED from `fields`, so a field cannot be authorable
 *                               and unreadable at the same time
 *   • the empty-shell rule    — a founder object with only a title is refused because
 *                               `contentFields` falls out of the same declaration
 *
 * Adding a founder kind is adding one entry below. There is no branch to forget.
 *
 * ── WHY THE RENDER STYLES ARE A CLOSED SET ───────────────────────────────────────
 * Seven styles cover every kind in the set, which is the point: a `capTable` and a
 * `customerSegment` are the same shape of thing on a board — a few headline numbers and
 * a table of rows — and rendering them with one component is what keeps a founder's
 * canvas looking like one product. A new kind that genuinely cannot be expressed in
 * these styles is a signal to add a style here, not a bespoke body elsewhere.
 *
 * User-facing labels are i18n KEY SUFFIXES resolved under `creationCanvas.founder.*`;
 * `hint` is model-facing and stays English, like every other tool description.
 */

import { scoreExperiment, type ExperimentVariantInput } from './canvasInference';
import {
  ACCELERATION_KINDS,
  ACCOUNT_RELATIONSHIPS,
  CONVERTIBLE_KINDS,
  EQUITY_INSTRUMENTS,
  VESTING_FREQUENCIES,
  type FounderObjectKind,
} from '@builderforce/creation-canvas-contract';
import {
  SOURCES_FIELD,
  SUMMARY_FIELD,
  deriveDaysBetween,
  deriveNumber,
  derivePercent,
  deriveRows,
  registerSpecObjectSet,
  specMutableFields,
  specRefKey,
  sumColumn,
  type SpecDeriveBoard,
  type SpecField,
  type SpecObjectSpec,
} from './specObjects';

/**
 * A founder field IS a spec field.
 *
 * ── WHY THIS IS AN ALIAS AND NOT A DECLARATION ──────────────────────────────────
 * It used to be its own interface — seven render styles, `columns`, `bookkeeping` —
 * written before `specObjects.ts` generalised the mechanism, and left behind after. The
 * two were structurally compatible, which is exactly what made the duplicate dangerous
 * rather than merely redundant: `registerSpecObjectSet` accepted these specs happily, so
 * nothing failed, and a capability added to `SpecField` was simply UNAVAILABLE here with
 * no error to say so. `deadline` was the one that made it visible — flagging a contract's
 * `renewsAt` failed to compile against a local type that had never heard of it, while
 * `restricted`, `derived` and `derive` had been quietly out of reach for the founder
 * vocabulary the whole time.
 *
 * The names survive because the file's own vocabulary reads better with them and its
 * existing importers use them; the TYPE is the shared one, so there is nothing left to
 * drift.
 */
export type FounderField = SpecField;
export type FounderFieldRender = SpecField['render'];

/** A founder spec, with the kind narrowed to the declared founder set — the one thing
 *  this vocabulary knows that the generic type cannot. */
export interface FounderObjectSpec extends SpecObjectSpec {
  kind: FounderObjectKind;
  /** Mirrors `CreationObjectGroup` in the registry; kept as a string union rather than
   *  imported to avoid a cycle. */
  group: 'Insights' | 'Work' | 'People' | 'Data' | 'Knowledge' | 'Collaborate';
}

/**
 * Money is WRITTEN as prose and READ as a number.
 *
 * The original rule was prose-only, and its reasoning was sound: a founder object
 * routinely holds a figure that is a range, an estimate, or explicitly unknown
 * ("~$2–4M ARR", "not disclosed"), and forcing those into an integer either loses the
 * qualifier or invents a precision the source never had — an invented precision in a
 * competitor analysis being exactly what the empty-shell rule exists to stop.
 *
 * The conclusion was wrong, because it made the CFO's most basic operation
 * UNREPRESENTABLE rather than merely unimplemented: a cap table could not be totalled,
 * `committed` could not be compared to `targetAmount`, and no two entities could be
 * consolidated. Every real figure left for a spreadsheet and came back as a screenshot.
 *
 * `canvasMoney.ts` resolves it without changing what the model writes: {@link
 * parseMoney} reads the SAME prose and yields `{amount, currency, approximate, low,
 * high, qualifier}`, so "~$2–4M ARR" is both a preserved qualifier and a real number,
 * and "not disclosed" is `disclosed: false` with NO amount — never a silent zero. So the
 * hint below is unchanged for the research kinds (write what the source said), while the
 * operational kinds added under "the money, operated" ask for a plain number plus a
 * `currency` field, because an invoice's amount is a fact and not a characterisation.
 */
const MONEY_HINT = 'A human-readable amount including its currency and any qualifier the source actually carried, e.g. "$1.2M ARR (2025 estimate)" or "not disclosed". Never invent a precise figure — it is parsed into a real number for totals, and "not disclosed" is preserved as undisclosed rather than counted as zero.';

/** For the operated kinds, where the number is a fact rather than a characterisation. */
const EXACT_MONEY_HINT = 'A plain number in major units (dollars, not cents) — no symbols, no "k"/"M" suffix, no commas. The currency lives in the `currency` field so this object can be totalled and consolidated. Leave it empty rather than estimating.';

const CURRENCY_FIELD: FounderField = {
  name: 'currency',
  render: 'stat',
  label: 'currency',
  hint: 'ISO-4217 code for every amount on this object, e.g. "USD", "EUR", "GBP". One currency per object — a mixed-currency total is refused rather than silently added.',
};

// `SOURCES_FIELD` and `SUMMARY_FIELD` are imported from `specObjects.ts`. They were
// declared here too, byte-identical, which is the same duplicate the type alias above
// removes: two constants that agreed until somebody improved one of them.

/**
 * The counterparty instruction, declared ONCE for the fields that used to be three
 * independent string matches.
 *
 * ── WHY ONE CONSTANT AND NOT THREE HINTS ────────────────────────────────────────
 * `invoice.customer`, `bill.vendor` and `contract.counterparty` each told the model to
 * "match it to a `company`, `salesContact` or `contract` on the board where one
 * exists". Three fields, three slightly different instructions, three chances for a
 * trailing "Ltd" to produce a second Acme. The instruction is one instruction, so it is
 * one constant, and a fourth counterparty field costs a reference rather than a fourth
 * paraphrase.
 *
 * ── WHAT THIS DOES AND DOES NOT DO ──────────────────────────────────────────────
 * It points all three at ONE object — the `account` kind below — instead of at three
 * different ones. The typed FIELD that carries an account's id alongside the display
 * name is the next step and is deliberately not here: binding four call sites through a
 * shared resolver, with a read-time fallback that leaves an existing board's string
 * values readable, is its own change. What this closes is the part that made that change
 * impossible: there was no object to point at.
 */
export const COUNTERPARTY_HINT = 'The legal name of the counterparty, as it appears on the paperwork. Where an `account` object for them is on this board, use that account\'s title verbatim — it is the ONE object every commercial reference points at, so matching it is what joins this to their other invoices, their contract and their renewal. Author the account first if it is missing.';

/**
 * THE shared resolver `invoice.customer`, `bill.vendor`, `contract.counterparty` and
 * `placement.client` bind through — one match rule instead of four call sites each
 * inventing their own.
 *
 * ── WHY THIS IS A LIVE LOOKUP AND NOT A STORED ID ────────────────────────────────
 * `party_roles` already holds the counterparty; a second id column on every invoice,
 * bill, contract and placement would be the same fact stored twice, and the two would
 * disagree the day an account is renamed. So the join happens at READ time, off the
 * display name the field already carries — which is also the read-time fallback the
 * roadmap calls for: a board saved yesterday has only the string, and resolving it live
 * against whichever `account` objects exist today costs nothing extra and loses nothing.
 *
 * Matches on the account's title first (`byRef`, case/space-insensitive), then on
 * `alsoKnownAs` — the list that exists precisely so a second account is not created for
 * a company already on the board under a different name.
 */
export function resolveCounterpartyAccount(label: unknown, board: SpecDeriveBoard): Record<string, unknown> | null {
  const name = typeof label === 'string' ? label.trim() : '';
  if (!name) return null;
  const direct = board.byRef('account', name);
  if (direct) return direct;
  const key = name.toLowerCase();
  return board.ofKind('account').find((account) => {
    const aliases = Array.isArray(account.alsoKnownAs) ? account.alsoKnownAs : [];
    return aliases.some((alias) => typeof alias === 'string' && alias.trim().toLowerCase() === key);
  }) ?? null;
}

/**
 * THE resolver shape a "this object points at that one" field takes.
 *
 * ── WHY THIS IS ONE HELPER AND NOT THREE SIMILAR DERIVATIONS ────────────────────
 * `counterpartyAccountField` was written first and was the whole pattern: read a
 * REFERENCE off this object, find the ONE board object it names, and render either what
 * was found or an honest sentence saying nothing was. FO-G2 needed the identical shape
 * twice more — an invoice and a bill each resolving the `contract` they were raised
 * under — and three copies of "trim the ref, look it up, apologise if it is missing"
 * would have been three chances for one of them to fail SILENTLY instead, which is the
 * one behaviour that must not vary: a bill whose contract cannot be found and which
 * draws no section at all reads as a bill nobody needed to check.
 *
 * READ-ONLY and `derive`d rather than authored, for the reason the counterparty field
 * carried from the start: the resolution is a fact about the BOARD (which accounts, which
 * contracts exist right now), not about the object it renders on — storing it would be
 * the drift `SpecField.derive` exists to prevent. Absent entirely when the source field
 * is empty, so a card with no reference yet does not draw a section telling it so.
 *
 * `resolve` defaults to `board.byRef`, which matches on the target's title and then on
 * its identifying keys (`reference` among them — see `REF_KEYS` in `specObjects.ts`).
 * The counterparty case overrides it because an `account` also answers to every name in
 * its `alsoKnownAs` list, which is a rule about accounts and not about references.
 */
export function boardRefField(options: {
  /** The field name on the HOST object. */
  name: string;
  /** i18n key suffix under `<namespace>.field`. */
  label: string;
  /** Which authored field on the host carries the reference. */
  sourceField: string;
  /** Which kind the reference names. Quoted verbatim in the not-found sentence. */
  targetKind: string;
  hint: string;
  /** How to find the target. Defaults to `board.byRef(targetKind, ref)`. */
  resolve?: (ref: string, board: SpecDeriveBoard) => Record<string, unknown> | null;
  /** What to say once it IS found. The not-found sentence is not overridable — that is
   *  the half this helper exists to keep identical. */
  describe: (target: Record<string, unknown>, data: Record<string, unknown>, board: SpecDeriveBoard) => string;
}): FounderField {
  const { name, label, sourceField, targetKind, hint, resolve, describe } = options;
  return {
    name,
    render: 'verdict',
    label,
    hint,
    derived: true,
    derive: (data, board) => {
      const ref = typeof data[sourceField] === 'string' ? (data[sourceField] as string).trim() : '';
      if (!ref) return undefined;
      const target = resolve ? resolve(ref, board) : board.byRef(targetKind, ref);
      if (!target) return `No \`${targetKind}\` matches "${ref}" yet — author one to link this.`;
      return describe(target, data, board);
    },
  };
}

/**
 * The companion field a counterparty field carries its resolution through.
 *
 * One call of {@link boardRefField} since FO-G2. It kept its own name and its own
 * exported identity because four call sites already spell it that way and because
 * "resolve the counterparty" is the concept, not "resolve a reference" — but there is
 * nothing left in it that could disagree with the invoice-to-contract resolver about
 * what a missing target reads like.
 */
export function counterpartyAccountField(sourceField: string): FounderField {
  return boardRefField({
    name: `${sourceField}Account`,
    label: 'counterpartyAccount',
    sourceField,
    targetKind: 'account',
    hint: `READ-ONLY. Resolved automatically by matching \`${sourceField}\` against the \`account\` objects on this board — never author it directly.`,
    resolve: resolveCounterpartyAccount,
    describe: (account, data) => {
      const fallback = typeof data[sourceField] === 'string' ? (data[sourceField] as string).trim() : '';
      const title = typeof account.title === 'string' && account.title.trim() ? account.title.trim() : fallback;
      const relationship = typeof account.relationship === 'string' && account.relationship ? account.relationship : 'contact';
      const owner = typeof account.owner === 'string' ? account.owner.trim() : '';
      return owner
        ? `Linked to \`account\` "${title}" (${relationship}), owned by ${owner}.`
        : `Linked to \`account\` "${title}" (${relationship}).`;
    },
  });
}

// ---------------------------------------------------------------------------
// FO-G2 — the obligation, and the documents raised against it
// ---------------------------------------------------------------------------

/**
 * What a contractual obligation IS, as columns rather than as a sentence.
 *
 * ── WHY THESE EIGHT ─────────────────────────────────────────────────────────────
 * `{obligation, owner, due}` was prose in a table: it could say "invoice monthly for
 * support" and nothing anywhere could tell whether that had happened. An obligation
 * becomes actionable at exactly the point it carries (a) an identity something else can
 * point AT, (b) whether money moves and in which direction, (c) how much and how often,
 * and (d) whether it has been discharged. That is the whole list, and each column earns
 * its place by being the one that makes a specific question answerable:
 *
 *   `reference`  THE IDENTITY. Without it an invoice cannot name the obligation it
 *                satisfies, and the join falls back to matching prose — which is the
 *                exact defect FO-A1/FO-A2 removed from the counterparty. Unique within
 *                one contract; short enough to type ("SUPPORT-M", "MILESTONE-2").
 *   `obligation` What is actually owed, in a clause a reader recognises.
 *   `kind`       receivable | payable | deliverable | report | notice. ONE column and
 *                not a `kind`/`direction` pair, because the two facts are never
 *                independent: an obligation that generates an invoice is a receivable
 *                and one that arrives as a bill is a payable, while a deliverable, a
 *                report and a notice move no money at all and must never be counted as
 *                un-invoiced revenue.
 *   `owner`      The single person accountable. An obligation with nobody against it is
 *                a clause, not a commitment.
 *   `due`        ISO date this instance is judged against.
 *   `cadence`    once | monthly | quarterly | annual. What makes "invoice monthly"
 *                checkable against a `bill.recurring` of `annual`.
 *   `amount`     A plain number in the CONTRACT's currency, empty for a non-monetary
 *                obligation. Per-row currency is deliberately absent: `contract.currency`
 *                holds it once, which is the same one-currency-per-object rule every
 *                operated-money kind already states, and a mixed-currency contract is
 *                two contracts.
 *   `status`     pending | invoiced | met | waived | breached. `waived` is a real and
 *                common answer and is not the same as `met`.
 */
export const OBLIGATION_COLUMNS = ['reference', 'obligation', 'kind', 'owner', 'due', 'cadence', 'amount', 'status'] as const;

/** The obligation kinds that SHOULD produce a document, and which one. Everything else
 *  moves no money and must never be reported as un-invoiced. */
const OBLIGATION_DOCUMENT_KIND: Readonly<Record<string, 'invoice' | 'bill'>> = {
  receivable: 'invoice',
  payable: 'bill',
};

/**
 * The refs by which an invoice or a bill may name THIS contract.
 *
 * The mirror question `specRefKey` is exported for — not "which object does this ref
 * name" but "does this ref name me". `reference` first because it is the identity;
 * `title` too, because `SpecDeriveBoard.byRef` resolves a title and a board authored
 * before `contract.reference` existed has only that.
 */
function contractRefKeys(data: Record<string, unknown>): ReadonlySet<string> {
  return new Set([specRefKey(data.reference), specRefKey(data.title)].filter(Boolean));
}

/** A contract's display name, for a sentence rendered on some other card. */
function contractLabel(contract: Record<string, unknown>): string {
  const title = typeof contract.title === 'string' ? contract.title.trim() : '';
  const reference = typeof contract.reference === 'string' ? contract.reference.trim() : '';
  return title || reference || 'this contract';
}

/** `bill.recurring` says `none` where an obligation says `once`. One vocabulary at the
 *  comparison, so the two fields can keep the words their own readers use. */
function cadenceKey(value: unknown): string {
  const text = String(value ?? '').trim().toLowerCase();
  return text === 'none' ? 'once' : text;
}

/** The reference an invoice or a bill is known by, for naming it in a verdict. */
function documentLabel(document: Record<string, unknown>): string {
  for (const key of ['invoiceNumber', 'reference', 'title']) {
    const value = document[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return 'an untitled document';
}

/**
 * The field an `invoice` and a `bill` each carry to say which obligation they discharge.
 *
 * ONE builder for both, because the check is one check. The only real difference is that
 * a bill declares a recurrence (`recurring`) and an invoice does not, so `cadenceSource`
 * is a parameter rather than two near-identical derivations — and the confirming sentence
 * names only the axes actually compared, so an invoice never claims a cadence agreed that
 * nothing on it states.
 */
function contractObligationField(options: { host: 'invoice' | 'bill'; cadenceSource?: string }): FounderField {
  const { host, cadenceSource } = options;
  return boardRefField({
    name: 'contractObligation',
    label: 'contractObligation',
    sourceField: 'contractRef',
    targetKind: 'contract',
    hint: `READ-ONLY. Resolved by matching \`contractRef\` to a \`contract\` on this board and \`obligationRef\` to one of its obligation rows, then comparing what this ${host} actually says against what was agreed. Never author it — and never treat its silence as approval: a ${host} with no \`contractRef\` draws nothing here at all, which is the state to fix rather than the state to trust.`,
    describe: (contract, data) => {
      const label = contractLabel(contract);
      const rows = deriveRows(contract.obligations);
      const wanted = specRefKey(data.obligationRef);
      if (!wanted) {
        const available = rows.map((row) => String(row.reference ?? '').trim()).filter(Boolean);
        return available.length
          ? `Raised under contract "${label}", but no \`obligationRef\` says WHICH obligation it discharges. Set it to one of: ${available.join(', ')}.`
          : `Raised under contract "${label}", whose obligations carry no \`reference\` values — so nothing on this ${host} can be checked against what was agreed. Give each obligation a reference on the contract first.`;
      }
      const row = rows.find((candidate) => specRefKey(candidate.reference) === wanted);
      if (!row) {
        return `Contract "${label}" has NO obligation with the reference "${String(data.obligationRef).trim()}" — this is a charge with no matching obligation. Either the contract's obligations are out of date or this ${host} should not have been raised.`;
      }
      const named = String(row.obligation ?? row.reference ?? '').trim() || wanted;

      const problems: string[] = [];
      const checked: string[] = [];

      const agreedAmount = deriveNumber(row.amount);
      const actualAmount = deriveNumber(data.amount);
      if (agreedAmount !== undefined && actualAmount !== undefined) {
        checked.push('amount');
        if (Math.abs(agreedAmount - actualAmount) > 0.01) {
          problems.push(`the amount is ${actualAmount} where the obligation says ${agreedAmount}`);
        }
      }

      const drift = deriveDaysBetween(row.due, data.dueAt);
      if (drift !== undefined) {
        checked.push('date');
        if (drift !== 0) {
          problems.push(`it falls due ${Math.abs(drift)} day${Math.abs(drift) === 1 ? '' : 's'} ${drift > 0 ? 'after' : 'before'} the obligation's ${String(row.due).trim()}`);
        }
      }

      if (cadenceSource) {
        const agreedCadence = cadenceKey(row.cadence);
        const actualCadence = cadenceKey(data[cadenceSource]);
        if (agreedCadence && actualCadence) {
          checked.push('cadence');
          if (agreedCadence !== actualCadence) {
            problems.push(`it recurs ${actualCadence} where the obligation says ${agreedCadence}`);
          }
        }
      }

      if (problems.length) {
        return `Points at obligation "${named}" on contract "${label}", but ${problems.join('; ')}. Check it against the agreement before ${host === 'bill' ? 'approving or paying it' : 'issuing it'}.`;
      }
      return checked.length
        ? `Discharges obligation "${named}" on contract "${label}" — ${checked.join(', ')} agree${checked.length === 1 ? 's' : ''} with what was agreed.`
        : `Points at obligation "${named}" on contract "${label}". Nothing comparable is filled in on either side, so this is a link and not yet a check.`;
    },
  });
}

/** The `contractRef` an invoice and a bill each author. Declared once because the
 *  instruction is one instruction — see `COUNTERPARTY_HINT` for the same argument. */
function contractRefField(host: 'invoice' | 'bill'): FounderField {
  return {
    name: 'contractRef',
    render: 'stat',
    label: 'contractRef',
    hint: `The \`reference\` of the \`contract\` this ${host} is raised under — its reference verbatim, or its title where it has no reference yet. This is an EXPLICIT binding and not a guess: never infer it from the counterparty matching a contract's counterparty, because two agreements with one company is the normal case and the wrong one would be charged. Leave it empty for a ${host} that genuinely has no contract behind it, which is itself worth saying out loud.`,
  };
}

/** The `obligationRef` that says WHICH clause is being discharged. */
function obligationRefField(host: 'invoice' | 'bill'): FounderField {
  return {
    name: 'obligationRef',
    render: 'stat',
    label: 'obligationRef',
    hint: `The \`reference\` of the obligation row on that contract this ${host} discharges — one of the values in the contract's own \`obligations\` table. Without it the ${host} is joined to the contract and to none of its clauses, so "has the support fee been billed this quarter" stays unanswerable.`,
  };
}

export const FOUNDER_OBJECT_SPECS: readonly FounderObjectSpec[] = [
  // ── Who we are ────────────────────────────────────────────────────────────────
  {
    kind: 'company',
    icon: '⌂',
    group: 'Insights',
    defaultStatus: 'describeBusiness',
    actions: ['sync', 'research'],
    fields: [
      { name: 'legalName', render: 'stat', label: 'legalName', hint: 'Registered legal name, if it differs from the trading name in the title.' },
      { name: 'sector', render: 'stat', label: 'sector', hint: 'The industry the business actually sells into, in the words its buyers use.' },
      { name: 'stage', render: 'stat', label: 'stage', hint: 'idea | pre-seed | seed | series-a | growth | profitable.' },
      { name: 'headcount', render: 'stat', label: 'headcount', hint: 'Current full-time-equivalent headcount as an integer.' },
      { name: 'arr', render: 'stat', label: 'arr', hint: MONEY_HINT },
      { name: 'website', render: 'stat', label: 'website', hint: 'Primary marketing domain.' },
      { name: 'geography', render: 'chips', label: 'geography', hint: 'Markets served today, most important first, e.g. ["Florida", "Georgia"]. This is what a geographic analysis is scoped against.' },
      { name: 'offerings', render: 'list', label: 'offerings', hint: 'What the business sells: [{title, detail}] where detail names who it is for and what it costs.' },
      { name: 'differentiators', render: 'chips', label: 'differentiators', hint: 'The reasons a customer picks this business over the obvious alternative. Specific and checkable, never adjectives.' },
      SUMMARY_FIELD,
      SOURCES_FIELD,
    ],
  },
  // ── Who we are against ────────────────────────────────────────────────────────
  {
    kind: 'competitor',
    icon: '⚔',
    group: 'Insights',
    defaultStatus: 'researching',
    actions: ['research', 'map', 'battlecard'],
    fields: [
      { name: 'website', render: 'stat', label: 'website', hint: 'Primary domain. Use it to verify every other claim.' },
      { name: 'headquarters', render: 'stat', label: 'headquarters', hint: 'City, state of the head office.' },
      { name: 'estimatedRevenue', render: 'stat', label: 'estimatedRevenue', hint: MONEY_HINT },
      { name: 'employeeRange', render: 'stat', label: 'employeeRange', hint: 'Reported headcount band, e.g. "50-200".' },
      { name: 'positioning', render: 'text', label: 'positioning', hint: 'How they describe themselves to a buyer, close to their own words.' },
      {
        name: 'locations',
        render: 'rows',
        label: 'locations',
        columns: ['name', 'city', 'region', 'lat', 'lng'],
        hint: 'Physical presence, one row per site: {name, city, region, lat, lng}. `lat`/`lng` are decimal degrees — resolve them with builtin_geo_geocode and never estimate them, because canvas_map_competitors plots these coordinates and a guessed one puts a rival in the ocean.',
      },
      { name: 'pricingModel', render: 'text', label: 'pricingModel', hint: 'How they charge, with real figures where published, and "not published" where not.' },
      { name: 'strengths', render: 'chips', label: 'strengths', hint: 'What they genuinely do well. A competitor analysis with no strengths listed is flattery, not analysis.' },
      { name: 'weaknesses', render: 'chips', label: 'weaknesses', hint: 'Verifiable gaps — from reviews, pricing pages, coverage maps. These become the wedge in a battlecard, so a soft one wastes the whole strategy.' },
      { name: 'segmentsServed', render: 'chips', label: 'segmentsServed', hint: 'Which customer segments they actually serve today.' },
      SUMMARY_FIELD,
      SOURCES_FIELD,
    ],
  },
  // ── Who we sell to ────────────────────────────────────────────────────────────
  {
    kind: 'customerSegment',
    icon: '◕',
    group: 'Insights',
    defaultStatus: 'sizing',
    actions: ['size', 'target'],
    fields: [
      { name: 'sizeEstimate', render: 'stat', label: 'sizeEstimate', hint: 'How many buyers are in this segment, with the basis in brackets, e.g. "~4,200 firms (FL SoS registrations, 2025)".' },
      { name: 'valueEstimate', render: 'stat', label: 'valueEstimate', hint: MONEY_HINT },
      { name: 'fitScore', render: 'meter', label: 'fitScore', hint: '0-100: how well this segment matches what the company can actually deliver today. Justify it in `summary`.' },
      { name: 'geography', render: 'chips', label: 'geography', hint: 'Where these buyers are, specific enough to act on — metro areas, not "the south".' },
      { name: 'pains', render: 'list', label: 'pains', hint: 'The problems that make them buy: [{title, detail}]. Sourced from interviews or reviews wherever possible.' },
      { name: 'buyingTriggers', render: 'chips', label: 'buyingTriggers', hint: 'Events that start a purchase — a renewal, a regulation, a hire, an outage.' },
      { name: 'channels', render: 'chips', label: 'channels', hint: 'Where this segment can actually be reached. Must be consistent with the linked gtmPlan.' },
      { name: 'currentProvider', render: 'chips', label: 'currentProvider', hint: 'Who they buy from today. Naming a competitor here is what makes a switch strategy targetable.' },
      SUMMARY_FIELD,
      SOURCES_FIELD,
    ],
  },
  {
    kind: 'gtmPlan',
    icon: '➤',
    group: 'Work',
    defaultStatus: 'draft',
    actions: ['review', 'plan'],
    fields: [
      { name: 'motion', render: 'stat', label: 'motion', hint: 'The dominant motion: self-serve | inside-sales | field-sales | partner-led | community-led.' },
      { name: 'salesCycleDays', render: 'stat', label: 'salesCycleDays', hint: 'Typical days from first touch to closed-won, as an integer.' },
      { name: 'targetCac', render: 'stat', label: 'targetCac', hint: MONEY_HINT },
      { name: 'targetLtv', render: 'stat', label: 'targetLtv', hint: MONEY_HINT },
      { name: 'segments', render: 'chips', label: 'segments', hint: 'Titles of the customerSegment objects this plan targets. Keep them identical to the segment titles on the board so the two objects stay joined.' },
      { name: 'channels', render: 'rows', label: 'channels', columns: ['channel', 'motion', 'cost', 'expected'], hint: 'One row per channel: {channel, motion, cost, expected}. `expected` is the outcome you would call success.' },
      { name: 'offer', render: 'text', label: 'offer', hint: 'The specific offer that opens a conversation — the thing said in the first message, not the value proposition.' },
      { name: 'proofPoints', render: 'chips', label: 'proofPoints', hint: 'Evidence a sceptical buyer would accept: named customers, measured outcomes, certifications.' },
      SUMMARY_FIELD,
      SOURCES_FIELD,
    ],
  },
  {
    kind: 'battlecard',
    icon: '⛊',
    group: 'Work',
    defaultStatus: 'draft',
    actions: ['review', 'deliver'],
    fields: [
      { name: 'againstCompetitor', render: 'stat', label: 'againstCompetitor', hint: 'The exact title of the competitor object this card is written against. A battlecard with no named rival is a positioning doc.' },
      { name: 'wedge', render: 'verdict', label: 'wedge', hint: 'The ONE weakness being attacked, in a sentence. This is the whole strategy; everything else supports it.' },
      { name: 'targetSegments', render: 'chips', label: 'targetSegments', hint: 'Which of their customers to go after first — the segments where the wedge bites hardest.' },
      { name: 'switchTriggers', render: 'chips', label: 'switchTriggers', hint: 'Moments when their customer is reachable: renewal dates, price rises, outages, acquisitions.' },
      { name: 'talkTrack', render: 'list', label: 'talkTrack', hint: 'What to actually say: [{title, detail}] where title is the situation and detail is the line.' },
      { name: 'objections', render: 'rows', label: 'objections', columns: ['objection', 'response', 'evidence'], hint: 'One row per likely objection: {objection, response, evidence}. `evidence` must be something that exists.' },
      { name: 'switchOffer', render: 'text', label: 'switchOffer', hint: 'The concrete offer that lowers the cost of switching — migration help, overlap credit, a pilot.' },
      { name: 'doNotSay', render: 'chips', label: 'doNotSay', hint: 'Claims that are untrue, unprovable, or legally risky. A battlecard without this list gets someone in trouble.' },
      SUMMARY_FIELD,
      SOURCES_FIELD,
    ],
  },
  // ── The evidence ──────────────────────────────────────────────────────────────
  {
    kind: 'customerInterview',
    icon: '☏',
    group: 'People',
    defaultStatus: 'scheduled',
    actions: ['record', 'synthesize'],
    fields: [
      { name: 'participant', render: 'stat', label: 'participant', hint: 'Role and company of the person, e.g. "Ops Director, mid-size FL contractor". Use a role rather than a name unless consent to record it is explicit.' },
      { name: 'segment', render: 'stat', label: 'segment', hint: 'Title of the customerSegment this person belongs to.' },
      { name: 'heldAt', render: 'stat', label: 'heldAt', hint: 'ISO date the conversation happened.' },
      { name: 'questions', render: 'list', label: 'questions', hint: 'What was asked and what came back: [{title, detail}].' },
      { name: 'painsHeard', render: 'chips', label: 'painsHeard', hint: 'Problems the participant raised UNPROMPTED. These are worth more than answers to your own questions, so keep them separate.' },
      { name: 'quotes', render: 'list', label: 'quotes', hint: 'Verbatim lines worth reusing. Never paraphrase into a quote.' },
      { name: 'verdict', render: 'verdict', label: 'verdict', hint: 'What this conversation changed: confirmed, contradicted, or left the assumption untested.' },
      SUMMARY_FIELD,
      SOURCES_FIELD,
    ],
  },
  {
    kind: 'experiment',
    icon: '⚗',
    group: 'Data',
    defaultStatus: 'designing',
    actions: ['run', 'evaluate'],
    fields: [
      { name: 'hypothesis', render: 'verdict', label: 'hypothesis', hint: '"If we <change>, then <metric> moves <direction> because <reason>." An experiment without a falsifiable hypothesis is a change.' },
      { name: 'primaryMetric', render: 'stat', label: 'primaryMetric', hint: 'The ONE metric that decides it. Naming two is how an experiment is declared a success afterwards.' },
      { name: 'sampleSize', render: 'stat', label: 'sampleSize', hint: 'Units observed, as an integer.' },
      { name: 'result', render: 'stat', label: 'result', hint: 'The measured outcome, with its confidence where one was computed.' },
      {
        name: 'abTestKey', render: 'stat', label: 'abTestKey',
        // ── THE BINDING THAT MAKES "WE TESTED IT" MEAN SOMETHING ─────────────────
        // `growth.ts` has had `ab_tests`, `ab_test_variants` and `ab_test_segments`
        // since the domain landed, and this card's `variants` table was AUTHORED: a
        // place to type numbers you got somewhere else. That is the empty-shell defect
        // `emptyShellProblem()` exists to stop, reappearing one level up as a
        // CREDIBILITY shell — an object whose fields are all filled and whose contents
        // nothing produced. Naming the test binds the card to the live split, and
        // `builtin_canvas_bind_ab_test` overwrites `variants` with what the split
        // actually measured.
        hint: 'The `ab_tests.key` this experiment is bound to. When set, `variants` is REPLACED by the live split\'s own exposure and conversion counts on every refresh and must not be hand-edited. Empty means the numbers below were typed, which `evidence` will say out loud.',
        bookkeeping: true,
      },
      { name: 'trafficAllocation', render: 'rows', label: 'trafficAllocation', columns: ['variant', 'percent'], hint: 'How traffic is split, one row per arm. Written by the binding from `ab_test_variants.traffic_percent`; on an unbound experiment it is the allocation you INTEND, which is worth recording because an intended 50/50 that ran 90/10 is the most common reason a result is wrong.', derived: true },
      { name: 'variants', render: 'rows', label: 'variants', columns: ['variant', 'exposure', 'conversion', 'lift'], hint: 'One row per variant: {variant, exposure, conversion, lift}. The FIRST row is the control — every other row is tested against it. On a BOUND experiment these are the live split\'s counts and are overwritten on refresh; on an unbound one they are authored.' },
      {
        name: 'evidence', render: 'verdict', label: 'evidence',
        hint: 'COMPUTED. Where the numbers under this experiment came from. An experiment nobody bound to a live split is a report, and saying so on the card is the difference between a measurement and a claim.',
        derive: (data) => {
          const bound = String(data.abTestKey ?? '').trim();
          const rows = deriveRows(data.variants);
          if (!rows.length) return undefined;
          if (bound) return `Bound to the live split "${bound}" — every exposure and conversion below was counted by the platform, not entered.`;
          return 'AUTHORED. Nothing produced these numbers: they were typed onto the card. Bind this experiment to an `ab_tests` key before quoting the result as a measurement.';
        },
      },
      {
        name: 'significance',
        render: 'verdict',
        label: 'significance',
        // The credibility half. `variants` was an AUTHORED table with a `lift` column
        // somebody typed, and nothing anywhere asked whether the lift was real — so
        // n=12 and n=1.2M rendered identically and "we tested it" resolved to a number
        // with no denominator behind it. `canvasInference` had the two-proportion test
        // written and tested and NO consumer, which is the same defect one level up.
        // Computed from the rows printed directly beneath it, so it cannot disagree
        // with them.
        hint: 'COMPUTED. Whether each variant beats the control by more than noise, with its p-value and interval.',
        derive: (data) => {
          const rows = deriveRows(data.variants);
          if (rows.length < 2) return undefined;
          const scored = scoreExperiment(rows as ExperimentVariantInput[]);
          const control = scored[0];
          if (!control || control.rate == null) return undefined;
          const compared = scored.slice(1).filter((row) => row.test);
          if (!compared.length) return undefined;
          const parts = compared.map((row) => {
            const test = row.test!;
            // `absoluteLift` and not a `difference`/`level` pair: `ProportionTest`
            // reports the lift in RATE POINTS and its own interval, and there is no
            // confidence level on the result to quote — the interval IS the
            // statement. Naming fields the type never had is how a card comes to
            // render "NaNpp real at NaN%" beside a real p-value.
            const direction = test.absoluteLift >= 0 ? 'up' : 'down';
            const points = Math.abs(Math.round(test.absoluteLift * 1000) / 10);
            return test.significant
              ? `${row.variant} is ${direction} ${points}pp on the control (p=${test.pValue}), interval ${Math.round(test.interval.low * 1000) / 10} to ${Math.round(test.interval.high * 1000) / 10}pp.`
              : `${row.variant} is within noise of the control (p=${test.pValue}); n is too small to call.`;
          });
          const anyReal = compared.some((row) => row.test!.significant);
          const lead = anyReal ? '' : 'NOTHING here is significant yet. ';
          return `${lead}${parts.join(' ')}`;
        },
      },
      { name: 'verdict', render: 'verdict', label: 'verdict', hint: 'shipped | rejected | inconclusive, and the reason. "Inconclusive" is a real and common answer.' },
      SUMMARY_FIELD,
      SOURCES_FIELD,
    ],
  },
  // ── What we chose, and what we are aiming at ──────────────────────────────────
  {
    kind: 'decision',
    icon: '⚖',
    group: 'Work',
    defaultStatus: 'open',
    actions: ['decide', 'revisit'],
    fields: [
      { name: 'question', render: 'verdict', label: 'question', hint: 'The decision being made, as a question with a real fork in it.' },
      { name: 'chosen', render: 'stat', label: 'chosen', hint: 'The option taken. Empty while the decision is still open.' },
      { name: 'decidedBy', render: 'stat', label: 'decidedBy', hint: 'Who actually decided.' },
      { name: 'decidedAt', render: 'stat', label: 'decidedAt', hint: 'ISO date.' },
      { name: 'reversibility', render: 'stat', label: 'reversibility', hint: 'one-way | reversible | cheap-to-reverse. This is what says how much deliberation the decision deserved.' },
      { name: 'options', render: 'rows', label: 'options', columns: ['option', 'upside', 'risk', 'cost'], hint: 'Every option considered, including the ones rejected: {option, upside, risk, cost}. A decision log with one option recorded is a note.' },
      { name: 'rationale', render: 'text', label: 'rationale', hint: 'Why this option, in terms of what was known AT THE TIME. This is the field the whole object exists for.' },
      { name: 'revisitWhen', render: 'chips', label: 'revisitWhen', hint: 'Conditions that should reopen this — the facts whose change would flip the answer.' },
      SOURCES_FIELD,
    ],
  },
  {
    // `decision`'s sibling durable artifact — see its own note in the contract's kind
    // list. A risk is re-scored over a project's life rather than decided once, so
    // `likelihood`/`impact` are the fields a review actually revisits, not a one-time
    // verdict.
    kind: 'risk',
    icon: '⚠',
    group: 'Work',
    defaultStatus: 'open',
    actions: ['review', 'mitigate'],
    fields: [
      { name: 'description', render: 'verdict', label: 'description', hint: 'What could go wrong, stated plainly enough that someone outside the project understands the exposure.' },
      { name: 'likelihood', render: 'stat', label: 'likelihood', hint: 'low | medium | high. Re-scored at every review, not set once.' },
      { name: 'impact', render: 'stat', label: 'impact', hint: 'low | medium | high — the cost if this actually happens.' },
      { name: 'owner', render: 'stat', label: 'owner', hint: 'The single person accountable for watching and mitigating this. Not a team.' },
      { name: 'mitigation', render: 'text', label: 'mitigation', hint: 'The plan to reduce the likelihood or the impact — not a hope that it will not happen.' },
      { name: 'reviewedAt', render: 'stat', label: 'reviewedAt', hint: 'ISO date of the last likelihood/impact re-score.' },
      SOURCES_FIELD,
    ],
  },
  {
    kind: 'objective',
    icon: '◎',
    group: 'Work',
    defaultStatus: 'draft',
    actions: ['review', 'link'],
    fields: [
      { name: 'owner', render: 'stat', label: 'owner', hint: 'The single person accountable. Not a team.' },
      { name: 'period', render: 'stat', label: 'period', hint: 'The window, e.g. "Q3 2026".' },
      { name: 'progress', render: 'meter', label: 'progress', hint: '0-100, derived from the key results rather than asserted.' },
      { name: 'keyResults', render: 'rows', label: 'keyResults', columns: ['result', 'baseline', 'target', 'current'], hint: 'One row per key result: {result, baseline, target, current}. Each must be a number that moves, not an activity that completes.' },
      { name: 'rationale', render: 'text', label: 'rationale', hint: 'Why this objective matters more than the alternatives this period.' },
      SOURCES_FIELD,
    ],
  },
  // ── The live half ─────────────────────────────────────────────────────────────
  {
    kind: 'liveMetric',
    icon: '↗',
    group: 'Data',
    defaultStatus: 'bindMetric',
    actions: ['refresh', 'bind', 'watch'],
    fields: [
      // Reuses the KPI value/target/unit/trend vocabulary deliberately: the two objects
      // answer the same question and differ only in whether the number re-reads.
      { name: 'value', render: 'stat', label: 'value', hint: 'The latest observed value. Written by canvas_refresh_live_metric, not authored by hand once a binding exists.' },
      { name: 'unit', render: 'stat', label: 'unit', hint: 'The unit the value is in, e.g. "months", "USD", "%".' },
      { name: 'target', render: 'stat', label: 'target', hint: 'The value that would mean this is healthy.' },
      { name: 'trend', render: 'stat', label: 'trend', hint: 'Direction and size of the recent move, e.g. "-1.4 vs 30d ago".' },
      {
        name: 'binding',
        render: 'stat',
        label: 'binding',
        hint: 'The domain metric key this object re-reads, e.g. "finance.runway_months", "revenue.pipeline", "growth.leads". This is what makes the object LIVE instead of a snapshot — set it and canvas_refresh_live_metric can answer the same question tomorrow.',
      },
      { name: 'series', render: 'rows', label: 'series', columns: ['at', 'value'], hint: 'Observed points: {at, value}. Written by the refresh, never authored.', bookkeeping: true },
      { name: 'fetchedAt', render: 'stat', label: 'fetchedAt', hint: 'ISO instant the value was last read. Rendered as staleness, so never fabricate it.', bookkeeping: true },
      SUMMARY_FIELD,
    ],
  },
  {
    kind: 'trigger',
    icon: '⚑',
    group: 'Data',
    defaultStatus: 'armed',
    actions: ['evaluate', 'mute'],
    fields: [
      // The examples are examples. The AUTHORITATIVE list is `deadlineBearingKinds()`,
      // which the trigger tool's own description is built from — this hint cannot call
      // it, because it is evaluated while this vocabulary is still registering and the
      // other vocabularies may not have loaded yet.
      { name: 'watches', render: 'stat', label: 'watches', hint: 'Title of the object on this board that this trigger evaluates — a `liveMetric` for a numeric comparator, or any deadline-bearing object for a date one (contract, invoice, bill, fundingRound, obligation, policy, offer, assignment, grant, peerReview, legalEntity, ipAsset, legalMatter among them; canvas_evaluate_triggers names the full list).' },
      { name: 'watchesField', render: 'stat', label: 'watchesField', hint: 'Which field on the watched object to read. Leave EMPTY unless the object has more than one deadline — the object\'s first declared deadline field is used, which is the right one for every kind that has only one.' },
      { name: 'comparator', render: 'stat', label: 'comparator', hint: 'For a number: below | above | equals | changes-by. For a deadline: due-within (breaches when the date is `threshold` days away or closer, INCLUDING already past — the "warn me before" case) | overdue-by (breaches only once the date is `threshold` days past; 0 means the day after it lapses — the "chase it" case).' },
      { name: 'threshold', render: 'stat', label: 'threshold', hint: 'The number the comparator tests against. For a date comparator this is a number of DAYS, never a date — the date lives on the object being watched, which is what keeps the trigger true next quarter without being re-typed.' },
      { name: 'state', render: 'verdict', label: 'state', hint: 'armed | breached | muted. Written by canvas_evaluate_triggers.', bookkeeping: true },
      { name: 'lastEvaluatedAt', render: 'stat', label: 'lastEvaluatedAt', hint: 'ISO instant of the last evaluation.', bookkeeping: true },
      { name: 'thenDo', render: 'list', label: 'thenDo', hint: 'What should happen on breach: [{title, detail}]. An alert nobody acts on is noise, so name the action and its owner.' },
      SUMMARY_FIELD,
    ],
  },
  // ── The money ─────────────────────────────────────────────────────────────────
  {
    kind: 'pricing',
    icon: '§',
    group: 'Work',
    defaultStatus: 'draft',
    actions: ['model', 'review'],
    fields: [
      { name: 'model', render: 'stat', label: 'pricingModel', hint: 'per-seat | usage | flat | tiered | value-based.' },
      { name: 'grossMargin', render: 'stat', label: 'grossMargin', hint: 'Gross margin as a percentage, with the cost basis stated in `summary`.' },
      { name: 'paybackMonths', render: 'stat', label: 'paybackMonths', hint: 'Months to recover acquisition cost.' },
      { name: 'tiers', render: 'rows', label: 'tiers', columns: ['tier', 'price', 'includes', 'target'], hint: 'One row per tier: {tier, price, includes, target}. `target` is which segment it is priced for.' },
      { name: 'unitEconomics', render: 'rows', label: 'unitEconomics', columns: ['metric', 'value', 'basis'], hint: 'CAC, LTV, contribution margin: {metric, value, basis}. `basis` names the assumption, which is the part that is actually load-bearing.' },
      { name: 'competitorPricing', render: 'rows', label: 'competitorPricing', columns: ['competitor', 'entry', 'mid', 'notes'], hint: 'What rivals charge: {competitor, entry, mid, notes}. Only from published pricing — mark inference as inference in `notes`.' },
      SUMMARY_FIELD,
      SOURCES_FIELD,
    ],
  },
  {
    // ── A PROJECTION, AS OF 0927 ────────────────────────────────────────────────
    //
    // This card used to be a hand-typed `holders` array whose own hint asked the
    // model to "say so in `summary`" when the percentages did not total 100 — an
    // object that documented its own inability to be right. Nothing on it can be
    // right by authoring, because a cap table is not a set of numbers somebody
    // agrees on: it is the FOLD of every issuance, transfer, cancellation,
    // exercise and conversion the company has ever recorded.
    //
    // So every figure below is either `derived` (written by `canvas_sync_cap_table`
    // from the real ledger) or `derive`d (computed here from those rows). There is
    // nothing left for a model to assert, which is the point: the percentages now
    // total 100 because they are one division by one denominator, not because
    // somebody was asked nicely.
    //
    // `companyRef` is the ONE authorable field, and it is the join — which company
    // this card is the cap table OF.
    kind: 'capTable',
    icon: '◱',
    group: 'Work',
    defaultStatus: 'draft',
    actions: ['sync', 'model'],
    fields: [
      {
        name: 'companyRef',
        render: 'stat',
        label: 'companyRef',
        hint: 'Which company this is the cap table of — lowercase and hyphenated, the same ref the `company` object and every `equityGrant` uses. The one field on this card you author; everything else is folded from the ledger by canvas_sync_cap_table.',
        bookkeeping: true,
      },
      {
        name: 'asOf',
        render: 'stat',
        label: 'asOf',
        hint: 'READ-ONLY. The instant this table was folded at. A past date is a real answer — "what did we own in March" is the same ledger with an earlier cutoff — so never treat an old `asOf` as staleness without checking whether it was asked for.',
        derived: true,
      },
      {
        name: 'holders',
        render: 'rows',
        label: 'holders',
        columns: ['holder', 'shareClass', 'instrument', 'shares', 'vested', 'percent'],
        hint: 'READ-ONLY. One row per holder per share class, folded from `equity_events` by canvas_sync_cap_table — never author it. `vested` is computed from that holder\'s grant schedule at `asOf`, so a founder two years into a four-year vest reads as half. If a holder is missing, the ledger has no event for them: record the grant, do not type a row.',
        derived: true,
      },
      {
        name: 'issued',
        render: 'stat',
        label: 'issued',
        hint: 'READ-ONLY. Shares actually issued and outstanding — options excluded, because an option is not a share until it is exercised.',
        derived: true,
      },
      {
        name: 'fullyDiluted',
        render: 'stat',
        label: 'fullyDiluted',
        hint: 'READ-ONLY. Issued plus every option, RSU and warrant plus the UNALLOCATED pool. The denominator every percentage on this card divides by.',
        derived: true,
      },
      {
        name: 'poolAuthorized',
        render: 'stat',
        label: 'poolAuthorized',
        hint: 'READ-ONLY. Shares authorised into the option pool by the board.',
        derived: true,
      },
      {
        name: 'poolUnallocated',
        render: 'stat',
        label: 'poolUnallocated',
        hint: 'READ-ONLY. Pool authorised minus pool granted — what is actually left to hire against, which is the number a founder is asked for and the one a typed cap table always got wrong.',
        derived: true,
      },
      {
        name: 'convertibles',
        render: 'rows',
        label: 'convertibles',
        columns: ['reference', 'holder', 'kind', 'principal', 'cap', 'discount'],
        hint: 'READ-ONLY. Outstanding SAFEs and notes. They are NOT in the percentages above and must never be added to them: what they become is not known until a round prices them. Model that with the `model` action rather than estimating it.',
        derived: true,
      },
      {
        name: 'ownershipCheck',
        render: 'verdict',
        label: 'ownershipCheck',
        // The replacement for the old prose instruction. It is arithmetic over the
        // rows printed directly beneath it, so it cannot disagree with them — and
        // it names the convertible overhang the percentages deliberately exclude,
        // which is the honest reading a typed table could never give.
        hint: 'COMPUTED. Whether the folded holdings account for the fully diluted total, and what is outstanding beside them.',
        derive: (data) => {
          const fullyDiluted = deriveNumber(data.fullyDiluted);
          const holders = deriveRows(data.holders);
          if (!fullyDiluted || !holders.length) return undefined;
          const held = sumColumn(holders, 'shares') ?? 0;
          const unallocated = deriveNumber(data.poolUnallocated) ?? 0;
          const accounted = derivePercent(held + unallocated, fullyDiluted) ?? 0;
          const overhang = deriveRows(data.convertibles).length;
          const balanced = accounted >= 99 && accounted <= 101;
          const note = overhang
            ? ` ${overhang} convertible${overhang === 1 ? '' : 's'} outstanding — not priced into these percentages until a round converts them.`
            : '';
          return balanced
            ? `Holders and the unallocated pool account for ${accounted}% of the fully diluted total.${note}`
            : `Holders and the unallocated pool account for only ${accounted}% of the fully diluted total — the ledger and the authorised counts disagree, which is a real condition to investigate rather than a rounding error.${note}`;
        },
      },
      SUMMARY_FIELD,
    ],
  },
  // ── The award, and the schedule that makes it checkable ───────────────────────
  //
  // FO-D3. `vesting` used to appear only as prose inside `offer.equity`, so an
  // offer's equity line was a sentence rather than a fact. This card is the fact:
  // a grant with a real schedule, whose vested figure is COMPUTED at read time and
  // whose `cliffAt` is a declared deadline — which is what makes the cliff the
  // first ownership date a `trigger` can watch.
  //
  // Every figure is written by `canvas_record_equity_grant` / `canvas_sync_cap_table`
  // from `equity_grants` and its ledger, because a grant typed onto a board and a
  // grant in the ledger are two answers to "what was I given".
  {
    kind: 'equityGrant',
    icon: '◇',
    group: 'Work',
    defaultStatus: 'granted',
    actions: ['issue', 'sync'],
    fields: [
      { name: 'reference', render: 'stat', label: 'reference', hint: 'The certificate or grant number — the string a holder quotes. Unique per company.', bookkeeping: true },
      { name: 'holder', render: 'stat', label: 'holder', hint: 'Who holds it, by name. The grant also carries the `partyRef` this resolves to, which is what joins it to an `account` card and to the cap table.' },
      { name: 'shareClass', render: 'stat', label: 'shareClass', hint: 'Which authorised class it comes out of — "Common", "Series A Preferred", "Option Pool". A grant out of a class nobody authorised is refused, which is what keeps the table adding up.' },
      { name: 'instrument', render: 'stat', label: 'instrument', hint: `What is actually held: ${EQUITY_INSTRUMENTS.join(' | ')}. An option is not a share until it is exercised.` },
      { name: 'quantity', render: 'stat', label: 'quantity', hint: 'READ-ONLY. Shares or options under this grant, folded from its own ledger events — so a partly cancelled grant reads as what is left rather than what was promised.', derived: true },
      { name: 'vested', render: 'stat', label: 'vested', hint: 'READ-ONLY. Vested at the date this card was last synced. Computed from the schedule below and stored nowhere, so it cannot go stale in the direction that matters.', derived: true },
      {
        name: 'vestingStartAt',
        render: 'stat',
        label: 'vestingStartAt',
        hint: 'ISO date the clock starts — usually a start date, not the grant date. The two differ more often than they agree.',
      },
      { name: 'vestingMonths', render: 'stat', label: 'vestingMonths', hint: 'Total length of the schedule in months. 48 is the common answer and is not the only one.' },
      { name: 'cliffMonths', render: 'stat', label: 'cliffMonths', hint: 'Nothing vests until this many months have passed, and then that whole portion vests at once. 12 is standard.' },
      { name: 'vestingFrequency', render: 'stat', label: 'vestingFrequency', hint: `How often a tranche vests after the cliff: ${VESTING_FREQUENCIES.join(' | ')}. \`none\` means fully vested — purchased shares, or a founder's already-earned stock.` },
      { name: 'acceleration', render: 'stat', label: 'acceleration', hint: `What happens on a change of control: ${ACCELERATION_KINDS.join(' | ')}. Single accelerates on the acquisition alone; double needs the acquisition AND a termination. They are agreed in a conversation and recorded nowhere, which is why this field exists.` },
      {
        name: 'cliffAt',
        render: 'stat',
        label: 'cliffAt',
        hint: 'READ-ONLY. The date the cliff lands, computed from `vestingStartAt` + `cliffMonths` and written by the sync. Bind a `trigger` with comparator "due-within" to it so the conversation happens before the date rather than after — this is the first ownership date on the canvas that a trigger can watch.',
        derived: true,
        deadline: true,
      },
      {
        name: 'unvested',
        render: 'stat',
        label: 'unvested',
        hint: 'COMPUTED. Quantity minus vested — what a departure would return to the pool.',
        derive: (data) => {
          const quantity = deriveNumber(data.quantity);
          const vested = deriveNumber(data.vested);
          if (quantity === undefined || vested === undefined) return undefined;
          return Math.max(0, quantity - vested);
        },
      },
      {
        name: 'vestedPercent',
        render: 'meter',
        label: 'vestedPercent',
        hint: 'COMPUTED. How far through the schedule this grant is.',
        derive: (data) => derivePercent(deriveNumber(data.vested), deriveNumber(data.quantity)),
      },
      { name: 'pricePerShare', render: 'stat', label: 'pricePerShare', hint: MONEY_HINT },
      { name: 'fmvPerShare', render: 'stat', label: 'fmvPerShare', hint: 'The 409A fair market value the grant was priced against, where there was one. A strike below FMV is a tax problem, not a bargain.' },
      SUMMARY_FIELD,
    ],
  },
  // ── Money that is not yet equity ──────────────────────────────────────────────
  //
  // FO-D4. `fundingRound.roundType: 'safe'` was a label over nothing: the
  // instrument a pre-seed company actually issues could not be represented, so a
  // priced round could not be modelled against what came before it.
  //
  // The terms here are the ones that decide what everybody ELSE ends up owning,
  // which is why they are fields rather than prose — a cap and a discount argued
  // over in an email and recorded in a sentence is how a founder discovers the
  // dilution at the round.
  {
    kind: 'convertible',
    icon: '◐',
    group: 'Work',
    defaultStatus: 'outstanding',
    actions: ['record', 'model'],
    fields: [
      { name: 'reference', render: 'stat', label: 'reference', hint: 'This instrument\'s own reference. Unique per company.', bookkeeping: true },
      { name: 'instrumentKind', render: 'stat', label: 'instrumentKind', hint: `${CONVERTIBLE_KINDS.join(' | ')}. A note is DEBT — it accrues and it matures; a SAFE is neither. Recording one as the other makes "what is due when" unanswerable.` },
      { name: 'holder', render: 'stat', label: 'holder', hint: 'Who put the money in.' },
      { name: 'principal', render: 'stat', label: 'principal', hint: MONEY_HINT },
      { name: 'valuationCap', render: 'stat', label: 'valuationCap', hint: 'The valuation the holder\'s money buys in at, at most. Leave empty for an uncapped instrument rather than writing a large number — uncapped and capped-very-high convert differently.' },
      { name: 'discountPercent', render: 'stat', label: 'discountPercent', hint: 'Percent off the round price, 0–100. The holder takes whichever of the cap and the discount gives them the better price, which is the standard term on every form of both instruments.' },
      {
        name: 'postMoney',
        render: 'stat',
        label: 'postMoney',
        hint: 'true for a post-money SAFE (the 2018 YC form), false for pre-money. DECISIVE, not cosmetic: on a post-money SAFE the holder\'s percentage is fixed and the FOUNDERS absorb every other SAFE\'s dilution; on a pre-money one the SAFEs dilute each other. If you do not know, say you do not know — guessing this misstates who owns the company.',
      },
      { name: 'interestRate', render: 'stat', label: 'interestRate', hint: 'Simple annual interest, for a note. A SAFE does not accrue — leave it empty rather than writing 0, which reads as "a note at zero percent".' },
      {
        name: 'maturesAt',
        render: 'stat',
        label: 'maturesAt',
        hint: 'ISO date a note falls due. Bind a `trigger` with comparator "due-within" to it: a note nobody noticed maturing is a demand letter. A SAFE has no maturity and must leave this empty.',
        deadline: true,
      },
      { name: 'convertsInto', render: 'stat', label: 'convertsInto', hint: 'READ-ONLY. What this would become at the last modelled round, and on which basis — cap, discount or round price. Written by the `model` action; a number here that no round produced would be a promise rather than a projection.', derived: true },
      SUMMARY_FIELD,
    ],
  },
  {
    kind: 'fundingRound',
    icon: '◈',
    group: 'Work',
    defaultStatus: 'planning',
    actions: ['plan', 'track'],
    fields: [
      { name: 'roundType', render: 'stat', label: 'roundType', hint: 'pre-seed | seed | series-a | series-b | bridge | safe. Recorded on the round itself by canvas_plan_funding_round — this card shows it, and the record is what every allocation joins to.' },
      { name: 'instrument', render: 'stat', label: 'instrument', hint: 'equity | safe | convertible-note | grant | debt. What the money actually buys, which is a different question from the round\'s name — a "seed" can be a SAFE.', bookkeeping: true },
      { name: 'leadInvestor', render: 'stat', label: 'leadInvestor', hint: 'The firm leading the round, once one has committed. Never invent one — a round with no lead is the normal state for most of its life.', bookkeeping: true },
      { name: 'roundStatus', render: 'stat', label: 'roundStatus', hint: 'open | closed | abandoned, from the round record. Distinct from this card\'s own `status`, which summarises the board.', bookkeeping: true },
      { name: 'targetAmount', render: 'stat', label: 'targetAmount', hint: `${MONEY_HINT} What the round is RAISING — the plan. Recorded by canvas_plan_funding_round. What has actually closed is \`committed\`, derived from the allocations, and the two are deliberately different fields.` },
      { name: 'committed', render: 'stat', label: 'committed', hint: `${MONEY_HINT} Money actually CLOSED — never money promised. Written by canvas_sync_funding_round from the allocations that reached the closing stage; counting soft circles here is the single most common way a raise is misreported.`, bookkeeping: true },
      { name: 'valuation', render: 'stat', label: 'valuation', hint: MONEY_HINT },
      { name: 'closeTarget', render: 'stat', label: 'closeTarget', hint: 'ISO date you intend to close. Bind a `trigger` with comparator "due-within" so the runway conversation happens while there is still runway.', deadline: true },
      { name: 'useOfFunds', render: 'rows', label: 'useOfFunds', columns: ['area', 'amount', 'outcome'], hint: 'Where the money goes: {area, amount, outcome}. `outcome` is what the money BUYS, which is the question an investor actually asks.' },
      {
        name: 'investors',
        render: 'rows',
        label: 'investors',
        columns: ['investor', 'stage', 'amount', 'nextStep', 'warmIntro', 'touches'],
        hint: 'READ-ONLY. The raise, one row per firm: {investor, stage, amount, nextStep, warmIntro, touches}. Projected from the workspace\'s real investor allocations by canvas_sync_funding_round — never authored, because a hand-typed investor list is a second set of numbers that starts disagreeing with the record immediately and cannot hold a conversation. Add a firm with canvas_open_deal, move one with canvas_move_deal, and record a conversation with canvas_log_deal_touch; `nextStep` IS the latest conversation and `touches` is how many there have been, so a firm with a stage and no touches is a name somebody typed.',
        derived: true,
      },
      {
        name: 'syncedAt',
        render: 'stat',
        label: 'syncedAt',
        hint: 'ISO instant the allocations were last read. Rendered as staleness, so a round nobody has refreshed says so rather than looking current.',
        bookkeeping: true,
      },
      SUMMARY_FIELD,
    ],
  },
  {
    kind: 'investorUpdate',
    icon: '✉',
    group: 'Knowledge',
    defaultStatus: 'draft',
    actions: ['draft', 'send'],
    fields: [
      { name: 'period', render: 'stat', label: 'period', hint: 'The month or quarter being reported.' },
      { name: 'highlights', render: 'list', label: 'highlights', hint: 'What went well: [{title, detail}] with a number in each detail.' },
      { name: 'lowlights', render: 'list', label: 'lowlights', hint: 'What did not. An update with no lowlights is not read as good news, it is read as unreliable.' },
      { name: 'metrics', render: 'rows', label: 'metrics', columns: ['metric', 'value', 'previous', 'change'], hint: 'The standing numbers: {metric, value, previous, change}. Same metrics every period, including the ones that got worse.' },
      { name: 'asks', render: 'chips', label: 'asks', hint: 'Specific, actionable requests — an intro to a named company, a hire, a customer reference.' },
      {
        name: 'recipients',
        render: 'rows',
        label: 'recipients',
        columns: ['name', 'email'],
        hint: 'Who this goes to: {name, email}. REQUIRED for `send` to do anything — an update with no addresses is a document. Take them from the `fundingRound` investors on this board; never invent an address, because the failure mode is a private update reaching a stranger.',
      },
      SUMMARY_FIELD,
    ],
  },
  {
    kind: 'dataRoom',
    icon: '▤',
    group: 'Knowledge',
    defaultStatus: 'assembling',
    actions: ['assemble', 'share'],
    fields: [
      { name: 'audience', render: 'stat', label: 'audience', hint: 'Who this room is for — a named firm or a stage of diligence.' },
      {
        name: 'dataRoomId',
        render: 'stat',
        label: 'dataRoomId',
        hint: 'The canonical `data_rooms` row this card is a view of. Written by canvas_sync_data_room, and what canvas_share_data_room reads back — the id is the identity, and matching a room by its title is the defect this removes.',
        bookkeeping: true,
      },
      {
        name: 'readiness',
        render: 'meter',
        label: 'readiness',
        hint: 'READ-ONLY, 0-100: share of REQUIRED documents actually provided, computed from the room\'s own diligence obligations by canvas_sync_data_room. A room with nothing required reads 0 rather than 100 — "nothing is required" is an unprepared room, not a complete one.',
        derived: true,
      },
      {
        name: 'documents',
        render: 'rows',
        label: 'documents',
        columns: ['document', 'category', 'status', 'owner', 'required', 'source'],
        hint: 'READ-ONLY. One row per document in the room: {document, category, status, owner, required, source}. Projected by canvas_sync_data_room from BOTH shapes a room holds — a diligence obligation (`source` "diligence", which may still be missing) and an encrypted legal file that has been filed into the room (`source` "legal"). The missing ones are listed too: a data room that shows only what exists hides the gap it was built to close. Put a legal file in the room with canvas_file_document_in_data_room.',
        derived: true,
      },
      {
        name: 'unstampable',
        render: 'stat',
        label: 'unstampable',
        hint: 'READ-ONLY. How many PROVIDED documents this room\'s watermark cannot reach — an image, an archive, a binary spreadsheet. Zero when the room does not watermark. Reported here rather than discovered when a firm tries to open one, because those documents can only ever be served view-only and knowing which they are is the difference between a control and a surprise.',
        derived: true,
      },
      { name: 'ndaRequired', render: 'stat', label: 'ndaRequired', hint: 'true | false, read from the room itself. When true, a shared link resolves to "NDA pending" and opens NOTHING until the recipient signs the mutual NDA the share sends. Defaults to true — the safer default for diligence material.', derived: true },
      { name: 'watermark', render: 'stat', label: 'watermark', hint: 'true | false, read from the room itself. When true no share can carry a download at all, and text documents are stamped with the recipient and the instant on the way out — the only way to read the room is through the stamped view.', derived: true },
      { name: 'expiresAt', render: 'stat', label: 'expiresAt', hint: 'ISO date the whole room lapses. Enforced on top of each link\'s own expiry, so shortening the room shortens every link into it. Bind a `trigger` with comparator "due-within" to be told before a live diligence room closes under a firm mid-read.', deadline: true, derived: true },
      { name: 'recipientName', render: 'stat', label: 'recipientName', hint: 'Who the last share granted access to. Pass the recipient to canvas_share_data_room rather than typing it here.', bookkeeping: true },
      { name: 'recipientEmail', render: 'stat', label: 'recipientEmail', hint: 'Their real email, never invented — this is who the NDA (when required) and the access grant went to.', bookkeeping: true },
      { name: 'ndaState', render: 'stat', label: 'ndaState', hint: 'not-required | pending | signed | declined | expired. Derived from the `signature_requests` row the share is bound to — never asserted, because a room must not report "signed" for an NDA that was declined.', bookkeeping: true },
      { name: 'ndaSignatureRequestId', render: 'stat', label: 'ndaSignatureRequestId', hint: 'The signature_requests row the NDA was sent through.', bookkeeping: true },
      {
        name: 'shares',
        render: 'rows',
        label: 'shares',
        columns: ['recipient', 'email', 'access', 'nda', 'state', 'expires'],
        hint: 'READ-ONLY. Who currently holds a link: {recipient, email, access, nda, state, expires}. Written by canvas_sync_data_room and canvas_share_data_room; each row carries its `shareId`, which canvas_revoke_data_room_share reads back. A revoked or lapsed row stays visible — who HAD access is part of the record.',
        derived: true,
      },
      {
        name: 'views',
        render: 'rows',
        label: 'views',
        columns: ['document', 'views', 'lastViewedAt'],
        hint: 'READ-ONLY. What the recipients actually read: {document, views, lastViewedAt}, most-read first, from the room\'s access log. This is the half that makes sending a data room something you can follow up on — a firm that opened the cap table twice and never opened the contracts is a different conversation from one that read everything.',
        derived: true,
      },
      SUMMARY_FIELD,
    ],
  },
  // ── The money, operated ───────────────────────────────────────────────────────
  //
  // The five kinds above hold the money a company RAISES and CHARGES. These five hold
  // the money it PLANS, COLLECTS, OWES and SPENDS ON PEOPLE. Every amount is a plain
  // number beside one `currency`, because these are facts to be totalled rather than
  // characterisations to be preserved — see the MONEY_HINT note.
  {
    kind: 'budget',
    icon: '▦',
    group: 'Work',
    // Never "approved" on a blank card: the whole value of a budget is that it was
    // agreed and then stopped changing, and a default that claims agreement would make
    // the object lie about the one property it exists to carry.
    defaultStatus: 'drafting',
    actions: ['plan', 'compare', 'approve'],
    fields: [
      { name: 'period', render: 'stat', label: 'period', hint: 'The period this budget covers — "FY2027", "2026-Q4", "2026-09".' },
      CURRENCY_FIELD,
      { name: 'plannedTotal', render: 'stat', label: 'plannedTotal', hint: `${EXACT_MONEY_HINT} The total of every line's planned amount. Computed from \`lines\` — do not author it independently, or the header will disagree with the table under it.` },
      { name: 'actualTotal', render: 'stat', label: 'actualTotal', hint: `${EXACT_MONEY_HINT} The total actually spent so far. Written by a refresh against connected actuals, not typed.`, bookkeeping: true },
      { name: 'variance', render: 'verdict', label: 'variance', hint: 'The one sentence a budget exists to produce: which lines are over, by how much, and whether the period total is still achievable. Say "under" or "over" explicitly.' },
      {
        name: 'lines',
        render: 'rows',
        label: 'lines',
        columns: ['line', 'category', 'owner', 'planned', 'actual', 'variance'],
        hint: 'One row per budget line: {line, category, owner, planned, actual, variance}. `planned` and `actual` are plain numbers in the object currency. `owner` is REQUIRED — an over-budget line with nobody accountable is a number, not a control.',
      },
      { name: 'assumptions', render: 'list', label: 'assumptions', hint: 'What this budget takes for granted: [{title, detail}]. Headcount, price, conversion, FX. The assumptions are what a reviewer actually challenges, so an unstated one is the defect.' },
      SUMMARY_FIELD,
    ],
  },
  {
    kind: 'forecast',
    icon: '◹',
    group: 'Insights',
    defaultStatus: 'modelling',
    actions: ['model', 'run', 'compare'],
    fields: [
      { name: 'horizon', render: 'stat', label: 'horizon', hint: 'How far forward this projects, e.g. "12 months", "8 quarters".' },
      CURRENCY_FIELD,
      { name: 'basis', render: 'stat', label: 'basis', hint: 'What the projection extends — "actuals to 2026-07", "budget FY27", "bottom-up pipeline". A forecast whose basis is unstated cannot be checked.' },
      { name: 'runwayMonths', render: 'stat', label: 'runwayMonths', hint: 'Months of cash remaining under the base scenario. The single number a founder opens this object for.' },
      {
        name: 'drivers',
        render: 'rows',
        label: 'drivers',
        columns: ['driver', 'value', 'unit', 'appliesTo'],
        hint: 'The INPUTS the model is sensitive to: {driver, value, unit, appliesTo}. Growth rate, churn, headcount adds, ACV, gross margin. A scenario changes these, so anything a scenario needs to move must appear here.',
      },
      {
        name: 'scenarios',
        render: 'rows',
        label: 'scenarios',
        columns: ['scenario', 'change', 'runwayMonths', 'endingCash', 'verdict'],
        hint: 'One row per scenario: {scenario, change, runwayMonths, endingCash, verdict}. `change` names which driver moved and to what ("churn 2%→4%"). Always include a DOWNSIDE — a forecast with only a base and an upside is a pitch, not a plan.',
      },
      { name: 'periods', render: 'rows', label: 'periods', columns: ['period', 'revenue', 'costs', 'netCash', 'closingCash'], hint: 'The projected series, one row per period: {period, revenue, costs, netCash, closingCash}. Plain numbers in the object currency.' },
      SUMMARY_FIELD,
    ],
  },
  {
    kind: 'invoice',
    icon: '↙',
    group: 'Work',
    defaultStatus: 'draft',
    actions: ['issue', 'record-payment', 'chase'],
    fields: [
      { name: 'customer', render: 'stat', label: 'customer', hint: `The party that owes this. ${COUNTERPARTY_HINT}` },
      counterpartyAccountField('customer'),
      { name: 'invoiceNumber', render: 'stat', label: 'invoiceNumber', hint: 'Your own reference for it. This is the key everything else joins to — the lines, the payments and the collections history — so set it once and never edit it after the invoice is issued.' },
      // FO-G2 — the explicit binding back to what was agreed. An invoice raised under a
      // contract and unable to say so is why "have we billed everything in the MSA" was
      // a question somebody answered by reading both documents.
      contractRefField('invoice'),
      obligationRefField('invoice'),
      contractObligationField({ host: 'invoice' }),
      { name: 'customerEmail', render: 'stat', label: 'customerEmail', hint: 'Where the issued invoice is SENT, and where the collections ladder chases. Without it an invoice can still be issued — for one handed over in person — but nothing will ever leave the building for it.' },
      CURRENCY_FIELD,
      { name: 'amount', render: 'stat', label: 'amount', hint: `${EXACT_MONEY_HINT} The total payable including tax.` },
      { name: 'issuedAt', render: 'stat', label: 'issuedAt', hint: 'ISO date it was issued.' },
      { name: 'dueAt', render: 'stat', label: 'dueAt', hint: 'ISO date payment is due. This is the field that makes an invoice something the board can warn about, so an invoice without it cannot age. Bind a `trigger` with comparator "overdue-by" to have the board chase it.', deadline: true },
      { name: 'paidAmount', render: 'stat', label: 'paidAmount', hint: `${EXACT_MONEY_HINT} How much has actually landed. Part payment is the normal case, so this is not a boolean.` },
      { name: 'ageingDays', render: 'stat', label: 'ageingDays', hint: 'Days past due. Computed from `dueAt` — never authored, because a stale ageing is worse than none.', bookkeeping: true },
      { name: 'lineItems', render: 'rows', label: 'lineItems', columns: ['description', 'quantity', 'unitPrice', 'amount'], hint: 'One row per billed item: {description, quantity, unitPrice, amount}. Plain numbers in the object currency.' },
      { name: 'collection', render: 'list', label: 'collection', hint: 'What has actually been done to collect it: [{title, detail}] with a date in each detail. Collections work with no record is collections work that gets done twice or not at all. READ-ONLY once the invoice is issued: the collections ladder writes every rung it climbs here, and an authored entry beside those is a second collections history.', bookkeeping: true },
      { name: 'collectionMode', render: 'stat', label: 'collectionMode', hint: 'off | notify | auto. How hard the collections ladder may work this one. `notify` (the default) records the reminder that is due and tells the board; `auto` is you delegating the send, so the customer is emailed without anybody looking. Set `off` for an invoice you are handling by hand.' },
      { name: 'issuedBy', render: 'stat', label: 'issuedBy', hint: 'Who issued it. Written by the issue flow from the session — never authored, because it is who stood behind the document that left the building.', bookkeeping: true },
      { name: 'paymentLink', render: 'stat', label: 'paymentLink', hint: 'The hosted page the customer pays on, minted against this workspace\'s own merchant account when the invoice is issued. Written by the issue flow. Absent means no merchant account is connected — the invoice is still real and is paid by bank transfer.', bookkeeping: true },
      SUMMARY_FIELD,
    ],
  },
  {
    kind: 'bill',
    icon: '↗',
    group: 'Work',
    defaultStatus: 'received',
    actions: ['approve', 'schedule-payment', 'dispute'],
    fields: [
      { name: 'vendor', render: 'stat', label: 'vendor', hint: `The party owed — a bill without its counterparty cannot be checked against what was agreed. ${COUNTERPARTY_HINT}` },
      counterpartyAccountField('vendor'),
      { name: 'reference', render: 'stat', label: 'reference', hint: "The vendor's own invoice reference." },
      // FO-G2 — the binding that makes `risks`'s "a charge with no matching contract"
      // computable instead of a thing somebody has to notice. `contractObligation`
      // below checks amount, cadence and date against the clause this names.
      contractRefField('bill'),
      obligationRefField('bill'),
      contractObligationField({ host: 'bill', cadenceSource: 'recurring' }),
      CURRENCY_FIELD,
      { name: 'amount', render: 'stat', label: 'amount', hint: `${EXACT_MONEY_HINT} The total payable including tax.` },
      { name: 'dueAt', render: 'stat', label: 'dueAt', hint: 'ISO date payment is due. Bind a `trigger` with comparator "due-within" so a payment run is prepared before the date, not after it.', deadline: true },
      { name: 'category', render: 'stat', label: 'category', hint: 'Which budget line this lands on. This is what connects a bill to a `budget` — an uncategorised bill cannot appear in a variance.' },
      { name: 'approvedBy', render: 'stat', label: 'approvedBy', hint: 'Who authorised it. Never fill this in on the requester\'s behalf: an approval nobody gave is the one field on this object that can cause real harm.', bookkeeping: true },
      { name: 'recurring', render: 'stat', label: 'recurring', hint: 'none | monthly | quarterly | annual. A recurring bill is a committed cost and belongs in the forecast, not just in this month.' },
      { name: 'risks', render: 'chips', label: 'risks', hint: 'Anything worth a second look — an unexpected increase, an auto-renewal, a duplicate. NOT "a charge with no matching contract": that one is computed by `contractObligation` above from the contract this bill actually names, so writing it here as an observation is a second, staler answer to a question the card already answers.' },
      SUMMARY_FIELD,
    ],
  },
  /**
   * What payroll actually cost.
   *
   * ── EVERY FIGURE HERE IS ONE A PROVIDER RETURNED ────────────────────────────
   * Nothing on this card is calculated by the platform, and that is a rule rather
   * than a limitation: withholding across jurisdictions is a regulated,
   * per-country, continuously-changing obligation with real liability attached,
   * and a rate table that is wrong is worse than no rate table because a wrong one
   * gets used. `canvas_sync_pay_run` reads the runs back from a connected Gusto,
   * Rippling, ADP or Deel account; `source` says which of them said so.
   *
   * ── WHY IT IS NOT A `bill` ──────────────────────────────────────────────────
   * A pay run has no counterparty to approve, dispute or schedule — the money has
   * already left. Modelling it as a payable would make `bill.approve`, the one act
   * on this platform that can cause real financial harm, available on a row nobody
   * can authorise because it is already done.
   */
  {
    kind: 'payRun',
    icon: '⇉',
    group: 'Work',
    defaultStatus: 'processed',
    // `sync` and not `run`. This card can re-read what happened and can never make
    // it happen — see the kind's note, and `connectors/defaults/payroll.ts` for the
    // argument at length.
    actions: ['sync'],
    fields: [
      { name: 'source', render: 'stat', label: 'source', hint: 'Which provider ran it: gusto | rippling | adp | deel | manual. `manual` is a run entered from a bureau\'s PDF, which is how most companies outside the US actually receive one. Written by the sync — never authored for a connected provider.' },
      { name: 'externalRef', render: 'stat', label: 'reference', hint: 'The provider\'s own id for this run. What makes re-reading the same period an update rather than a second run.', bookkeeping: true },
      CURRENCY_FIELD,
      { name: 'periodStart', render: 'stat', label: 'periodStart', hint: 'ISO date the pay period starts.' },
      { name: 'periodEnd', render: 'stat', label: 'periodEnd', hint: 'ISO date the pay period ends.' },
      // NOT a `deadline`, and the flag was here until 2026-08-19. Two things were wrong
      // with it. The rule `SpecField.deadline` states is "mark a field only when passing
      // it means somebody has missed something", and nothing is owed once a pay run has
      // been paid — a countdown against it is an alert about money that already left. And
      // the flag was inert anyway: `paidAt` is not in `DEADLINE_FIELD_NAMES`, so the
      // server sweep could not resolve it, and a `trigger` bound here would have silently
      // never fired — the exact failure the flag exists to prevent, which is why
      // `canvasTriggers.test.ts` asserts the two lists agree.
      { name: 'paidAt', render: 'stat', label: 'paidAt', hint: 'ISO date the money actually left. This — not the period — is the month the cost belongs to, because a period straddling a month boundary would otherwise land its whole cost in the wrong one.' },
      { name: 'grossAmount', render: 'stat', label: 'grossAmount', hint: `${EXACT_MONEY_HINT} Total gross pay before employer taxes.` },
      { name: 'employerTaxes', render: 'stat', label: 'employerTaxes', hint: `${EXACT_MONEY_HINT} What the employer owed on top of gross.` },
      { name: 'totalCost', render: 'stat', label: 'totalCost', hint: `${EXACT_MONEY_HINT} What the run cost the company in total. This is the number that is BURN — stored separately from gross plus taxes rather than derived from them, because a provider also bills benefits and its own fee and deriving the total would silently drop both.` },
      { name: 'employeeCount', render: 'stat', label: 'employeeCount', hint: 'How many people were paid.' },
      { name: 'lines', render: 'rows', label: 'lines', columns: ['employee', 'hours', 'rate', 'amount'], hint: 'One row per person: {employee, hours, rate, amount}. Plain numbers in the object currency. Read from the provider — do not author these, and do not correct them here: a figure that disagrees with the provider is a conversation with the provider.' },
      { name: 'syncedAt', render: 'stat', label: 'syncedAt', hint: 'When this was last read back from the provider. A run whose sync is a month old is still a fact; saying WHEN it was read is what stops it being mistaken for a live one.', bookkeeping: true },
      SUMMARY_FIELD,
    ],
  },
  // ── The paper ─────────────────────────────────────────────────────────────────
  {
    kind: 'contract',
    icon: '✎',
    group: 'Knowledge',
    defaultStatus: 'draft',
    actions: ['review', 'sign'],
    fields: [
      {
        name: 'reference',
        render: 'stat',
        label: 'reference',
        hint: 'THIS agreement\'s own short reference — "MSA-ACME-2026", "SOW-3". The identity every invoice and bill raised under it points at through `contractRef`, and what `SpecDeriveBoard.byRef` resolves before it falls back to the title. Two agreements with one company is the normal case, so a contract without a reference is one nothing can be charged against without ambiguity.',
      },
      { name: 'counterparty', render: 'stat', label: 'counterparty', hint: COUNTERPARTY_HINT },
      counterpartyAccountField('counterparty'),
      { name: 'contractType', render: 'stat', label: 'contractType', hint: 'msa | sow | nda | employment | vendor | formation.' },
      { name: 'effectiveAt', render: 'stat', label: 'effectiveAt', hint: 'ISO start date.' },
      { name: 'renewsAt', render: 'stat', label: 'renewsAt', hint: 'ISO renewal or expiry date — the field that makes a contract something the board can warn about. Bind a `trigger` with comparator "due-within" to be told before an auto-renewal rather than after it.', deadline: true },
      CURRENCY_FIELD,
      { name: 'valueAmount', render: 'stat', label: 'valueAmount', hint: MONEY_HINT },
      {
        name: 'obligations',
        render: 'rows',
        label: 'obligations',
        columns: OBLIGATION_COLUMNS,
        hint: `What this commits either side to, one row per clause somebody has to DO something about: {${OBLIGATION_COLUMNS.join(', ')}}. \`reference\` is the identity an \`invoice\` or a \`bill\` points at through its own \`obligationRef\` — an obligation without one can never be shown to have been discharged, which is what made this table prose. \`kind\` is receivable (we invoice for it) | payable (they bill us for it) | deliverable | report | notice; only the first two should ever produce a document, so a deliverable is never counted as un-invoiced revenue. \`cadence\` is once | monthly | quarterly | annual, \`amount\` is a plain number in this contract's \`currency\`, and \`status\` is pending | invoiced | met | waived | breached.`,
      },
      {
        name: 'obligationCoverage',
        render: 'verdict',
        label: 'obligationCoverage',
        // FO-G2. The half that makes the table above worth structuring: a contract
        // stating "invoice monthly for support" and a board holding no such invoice
        // used to be two facts nothing compared. This reads the board's own invoices
        // and bills — the ones that explicitly name this contract, never the ones whose
        // counterparty merely looks the same — and reports both directions of the gap.
        hint: 'COMPUTED. Which of this contract\'s billable obligations have an invoice or a bill against them, which have nothing raised yet, and which documents point here matching no obligation at all.',
        derive: (data, board) => {
          const rows = deriveRows(data.obligations);
          if (!rows.length) return undefined;
          const mine = contractRefKeys(data);
          if (!mine.size) {
            return 'This contract has neither a `reference` nor a title, so no invoice or bill can name it. Give it a reference before raising anything against it.';
          }

          const documents = [...board.ofKind('invoice'), ...board.ofKind('bill')]
            .filter((document) => mine.has(specRefKey(document.contractRef)));

          const billable = rows.filter((row) => OBLIGATION_DOCUMENT_KIND[String(row.kind ?? '').trim().toLowerCase()]);
          const unreferenced = rows.filter((row) => !specRefKey(row.reference)).length;
          const covered: string[] = [];
          const open: string[] = [];
          for (const row of billable) {
            const key = specRefKey(row.reference);
            const raised = !!key && documents.some((document) => specRefKey(document.obligationRef) === key);
            (raised ? covered : open).push(String(row.obligation ?? row.reference ?? '').trim() || 'an unnamed obligation');
          }

          const known = new Set(rows.map((row) => specRefKey(row.reference)).filter(Boolean));
          const orphans = documents.filter((document) => !known.has(specRefKey(document.obligationRef)));

          const parts: string[] = [];
          parts.push(billable.length
            ? `${covered.length} of ${billable.length} billable obligation${billable.length === 1 ? '' : 's'} ${covered.length === 1 ? 'has' : 'have'} a document raised against ${billable.length === 1 ? 'it' : 'them'}.`
            : 'No obligation here is a receivable or a payable, so nothing on this contract should generate an invoice or a bill.');
          if (open.length) parts.push(`Nothing raised yet for: ${open.join(', ')}.`);
          if (orphans.length) {
            parts.push(`${orphans.length} document${orphans.length === 1 ? '' : 's'} name${orphans.length === 1 ? 's' : ''} this contract and match no obligation on it — ${orphans.map(documentLabel).join(', ')}.`);
          }
          if (unreferenced) {
            parts.push(`${unreferenced} obligation${unreferenced === 1 ? '' : 's'} carr${unreferenced === 1 ? 'ies' : 'y'} no \`reference\`, so nothing can ever be shown to discharge ${unreferenced === 1 ? 'it' : 'them'}.`);
          }
          return parts.join(' ');
        },
      },
      {
        name: 'documentBody',
        render: 'text',
        label: 'documentBody',
        hint: 'The FULL text of the agreement, in markdown. This is what `canvas_request_signature` sends verbatim and what the signature record freezes — so what the card holds is what the signer sees, not a summary of it. Written by canvas_draft_legal_document from a real template; edit it here to change the terms before sending, and never send a contract whose body you have not read back to the user.',
      },
      {
        name: 'templateKey',
        render: 'stat',
        label: 'templateKey',
        hint: 'Which document template `documentBody` was drafted from — provenance, not resolution. A later edit to the template does not change what was signed.',
        bookkeeping: true,
      },
      { name: 'risks', render: 'chips', label: 'risks', hint: 'Clauses worth a second look — auto-renewal, unlimited liability, exclusivity, IP assignment.' },
      { name: 'signatureState', render: 'stat', label: 'signatureState', hint: 'unsent | sent | completed | declined | expired. Written by the sign flow over `signature_requests` — never asserted, because a signature is a recorded event with its own audit trail.', bookkeeping: true },
      { name: 'signatureRequestId', render: 'stat', label: 'signatureRequestId', hint: 'The signature_requests row this sign flow created. Written by the sign flow.', bookkeeping: true },
      { name: 'signedAt', render: 'stat', label: 'signedAt', hint: 'ISO instant every party completed. Written by the sign flow.', bookkeeping: true },
      SUMMARY_FIELD,
    ],
  },
  // ── The counterparty ──────────────────────────────────────────────────────────
  //
  // The object the four fields above now point AT. See the kind's note in the
  // contract for why it is not a second customer table: `party_roles` already holds
  // one row per (tenant, party, role), so this card is a PROJECTION of a kernel row
  // and `partyRef` is the join.
  //
  // `history` is the FO-A3 half — the account's own open invoices and open bills,
  // written by `canvas_sync_account` from `finance/accountHistory.ts`, which reads
  // `invoices.customerRef` / `bills.vendorRef` against this account's `partyRef`.
  // A contract's renewal is NOT projected here: `contract` has no backend table (it
  // is canvas-board JSON), so its renewal is read off the `contract` object itself —
  // `counterpartyAccountField` already resolves that direction. `derived` rather than
  // omitted: a model that cannot see the section exists will invent somewhere to put
  // a receivable, and the honest instruction is "this exists, you may reason about
  // it, you may not assert it".
  {
    kind: 'account',
    icon: '⬡',
    group: 'People',
    defaultStatus: 'prospect',
    actions: ['sync', 'research'],
    fields: [
      {
        name: 'partyRef',
        render: 'stat',
        label: 'partyRef',
        hint: 'The stable reference every other object joins to this account by — lowercase, hyphenated, derived from the legal name ("Acme Holdings Ltd" → "acme-holdings-ltd"). Set it ONCE and never edit it: changing a ref orphans every invoice, bill and contract that already points at it. canvas_sync_account writes it when the account comes from the workspace.',
      },
      {
        name: 'relationship',
        render: 'stat',
        label: 'relationship',
        hint: `What this party is to us: ${ACCOUNT_RELATIONSHIPS.join(' | ')}. One account can be more than one thing — a customer who also supplies you is TWO relationships, so use \`alsoKnownAs\` to say so rather than picking the more flattering one.`,
      },
      { name: 'legalName', render: 'stat', label: 'legalName', hint: 'Registered legal name as it appears on the contract, if it differs from the trading name in the title. This is the name that has to match on an invoice.' },
      { name: 'owner', render: 'stat', label: 'owner', hint: 'The single person here who owns this relationship. Not a team — an account with no named owner is an account nobody chases.' },
      { name: 'website', render: 'stat', label: 'website', hint: 'Primary domain. The cheapest way to tell two similarly-named companies apart.' },
      { name: 'segment', render: 'stat', label: 'segment', hint: 'Title of the `customerSegment` object this account belongs to, where one is on the board. This is what makes "how are we doing in mid-market" answerable.' },
      { name: 'since', render: 'stat', label: 'since', hint: 'ISO date the relationship started — first order, first invoice, signature date.' },
      { name: 'alsoKnownAs', render: 'chips', label: 'alsoKnownAs', hint: 'Every other name this party appears under — the trading name, the old name before an acquisition, the abbreviation the team actually types. This is the list that stops a second account being created for a company you already have.' },
      {
        name: 'contacts',
        render: 'rows',
        label: 'contacts',
        columns: ['name', 'role', 'email', 'notes'],
        hint: 'The people at this account: {name, role, email, notes}. `role` is what they DO in a deal — economic buyer, champion, blocker, user — not their job title, because the title is on their business card and the role is what a next step depends on.',
      },
      {
        name: 'history',
        render: 'rows',
        label: 'history',
        columns: ['kind', 'reference', 'amount', 'currency', 'due', 'status'],
        hint: 'READ-ONLY. This account\'s open invoices and open bills, resolved live from finance by `canvas_sync_account` — never author it directly. Absent or empty does not mean nothing is owed: call canvas_sync_account again to refresh before concluding an account is current. A `contract`\'s renewal is not here — read it off the `contract` object itself, which this account\'s cards already join to.',
        derived: true,
      },
      SUMMARY_FIELD,
      SOURCES_FIELD,
    ],
  },
];

const SPEC_BY_KIND: ReadonlyMap<string, FounderObjectSpec> = new Map(
  FOUNDER_OBJECT_SPECS.map((spec) => [spec.kind, spec]),
);

export function founderObjectSpec(kind: string): FounderObjectSpec | null {
  return SPEC_BY_KIND.get(kind) ?? null;
}

/**
 * Every field name any founder object owns, deduplicated.
 *
 * The registry folds this into `CONTEXT_FIELDS` so a founder field is readable by Brain
 * the moment it is declared — closing, for these kinds, exactly the drift that left a
 * KPI's `value` authorable and invisible.
 */
export const FOUNDER_FIELD_NAMES: readonly string[] = [
  ...new Set(FOUNDER_OBJECT_SPECS.flatMap((spec) => spec.fields.map((field) => field.name))),
];

/**
 * Founder fields that are bookkeeping rather than work.
 *
 * Folded into the registry's `NON_SUBSTANTIVE_FIELDS` so the empty-shell rule reads them
 * correctly: a `trigger` whose only populated field is `state`, or a `metric` carrying
 * only `series` and `fetchedAt`, was written by the evaluator or the refresh — not
 * authored — and must still count as a shell that hands the work back.
 */
export const FOUNDER_BOOKKEEPING_FIELDS: readonly string[] = [
  ...new Set(FOUNDER_OBJECT_SPECS.flatMap((spec) => spec.fields.filter((field) => field.bookkeeping).map((field) => field.name))),
];

/**
 * The authorable fields for one founder kind, in declaration order.
 *
 * A thin alias over `specMutableFields` — kept because the founder vocabulary's own
 * importers already call it by this name. It used to duplicate the filter instead of
 * calling it, which meant a `derived` founder field (there were none until
 * `counterpartyAccountField`) would have been advertised as writable here while the
 * real registry (`FOUNDER_MUTABLE_FIELDS`, built from the same generic function)
 * correctly refused it — two answers to "can Brain write this" that only agreed by
 * accident of no founder field having tested the difference yet.
 */
export function founderMutableFields(kind: FounderObjectKind): readonly string[] {
  return specMutableFields(kind);
}

/**
 * Model-facing documentation for one founder kind: what each field is and what good
 * content looks like. Injected into `canvas_add_object`'s description so the model is
 * told the shape at the moment it authors one, rather than in a prompt paragraph that
 * drifts from the registry.
 */
export function founderFieldGuidance(kind: FounderObjectKind): string {
  const spec = SPEC_BY_KIND.get(kind);
  if (!spec) return '';
  const lines = spec.fields.map((field) => {
    const columns = field.columns ? ` Columns: ${field.columns.join(', ')}.` : '';
    return `• ${field.name} — ${field.hint}${columns}`;
  });
  return `${spec.kind}:\n${lines.join('\n')}`;
}

/** Guidance for every founder kind, for the one place the whole vocabulary is taught. */
export function allFounderFieldGuidance(): string {
  return FOUNDER_OBJECT_SPECS.map((spec) => founderFieldGuidance(spec.kind)).join('\n\n');
}

/**
 * Register this vocabulary with the shared spec-object primitive.
 *
 * The mechanism this file invented is now `lib/specObjects.ts`, because a second
 * vocabulary needed it (the academic objects) and "add a founder spec for a doctoral
 * thesis" is not a sentence anyone should have to write. Registering here means ONE
 * node body renders both sets, and the derivations above stay as the founder-specific
 * names their existing callers use.
 *
 * The namespace is unchanged, so no message key moves: each vocabulary owns its own
 * terms, which is the ubiquitous-language rule applied to the catalogs.
 */
registerSpecObjectSet({
  id: 'founder',
  namespace: 'creationCanvas.founder',
  specs: FOUNDER_OBJECT_SPECS,
});
