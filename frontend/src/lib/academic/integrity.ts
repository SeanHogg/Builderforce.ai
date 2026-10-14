/**
 * Academic integrity, answered with EVIDENCE the canvas already holds.
 *
 * ── WHY THIS IS NOT A DETECTOR ───────────────────────────────────────────────────
 * Every "AI writing detector" on the market reports a probability, and at a cohort of
 * two hundred a 5% false-positive rate is ten students accused of misconduct by a
 * number nobody can interrogate. Those tools also fail hardest on non-native writers,
 * which turns a quality problem into a discrimination problem.
 *
 * The canvas does not need one. It is not a word processor receiving a finished file:
 * it is where the work was MADE, so it can answer the better question — not "does this
 * look machine-written" but "how did this artifact come to exist". Who edited it, when,
 * how much, and whether the text came from the learner, the assistant, an import or a
 * collaborator. That is a record, not an inference, and a student can see and dispute
 * it, which is the property an accusation must have.
 *
 * ── WHAT THE LEDGER IS FOR ───────────────────────────────────────────────────────
 * Two things, and they are different. For the LEARNER it is the basis of an honest
 * declaration — most coursework now permits assistance and requires disclosure, and
 * "I used it to restructure my argument and to check my derivation" is a sentence
 * nobody can write accurately from memory a week later. For the MARKER it is a check
 * that the declaration matches what happened, which is the only integrity question
 * worth asking when the tool is permitted.
 */

import { AUTHORSHIP_SOURCES, type AssessmentMode, type AuthorshipSource, isAuthorshipSource } from '@builderforce/creation-canvas-contract';

export { AUTHORSHIP_SOURCES, isAuthorshipSource };
export type { AuthorshipSource };

/** One recorded contribution. Emitted by the canvas as work happens, never authored. */
export interface AuthorshipEvent {
  source: AuthorshipSource;
  /** ISO instant. */
  at: string;
  /** Characters added or changed. Negative values (deletions) are counted as work
   *  done — editing down is authorship, and treating it as zero rewards padding. */
  characters: number;
  /** Which canvas object the edit landed on, so a ledger can be read per artifact. */
  objectId?: string;
}

export interface IntegrityRow {
  source: AuthorshipSource;
  edits: number;
  characters: number;
  firstAt: string;
  lastAt: string;
}

const text = (value: unknown, limit = 200): string =>
  typeof value === 'string' ? value.trim().slice(0, limit) : '';
const count = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Aggregate events into the ledger a submission carries.
 *
 * Ordered by the declared source vocabulary rather than by size, so the same submission
 * always renders its rows in the same order — a table that reorders itself as work
 * proceeds is one a marker cannot scan.
 */
export function buildIntegrityLedger(events: readonly AuthorshipEvent[]): readonly IntegrityRow[] {
  const bySource = new Map<AuthorshipSource, IntegrityRow>();
  for (const event of events) {
    if (!isAuthorshipSource(event.source)) continue;
    const at = text(event.at, 40);
    const existing = bySource.get(event.source);
    const characters = Math.abs(count(event.characters));
    if (!existing) {
      bySource.set(event.source, { source: event.source, edits: 1, characters, firstAt: at, lastAt: at });
      continue;
    }
    existing.edits += 1;
    existing.characters += characters;
    if (at && (!existing.firstAt || at < existing.firstAt)) existing.firstAt = at;
    if (at && (!existing.lastAt || at > existing.lastAt)) existing.lastAt = at;
  }
  return AUTHORSHIP_SOURCES.flatMap((source) => {
    const row = bySource.get(source);
    return row ? [row] : [];
  });
}

export function integrityFromNode(value: unknown): readonly IntegrityRow[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((raw): IntegrityRow[] => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    if (!isAuthorshipSource(row.source)) return [];
    return [{
      source: row.source,
      edits: count(row.edits),
      characters: count(row.characters),
      firstAt: text(row.firstAt, 40),
      lastAt: text(row.lastAt, 40),
    }];
  });
}

/** Share of the characters that came from the assistant, 0-100. */
export function assistantShare(rows: readonly IntegrityRow[]): number {
  const total = rows.reduce((sum, row) => sum + row.characters, 0);
  if (total <= 0) return 0;
  const assistant = rows.find((row) => row.source === 'assistant')?.characters ?? 0;
  return Math.round((assistant / total) * 1000) / 10;
}

/**
 * The verdict a marker sees, as a code the UI localises.
 *
 * `undeclared` is the only one that is an ALLEGATION, and it is stated narrowly: the
 * ledger shows assistance and the learner's declaration does not mention it. It is
 * never raised from the share alone, because a high assistant share on a task that
 * permitted assistance and was declared is not misconduct — it is the assignment
 * working as designed.
 */
export type IntegrityVerdict =
  | 'noRecord'
  | 'ownWork'
  | 'declaredAssistance'
  | 'undeclaredAssistance'
  | 'closedBookViolation';

/** Words in a declaration that count as disclosing assistance. Deliberately broad:
 *  a false "undeclared" is far more costly than a missed one, and the marker still
 *  reads the declaration. */
const DISCLOSURE = /\b(ai|assistant|brain|chatgpt|claude|copilot|llm|generat|machine|automat)/i;

export function integrityVerdict(
  rows: readonly IntegrityRow[],
  declaration: unknown,
  mode: AssessmentMode = 'open',
): IntegrityVerdict {
  if (!rows.length) return 'noRecord';
  const assistant = rows.find((row) => row.source === 'assistant');
  const usedAssistant = !!assistant && assistant.edits > 0;

  // In a closed-book assessment the assistant should have refused. A record of it
  // acting at all is a control failure, and is reported as one rather than graded.
  if (mode === 'closed' && usedAssistant) return 'closedBookViolation';
  if (!usedAssistant) return 'ownWork';
  return DISCLOSURE.test(text(declaration, 4_000)) ? 'declaredAssistance' : 'undeclaredAssistance';
}

/**
 * A draft disclosure sentence built from the ledger, for the learner to EDIT.
 *
 * Returned as parameters rather than prose because the UI is localised in five
 * languages — and offered as a draft rather than written automatically, because a
 * declaration the learner did not write is not a declaration. That is the same reason
 * `declaration` is authorable and `integrity` is derived.
 */
export interface DisclosureDraft {
  usedAssistant: boolean;
  assistantEdits: number;
  assistantPercent: number;
  firstAt: string;
  lastAt: string;
}

export function disclosureDraft(rows: readonly IntegrityRow[]): DisclosureDraft {
  const assistant = rows.find((row) => row.source === 'assistant');
  return {
    usedAssistant: !!assistant && assistant.edits > 0,
    assistantEdits: assistant?.edits ?? 0,
    assistantPercent: assistantShare(rows),
    firstAt: assistant?.firstAt ?? '',
    lastAt: assistant?.lastAt ?? '',
  };
}

/**
 * Fields that move without being authorship of the work.
 *
 * Identity, chrome, derived marking, and the ledger itself. A rename, a status
 * chip, a mark, or a provenance stamp is not "how this artifact came to exist"
 * — counting them would fill every verdict with noise and let a submit-click
 * look like a record of writing.
 */
const LEDGER_SKIP = new Set([
  'integrity', 'provenance', 'kind', 'id',
  'mark', 'feedback', 'placements', 'lateBy', 'markBreakdown',
  'status', 'subtitle', 'title', 'altText', 'deliverables',
  'submittedAt', 'assignmentRef', 'learnerRef', 'learnerName', 'attempt',
  'sources', 'fetchedAt', 'sourceDatasetId',
  'frameCollapsed', 'frameExpandedWidth', 'frameExpandedHeight',
  'viewport', 'campaignId', 'widgetStorage', 'resourceId', 'approvalMode',
  'roomDesign', 'roomLayout',
]);

function measure(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'string') return value.length;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).length;
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** Characters added or changed by a patch, skipping chrome / derived fields. */
function authorshipCharacters(before: Record<string, unknown>, patch: Record<string, unknown>): number {
  let total = 0;
  let moved = false;
  for (const [field, next] of Object.entries(patch)) {
    if (LEDGER_SKIP.has(field)) continue;
    if (same(before[field], next)) continue;
    moved = true;
    const from = measure(before[field]);
    const to = measure(next);
    total += Math.abs(to - from) || Math.max(to, from, 1);
  }
  return moved ? total : 0;
}

/**
 * Fold one event into an existing (already-aggregated) ledger.
 *
 * The submission stores rows, not the raw event log, so a write cannot replay
 * `buildIntegrityLedger` over history. Incrementing the matching row keeps
 * edit counts and first/last timestamps honest.
 */
export function appendIntegrityEvent(existing: unknown, event: AuthorshipEvent): IntegrityRow[] {
  if (!isAuthorshipSource(event.source)) return [...integrityFromNode(existing)];
  const at = text(event.at, 40);
  const characters = Math.abs(count(event.characters));
  const rows = integrityFromNode(existing).map((row) => ({ ...row }));
  const found = rows.find((row) => row.source === event.source);
  if (!found) {
    rows.push({ source: event.source, edits: 1, characters, firstAt: at, lastAt: at });
  } else {
    found.edits += 1;
    found.characters += characters;
    if (at && (!found.firstAt || at < found.firstAt)) found.firstAt = at;
    if (at && (!found.lastAt || at > found.lastAt)) found.lastAt = at;
  }
  return AUTHORSHIP_SOURCES.flatMap((source) => rows.filter((row) => row.source === source));
}

/** Combine ledgers from a submission and the artifacts it names. */
export function mergeIntegrityRows(...groups: readonly (readonly IntegrityRow[])[]): IntegrityRow[] {
  const bySource = new Map<AuthorshipSource, IntegrityRow>();
  for (const rows of groups) {
    for (const row of rows) {
      const existing = bySource.get(row.source);
      if (!existing) {
        bySource.set(row.source, { ...row });
        continue;
      }
      existing.edits += row.edits;
      existing.characters += row.characters;
      if (row.firstAt && (!existing.firstAt || row.firstAt < existing.firstAt)) existing.firstAt = row.firstAt;
      if (row.lastAt && (!existing.lastAt || row.lastAt > existing.lastAt)) existing.lastAt = row.lastAt;
    }
  }
  return AUTHORSHIP_SOURCES.flatMap((source) => {
    const row = bySource.get(source);
    return row ? [row] : [];
  });
}

/**
 * The ledger a marker should read for one submission: its own rows plus any
 * artifact object on the board that the submission names.
 *
 * Work often lives on a document the learner then hands in; writing the event
 * onto that document (the object that actually moved) and joining here is how
 * a verdict sees the turn without extra patches on the submission card.
 */
export function integrityFromSubmission(
  data: Record<string, unknown>,
  board: readonly { id: string; data: Record<string, unknown> }[] = [],
): readonly IntegrityRow[] {
  const own = integrityFromNode(data.integrity);
  const artifacts = Array.isArray(data.artifacts) ? data.artifacts : [];
  const names = new Set<string>();
  for (const item of artifacts) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const title = text(rec.title, 200);
    const id = text(rec.objectId ?? rec.id, 80);
    if (title) names.add(title);
    if (id) names.add(id);
  }
  if (!names.size || !board.length) return own;
  const related: IntegrityRow[][] = [];
  for (const node of board) {
    if (node.data.kind === 'submission') continue;
    const title = text(node.data.title, 200);
    if (!names.has(node.id) && !(title && names.has(title))) continue;
    const rows = integrityFromNode(node.data.integrity);
    if (rows.length) related.push([...rows]);
  }
  if (!related.length) return own;
  return mergeIntegrityRows(own, ...related);
}

/** Map a provenance / proposal actor onto the authorship vocabulary. */
export function authorshipSourceFromActor(kind: string | undefined): AuthorshipSource {
  if (kind === 'brain' || kind === 'agent') return 'assistant';
  if (kind === 'system') return 'imported';
  return 'learner';
}

/** Infer the source of a card/widget patch from a provenance trail already on it. */
export function authorshipSourceFromPatch(patch: Record<string, unknown>): AuthorshipSource {
  const trail = patch.provenance;
  if (!Array.isArray(trail) || trail.length === 0) return 'learner';
  const last = trail[trail.length - 1];
  if (!last || typeof last !== 'object') return 'learner';
  const by = (last as { by?: { kind?: unknown } }).by;
  return authorshipSourceFromActor(typeof by?.kind === 'string' ? by.kind : undefined);
}

/**
 * THE write half, in one call: the patch a caller is about to apply, with the
 * object's integrity ledger extended by the authored content it actually moved.
 *
 * Mirrors `patchWithProvenance`. Callers apply patches in one place each
 * (`updateNodeData` for `edits.patch`, the proposal stage for a tool turn), so
 * this is the primitive they share rather than each re-composing events. A
 * patch that moves no authored field comes back without `integrity` — and an
 * incoming `integrity` the caller tried to write is dropped, because the
 * ledger is derived.
 */
export function patchWithIntegrity<P extends Record<string, unknown>>(
  before: Record<string, unknown>,
  patch: P,
  source: AuthorshipSource,
  at: string,
  objectId?: string,
): P | (P & { integrity: IntegrityRow[] }) {
  const rest = { ...patch } as P;
  if ('integrity' in rest) delete (rest as Record<string, unknown>).integrity;
  const characters = authorshipCharacters(before, rest as Record<string, unknown>);
  if (characters <= 0) return rest;
  const event: AuthorshipEvent = { source, at, characters, ...(objectId ? { objectId } : {}) };
  return { ...rest, integrity: appendIntegrityEvent(before.integrity, event) };
}
