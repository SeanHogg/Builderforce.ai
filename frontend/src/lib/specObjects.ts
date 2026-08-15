/**
 * THE spec-object primitive — one declaration per object kind, read by everything.
 *
 * ── WHAT THIS IS, AND WHY IT IS NOT `founderObjects.ts` ──────────────────────────
 * `founderObjects.ts` proved the mechanism: declare a kind's fields ONCE and let the
 * node body, the AI field contract, the registry's mutable/context lists and the
 * empty-shell rule all read that one declaration, instead of four hand-maintained
 * lists that drift. Its own header records the drift it was built to stop — a `kpi`
 * whose `value` was authorable and unreadable, so the card showed a number the model
 * was blind to.
 *
 * The mechanism was right and its NAME was wrong. It is not a founder mechanism; it
 * is how a canvas object gets declared. The moment a second vocabulary needed it —
 * the academic objects, where a `rubric`, a `submission` and a `manuscript` are the
 * same shape of thing on a board as a `battlecard` — "add a founder spec for a
 * doctoral thesis" was the sentence that made the misnaming load-bearing.
 *
 * So the TYPES and the DERIVATIONS live here, vocabulary-neutral, and each vocabulary
 * contributes a SET: a namespace plus its specs. `founderObjects.ts` and
 * `academicObjects.ts` are two sets, and a third costs one registration.
 *
 * ── WHY A SET CARRIES ITS OWN i18n NAMESPACE ─────────────────────────────────────
 * The obvious move — one shared namespace for every spec field label — was wrong for
 * a reason worth recording: `field.summary`, `field.sources` and `field.status` are
 * shared, but `field.wedge` (a battlecard's attack) and `field.wedge` (nothing in
 * academia) would collide the day two vocabularies disagreed about a word, and the
 * catalogs are where that collision is invisible. Each set owns its terms under its
 * own namespace, which is the ubiquitous-language rule applied to the message files:
 * `creationCanvas.founder.field.*` and `creationCanvas.academic.field.*` are two
 * vocabularies, not one with a merge conflict.
 *
 * ── THE RENDER STYLES ARE A CLOSED SET, DELIBERATELY ─────────────────────────────
 * Eleven styles cover both vocabularies. That is the point: a `capTable` and a
 * `gradebook` are the same shape on a board — headline numbers over a table — and
 * rendering them with one component is what keeps the product looking like one
 * product. A kind that genuinely cannot be expressed here is a signal to add a style,
 * not a bespoke body somewhere else.
 */

/**
 * How the node body draws one field.
 *
 * The first seven came from the founder set and are unchanged. The last four exist
 * because scholarship needs shapes commerce does not:
 *
 * `stat`      a headline value — big, tabular numerals. The number you look for first.
 * `text`      a paragraph of authored prose.
 * `chips`     `string[]` as pills. Short, unordered, scannable.
 * `list`      `Array<string | {title, detail}>` as a titled list. Ordered, readable.
 * `rows`      `Array<Record>` as a compact table, driven by `columns`.
 * `meter`     a 0–100 score with a proportional bar.
 * `verdict`   a callout: a short judgement plus its reasoning.
 * `math`      TeX, rendered as accessible MathML. An equation is not a string of prose
 *             and must not be drawn as one — see `lib/academic/mathTex.ts`.
 * `reference` a stored citation, FORMATTED in the board's style. Never a pre-formatted
 *             string, which is how a bibliography ends up in four styles at once.
 * `matrix`    a table whose COLUMNS are data — a rubric's levels, a gradebook's
 *             assignments. `rows` cannot express it because its columns are declared.
 * `bars`      `Array<{label, value}>` as a proportional distribution. A poll result or
 *             a mark spread read as a shape, not as a column of numbers.
 */
export type SpecFieldRender =
  | 'stat' | 'text' | 'chips' | 'list' | 'rows' | 'meter' | 'verdict'
  | 'math' | 'reference' | 'matrix' | 'bars';

/**
 * What a cross-object derivation may ask the board — see {@link SpecField.derive}.
 *
 * TWO questions, deliberately, and no third. `ofKind` is the fan-out ("every submission
 * on this board"); `byRef` is the join ("the assignment this submission answers"). A
 * general `find(predicate)` was the obvious third and is the one to refuse: it would let
 * each derivation invent its own matcher, and the academic vocabulary's refs are already
 * ambiguous enough — `assignmentRef` is a TITLE, `cohortRef` is "title or courseCode" —
 * that two spellings of the same join is a question of when, not whether.
 *
 * Both are index reads. Nothing here scans.
 */
export interface SpecDeriveBoard {
  /** Every object of one kind, in board order. Empty when there are none. */
  ofKind(kind: string): readonly Record<string, unknown>[];
  /**
   * The one object of `kind` this reference names, or null.
   *
   * Matches on `title` first and then on the identifying fields a vocabulary actually
   * uses as a human-facing key (`courseCode`, `assetTag`, `reference`, `sku`). Case- and
   * space-insensitive, because these refs are typed by people and by models, and a
   * gradebook that silently aggregates nothing because somebody wrote "PHYS 2041" is
   * worse than one that says it found no marks.
   */
  byRef(kind: string, ref: unknown): Record<string, unknown> | null;
}

/** The identifying fields `byRef` will match on, after `title`. Ordered by how
 *  specific they are: a code identifies more precisely than a name. */
const REF_KEYS = ['courseCode', 'reference', 'assetTag', 'sku', 'orderNumber', 'name'] as const;

const refKey = (value: unknown): string => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** The board with no other objects on it. A single frozen instance, so a caller with no
 *  context (a unit test, a detached card) allocates nothing and re-renders nothing. */
export const EMPTY_SPEC_BOARD: SpecDeriveBoard = Object.freeze({
  ofKind: () => [],
  byRef: () => null,
});

/**
 * Index a board once for the derivations that read it.
 *
 * Built eagerly rather than lazily: a board is indexed once per render of the cards that
 * need it, and every derivation on it then reads a `Map`. The lazy alternative saves
 * nothing measurable and costs the guarantee that the cost is O(N) exactly once.
 */
export function makeSpecDeriveBoard(objects: readonly Record<string, unknown>[]): SpecDeriveBoard {
  const byKind = new Map<string, Record<string, unknown>[]>();
  const byRefKey = new Map<string, Record<string, unknown>>();

  for (const object of objects) {
    const kind = typeof object?.kind === 'string' ? object.kind : '';
    if (!kind) continue;
    const list = byKind.get(kind);
    if (list) list.push(object);
    else byKind.set(kind, [object]);

    for (const key of ['title', ...REF_KEYS]) {
      const value = refKey(object[key]);
      // FIRST WINS. Two cards claiming one name is a board somebody has to fix, and
      // quietly preferring the later one would make which mark counts depend on
      // insertion order.
      if (value && !byRefKey.has(`${kind}::${value}`)) byRefKey.set(`${kind}::${value}`, object);
    }
  }

  return {
    ofKind: (kind) => byKind.get(kind) ?? [],
    byRef: (kind, ref) => {
      const value = refKey(ref);
      return value ? byRefKey.get(`${kind}::${value}`) ?? null : null;
    },
  };
}

export interface SpecField {
  name: string;
  render: SpecFieldRender;
  /** i18n key suffix under `<namespace>.field`. */
  label: string;
  /** Model-facing documentation. Says what good content looks like, not just the type. */
  hint: string;
  /** Column keys for `rows`. Header labels resolve under `<namespace>.column`. */
  columns?: readonly string[];
  /**
   * Identity/bookkeeping rather than work. Excluded from the empty-shell check, so an
   * object whose only authored field is its own status still counts as a shell.
   */
  bookkeeping?: boolean;
  /**
   * Written by a mechanism, never by an LLM patch — a learner's marks, an attempt
   * record, an integrity ledger. Excluded from the mutable fields the registry
   * advertises, so the model can READ it and can never assert it.
   *
   * The founder set had no need for this: nothing it holds is evidence ABOUT a person.
   * The academic set is full of it, and a model that could write `marks` could report
   * a grade nobody earned — the same argument `canvasPractice.attempts` already makes,
   * generalised so it is a property of a field rather than a comment on one module.
   */
  derived?: boolean;
  /**
   * RESTRICTED: the model may not read it either, and it never leaves the tenant.
   *
   * ── WHY THIS IS NOT `derived`, AND NOT OBJECT CONFIDENTIALITY ──────────────────
   * Three different questions, and the hiring set is what proved they are three:
   *   • `derived`      — may the model WRITE it? (marks, attempt records, splits)
   *   • confidentiality — may this OBJECT be shared, exported or seen by a guest?
   *     (`CONFIDENTIALITY_LEVELS` in the contract; a whole `case` or `candidate`)
   *   • `restricted`   — may the model READ this FIELD, inside a tenant where the
   *     object itself is legitimately readable?
   *
   * `candidate.demographics` is the case that needs the third. Self-identified EEO data
   * is collected because statutory reporting requires it and is unlawful to use in an
   * evaluation — so the field must exist, must be visible to the compliance reader, and
   * must be invisible to the model that ranks the shortlist. Object-level
   * confidentiality cannot express that: it would hide the whole candidate from the
   * hiring team who need them. `derived` cannot express it: the problem is not who
   * WRITES it.
   *
   * A restricted field is stripped from the AI context snapshot, from
   * `creationObjectMutableFields`, and from every export and share path — enforced by
   * `specRestrictedFields()` in one place rather than by each consumer remembering.
   */
  restricted?: boolean;
  /**
   * COMPUTED from the rest of the object, rather than stored on it.
   *
   * ── WHY THE `derived` FLAG WAS NOT ENOUGH ──────────────────────────────────────
   * `derived` says only who may WRITE a field: a mark, an attempt record, a fee split —
   * values a mechanism elsewhere puts on the object, which the model must be able to read
   * and must never assert. That is the right rule and it leaves a second class of field
   * with nowhere to live: a number that is pure arithmetic over fields already on the
   * card. A work order's cost is its parts plus its labour. An estimate's total is the sum
   * of its lines. A dispatch board's utilisation is assigned hours over capacity.
   *
   * Storing those is the 3NF violation the schema rule forbids one layer down — one fact
   * in one place — and it fails in the way stored totals always fail: somebody edits a
   * line, nothing recomputes, and the card shows a total that disagrees with the rows
   * printed directly beneath it. Leaving them out instead means the board can hold a job's
   * parts and labour and still cannot say what the job cost, which is the number the whole
   * object exists to produce.
   *
   * So a field may declare HOW it is computed, once, beside the fields it reads. The node
   * body renders it, the AI snapshot carries it, and `specMutableFields` omits it — a
   * computed field is never authorable, because an authored total is exactly the drift
   * this closes. Vocabulary-neutral by construction: it is a property of a field, so any
   * set may use it.
   *
   * Return `undefined` (never a zero) when the inputs are missing. A margin computed
   * against an absent cost reads as 100% and is the most dangerous wrong answer this
   * layer can produce — the refusal `canvasMetricsDerived` already argues for metrics.
   *
   * ── THE SECOND ARGUMENT, AND WHY IT ARRIVED LATER ──────────────────────────────
   * The first version took `(data)` alone, which is enough for arithmetic over one card
   * — a job's cost, an estimate's total — and is exactly one object short of the case
   * that motivated this flag in the first place. A `gradebook`'s mean is computed from
   * the `submission` objects NEXT TO IT; a `submission`'s lateness needs the deadline
   * on its `assignment`. Those are the fields the academic vocabulary declared `derived`
   * and never produced, because a mechanism that "will write them later" is a promise,
   * not a number.
   *
   * So a derivation also receives the BOARD, through the narrow port below rather than
   * a raw array: every cross-object derivation needs the same two questions answered
   * ("every object of this kind", "the one this ref names"), and letting each write its
   * own matcher is how two of them come to disagree about whether a ref is a title or
   * an id. The port indexes once per board, so a board of N objects with M derivations
   * costs O(N + M) rather than O(N × M).
   *
   * A derivation that does not need it declares one parameter and pays nothing: the
   * arity is what {@link specKindReadsBoard} reads, so a card whose kind never looks
   * sideways is never subscribed to its neighbours.
   */
  derive?: (data: Record<string, unknown>, board: SpecDeriveBoard) => unknown;
  /**
   * A DATE THIS OBJECT IS JUDGED AGAINST — a renewal, a due date, an expiry, a review.
   *
   * ── WHY A FLAG AND NOT A CONVENTION ────────────────────────────────────────────
   * `trigger` could only watch a `liveMetric`'s number, so the four dates a founder is
   * actually ambushed by — `contract.renewsAt`, `invoice.dueAt`, `obligation.dueAt`,
   * `fundingRound.closeTarget` — were unwatchable. The vocabularies had already noticed
   * and written the instruction anyway: `obligation.dueAt` says "Bind a `trigger` to it
   * so the board warns before rather than reporting after" and `policy.reviewAt` says
   * "Bind a `trigger` to it". Both were false. A model that follows a documented
   * instruction into a binding that silently never fires is worse served than one told
   * nothing.
   *
   * The alternative — a `DATE_FIELD_BY_KIND` map in `canvasTriggers.ts` — would be the
   * fifth hand-maintained list this module exists to abolish, and it would drift the
   * first time a vocabulary added a kind: the map lives in one file, the kinds in
   * another, and nothing holds them together. Declaring it beside the field means a new
   * deadline-bearing kind is watchable the moment it is declared.
   *
   * NOT every date. `customerInterview.heldAt` and `decision.decidedAt` record when
   * something HAPPENED — nothing is owed, so a countdown against one is noise. Mark a
   * field only when passing it means somebody has missed something.
   *
   * The VALUE is an ISO date (or anything `Date.parse` accepts). Read by
   * `specDeadlineFields()`, which is what `canvas_evaluate_triggers` and the server
   * sweep both resolve a `trigger`'s binding through.
   */
  deadline?: boolean;
}

export interface SpecObjectSpec {
  kind: string;
  icon: string;
  /**
   * The palette section this kind is filed under.
   *
   * TYPED, not a string. It was `string` "to avoid a cycle" — but `CreationObjectGroup`
   * is a pure type, so importing it erases at compile time and there is no cycle to
   * avoid, while the loose type cost exactly what the palette's own comment predicts it
   * would: `book`, the publication primitive, declared `group: 'Create'` — a section
   * that does not exist — and `CREATION_PALETTE_GROUPS` filters by group, so the kind
   * was registered, authorable by Brain, and unreachable by a person. Nothing errored;
   * one registry test noticed a set of 176 against a set of 175.
   */
  group: CreationObjectGroup;
  /** Default status on a freshly created object. An i18n key suffix under
   *  `<namespace>.status`. Never "Live" or "Ready" on an empty card — an empty card
   *  that reads as a configured one is the defect the registry's own comments record. */
  defaultStatus: string;
  fields: readonly SpecField[];
  actions: readonly string[];
  /** Non-authored scaffolding merged into a new object (never model-writable). */
  seed?: Record<string, unknown>;
}

/** One vocabulary: its specs and the i18n namespace its terms are written in. */
export interface SpecObjectSet {
  /** Stable id, used by tests and by the guidance grouping. */
  id: string;
  /** i18n namespace under which `label.*`, `status.*`, `field.*` and `column.*` resolve. */
  namespace: string;
  specs: readonly SpecObjectSpec[];
}

/**
 * Cited evidence, shared by both vocabularies.
 *
 * Present on a founder object because a market claim without a source is a guess, and
 * on an academic object for the stricter version of the same reason: an unsourced
 * claim in a manuscript is misconduct, not merely weak.
 */
export const SOURCES_FIELD: SpecField = {
  name: 'sources',
  render: 'list',
  label: 'sources',
  hint: 'One entry per source actually consulted: {title, url}. A researched claim with no source here is not researched.',
  bookkeeping: true,
};

export const SUMMARY_FIELD: SpecField = {
  name: 'summary',
  render: 'text',
  label: 'summary',
  hint: 'Two or three sentences a reader can act on. Lead with the finding, not the method.',
};

// ---------------------------------------------------------------------------
// The registry — sets in, derivations out
// ---------------------------------------------------------------------------

const SETS: SpecObjectSet[] = [];
let byKind: Map<string, { spec: SpecObjectSpec; set: SpecObjectSet }> | null = null;
/** kind → "does any derivation read the board", memoised. Cleared with the index it is
 *  derived from, so a set registered after the first lookup is not answered from a
 *  cache computed before it existed. */
const boardReaders = new Map<string, boolean>();

/**
 * Register one vocabulary.
 *
 * Called at module load by each vocabulary module. The index is invalidated rather
 * than rebuilt so registration order cannot matter: a set registered after the first
 * lookup still resolves, which is what keeps this from depending on import order —
 * the failure mode where a kind is "unregistered" only in the test that imports the
 * modules in the other order.
 */
export function registerSpecObjectSet(set: SpecObjectSet): void {
  SETS.push(set);
  byKind = null;
  boardReaders.clear();
}

function index(): Map<string, { spec: SpecObjectSpec; set: SpecObjectSet }> {
  if (byKind) return byKind;
  const next = new Map<string, { spec: SpecObjectSpec; set: SpecObjectSet }>();
  for (const set of SETS) for (const spec of set.specs) next.set(spec.kind, { spec, set });
  byKind = next;
  return next;
}

/** Every registered set, in registration order. */
export function specObjectSets(): readonly SpecObjectSet[] {
  return SETS;
}

/** The spec for one kind, or null when the kind is not spec-driven. */
export function specObjectSpec(kind: string): SpecObjectSpec | null {
  return index().get(kind)?.spec ?? null;
}

/** The i18n namespace a kind's labels resolve under. Null for a non-spec kind. */
export function specObjectNamespace(kind: string): string | null {
  return index().get(kind)?.set.namespace ?? null;
}

/** True when this kind is declared by some registered vocabulary. */
export function isSpecObjectKind(kind: string): boolean {
  return index().has(kind);
}

/** Every spec, across every set. */
export function allSpecObjectSpecs(): readonly SpecObjectSpec[] {
  return SETS.flatMap((set) => set.specs);
}

/**
 * Every field name any spec object owns, deduplicated.
 *
 * The registry folds this into `CONTEXT_FIELDS` so a spec field is readable by Brain
 * the moment it is declared — closing, for these kinds, exactly the authorable-but-
 * unreadable drift the mechanism exists to prevent.
 *
 * `restricted` fields are the ONE exclusion, and it is the whole reason that flag
 * exists: this list is what Brain may read, and a field captured from a candidate for
 * statutory reporting must not reach the model that ranks them. Excluding it here — at
 * the single point the read list is derived — is what makes the rule structural rather
 * than a filter each consumer has to remember.
 */
export function specFieldNames(): readonly string[] {
  return [...new Set(allSpecObjectSpecs()
    .flatMap((spec) => spec.fields.filter((field) => !field.restricted).map((field) => field.name)))];
}

/**
 * Spec fields that are bookkeeping or derived rather than authored work.
 *
 * Folded into the registry's `NON_SUBSTANTIVE_FIELDS` so the empty-shell rule reads
 * them correctly: a `trigger` carrying only `state`, or a `submission` carrying only
 * the `integrity` ledger the canvas itself wrote, was not authored — and must still
 * count as a shell that hands the work back.
 */
export function specBookkeepingFields(): readonly string[] {
  return [...new Set(allSpecObjectSpecs()
    .flatMap((spec) => spec.fields.filter((field) => field.bookkeeping || field.derived || field.derive).map((field) => field.name)))];
}

/**
 * The AUTHORABLE fields for one spec kind, in declaration order.
 *
 * `derived` fields are absent by construction. This is the single line that makes
 * "an LLM cannot write a mark" a property of the declaration rather than a rule
 * somebody has to remember in the tool handler.
 */
export function specMutableFields(kind: string): readonly string[] {
  const spec = specObjectSpec(kind);
  return spec
    ? ['content', ...spec.fields.filter((field) => !field.derived && !field.derive && !field.restricted).map((field) => field.name)]
    : ['content'];
}

/**
 * The value a field RENDERS — computed where the field says how, stored otherwise.
 *
 * THE one resolver. The node body and the emptiness predicate both used to read
 * `data[field.name]` directly, and a computed field added to only one of them is a card
 * that either draws a section with nothing in it or hides a number it could have shown.
 * See `SpecField.derive`.
 */
export function specFieldValue(
  field: SpecField,
  data: Record<string, unknown>,
  board: SpecDeriveBoard = EMPTY_SPEC_BOARD,
): unknown {
  return field.derive ? field.derive(data, board) : data[field.name];
}

/**
 * Does any of this kind's derivations look at its neighbours?
 *
 * Read off the declared ARITY, which is exact for the arrow functions a spec holds and
 * needs no second flag to fall out of step with the code beside it. It is what lets the
 * node body subscribe a `gradebook` to the board and leave a `workOrder` — whose every
 * derivation is arithmetic over its own rows — subscribed to nothing.
 *
 * Memoised on the registry index, so this is a `Map` read per render, not a scan.
 */
export function specKindReadsBoard(kind: string): boolean {
  const cached = boardReaders.get(kind);
  if (cached !== undefined) return cached;
  const spec = specObjectSpec(kind);
  const reads = !!spec?.fields.some((field) => !!field.derive && field.derive.length >= 2);
  boardReaders.set(kind, reads);
  return reads;
}

/**
 * Every computed field on one object, as a patch the AI snapshot merges.
 *
 * Without this the model reads a work order's parts and labour and cannot read what the
 * job cost — a number the card shows it and the prompt does not — which is the
 * authorable-but-unreadable drift in its exact mirror image, and just as damaging: asked
 * "which jobs lost money" the model would answer from the fields it happens to have.
 *
 * Returns only the fields that actually resolved, so a half-filled object contributes
 * nothing rather than a wall of nulls.
 */
export function specDerivedValues(
  kind: string,
  data: Record<string, unknown>,
  board: SpecDeriveBoard = EMPTY_SPEC_BOARD,
): Record<string, unknown> {
  const spec = specObjectSpec(kind);
  if (!spec) return {};
  return Object.fromEntries(spec.fields.flatMap((field) => {
    if (!field.derive || field.restricted) return [];
    const value = field.derive(data, board);
    return value === undefined || value === null ? [] : [[field.name, value]];
  }));
}

/**
 * The authorable fields for a whole vocabulary, as a map the registry can spread.
 *
 * One helper rather than the same `Object.fromEntries(specs.map(...))` written once per
 * vocabulary: five copies had already appeared, four of them typed `Record<string, …>`,
 * and an index-signature map does not PROVE its keys — so the registry's exhaustiveness
 * annotation silently stopped checking that every kind has mutable fields. The type
 * parameter is what restores it: a vocabulary that forgets a kind fails to compile.
 */
export function specMutableFieldMap<K extends string>(
  specs: readonly SpecObjectSpec[],
): Record<K, readonly string[]> {
  return Object.fromEntries(specs.map((spec) => [spec.kind, specMutableFields(spec.kind)])) as Record<K, readonly string[]>;
}

/**
 * The deadline-bearing fields on one kind, in declaration order.
 *
 * Declaration order is the resolution order: a `trigger` that names an object and no
 * field watches the FIRST one, so a kind with a single deadline needs no configuration
 * at all and a kind with two (a contract's `effectiveAt` and `renewsAt`, were both ever
 * marked) resolves to the one its author declared first.
 */
export function specDeadlineFields(kind: string): readonly string[] {
  const spec = specObjectSpec(kind);
  return spec ? spec.fields.filter((field) => field.deadline).map((field) => field.name) : [];
}

/**
 * Every kind that carries a deadline, across every vocabulary.
 *
 * Read by the trigger tool's model-facing description, so the model is told which
 * objects are watchable from the registry rather than from a prompt paragraph that
 * drifts from it — the contract `check-prompt-tool-names.mjs` holds for tool names,
 * applied to a vocabulary.
 */
export function deadlineBearingKinds(): readonly string[] {
  return allSpecObjectSpecs().filter((spec) => spec.fields.some((field) => field.deadline)).map((spec) => spec.kind);
}

/** Every field a spec kind owns that Brain may READ — authored or derived, never
 *  restricted. See `SpecField.restricted` for why that is a third axis. */
export function specReadableFields(kind: string): readonly string[] {
  const spec = specObjectSpec(kind);
  return spec ? spec.fields.filter((field) => !field.restricted).map((field) => field.name) : [];
}

/**
 * Every field name flagged `restricted`, across every vocabulary.
 *
 * Deliberately a flat name list rather than a per-kind map: a field name means one
 * thing across the canvas — which is what `CONTEXT_FIELDS` being flat already assumes —
 * so a name restricted anywhere is restricted everywhere. Over-restricting a name costs
 * a card that shows less; under-restricting one is a regulated disclosure.
 *
 * Read by the AI-context builder and by every export/share path.
 */
export function specRestrictedFields(): readonly string[] {
  return [...new Set(allSpecObjectSpecs()
    .flatMap((spec) => spec.fields.filter((field) => field.restricted).map((field) => field.name)))];
}

/**
 * Model-facing documentation for one spec kind: what each field is and what good
 * content looks like. Injected into `canvas_add_object`'s description so the model is
 * told the shape at the moment it authors one, rather than in a prompt paragraph that
 * drifts from the registry.
 *
 * A derived field is documented as READ-ONLY rather than omitted: a model that cannot
 * see `marks` exists will invent a place to put one, and the honest instruction is
 * "this exists, you may reason about it, you may not write it".
 */
export function specFieldGuidance(kind: string): string {
  const spec = specObjectSpec(kind);
  if (!spec) return '';
  const lines = spec.fields.map((field) => {
    const columns = field.columns ? ` Columns: ${field.columns.join(', ')}.` : '';
    const readOnly = field.derived ? ' READ-ONLY: written by the canvas, never by you.' : '';
    // Named and refused rather than omitted, for the same reason `derived` is: silence
    // invites the model to invent somewhere to put it, and a refusal it can see is a
    // refusal that shows up in the transcript.
    const restricted = field.restricted
      ? ' RESTRICTED: captured directly from the person it describes. You cannot read it and must never author, infer or repeat it — and must never let it influence a ranking or recommendation.'
      : '';
    return `• ${field.name} — ${field.hint}${columns}${readOnly}${restricted}`;
  });
  return `${spec.kind}:\n${lines.join('\n')}`;
}

/** Guidance for every kind in one set — the one place a vocabulary is taught. */
export function specSetGuidance(setId: string): string {
  const set = SETS.find((candidate) => candidate.id === setId);
  return set ? set.specs.map((spec) => specFieldGuidance(spec.kind)).join('\n\n') : '';
}
