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
