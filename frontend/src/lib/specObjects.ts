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
   */
  derive?: (data: Record<string, unknown>) => unknown;
}

export interface SpecObjectSpec {
  kind: string;
  icon: string;
  /** Mirrors `CreationObjectGroup` in the registry; kept as a string to avoid a cycle. */
  group: string;
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
export function specFieldValue(field: SpecField, data: Record<string, unknown>): unknown {
  return field.derive ? field.derive(data) : data[field.name];
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
export function specDerivedValues(kind: string, data: Record<string, unknown>): Record<string, unknown> {
  const spec = specObjectSpec(kind);
  if (!spec) return {};
  return Object.fromEntries(spec.fields.flatMap((field) => {
    if (!field.derive || field.restricted) return [];
    const value = field.derive(data);
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
