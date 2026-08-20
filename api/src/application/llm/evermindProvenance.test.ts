import { describe, expect, it } from 'vitest';
import { backfillEntryProvenance, hasRecordedProvenance, inferLegacyProvenance, type ProvenanceRow } from './evermindProvenance';

/**
 * The backfill exists to STOP a reader guessing — not to change what it concludes.
 *
 * So the property under test is equivalence, not correctness in isolation: for every
 * row shape, the verdict a reader reaches from the BARE legacy row and the verdict it
 * reaches from the BACKFILLED row must be identical. `graded` below is a verbatim
 * transcription of brain-ui's `evermindLearnedStatus`
 * (packages/brain-ui/src/evermind/learnedStatus.ts). It is duplicated here rather than
 * imported because the API Worker does not depend on the UI package — and this suite is
 * precisely what keeps the two honest across that boundary. If the reader's rules move,
 * this table must move with them and the equivalence assertions will say so.
 */
type Verdict = 'delta' | 'distilled' | 'self' | 'fault';

function graded(entry: ProvenanceRow): Verdict {
  if (entry.kind === 'delta') return 'delta';
  if (entry.distilled) return 'distilled';
  if (entry.skipReason) {
    if (entry.skipReason === 'not_pinned' || entry.skipReason === 'legacy') return 'self';
    return 'fault';
  }
  const prompt = entry.prompt?.trim();
  const text = entry.text?.trim();
  if (prompt && text && prompt === text) return 'fault';
  return 'self';
}

/** Every row shape the ring can hold, legacy and modern alike. */
const ROWS: Array<{ name: string; row: ProvenanceRow; verdict: Verdict; rewritten: boolean }> = [
  {
    name: 'legacy refine-mode row (run text answering a ticket)',
    row: { kind: 'text', prompt: 'Add retry to the webhook handler', text: 'Edited handler.ts; added exponential backoff.' },
    verdict: 'self',
    rewritten: true,
  },
  {
    name: 'legacy teach-a-task ECHO (text identical to the prompt)',
    row: { kind: 'text', prompt: 'How do I retry?', text: 'How do I retry?' },
    verdict: 'fault',
    rewritten: true,
  },
  {
    name: 'legacy row with no prompt at all',
    row: { kind: 'text', text: 'Some run output with no ticket attached.' },
    verdict: 'self',
    rewritten: true,
  },
  {
    name: 'legacy echo that differs only by surrounding whitespace',
    row: { kind: 'text', prompt: '  How do I retry? ', text: 'How do I retry?' },
    verdict: 'fault',
    rewritten: true,
  },
  {
    name: 'pre-diffed weight delta',
    row: { kind: 'delta', prompt: 'ticket 12' },
    verdict: 'delta',
    rewritten: false,
  },
  {
    name: 'modern distilled row',
    row: { kind: 'text', prompt: 'task', text: 'the ideal answer', distilled: true },
    verdict: 'distilled',
    rewritten: false,
  },
  {
    name: 'modern self-learned row (no teacher pinned)',
    row: { kind: 'text', prompt: 'task', text: 'run output', distilled: false, skipReason: 'not_pinned' },
    verdict: 'self',
    rewritten: false,
  },
  {
    name: 'modern teacher-fault row',
    row: { kind: 'text', prompt: 'task', distilled: false, skipReason: 'gateway_error' },
    verdict: 'fault',
    rewritten: false,
  },
  {
    name: 'modern row whose teacher was benched by the fault breaker',
    row: { kind: 'text', prompt: 'task', text: 'run output', distilled: false, skipReason: 'cooling' },
    verdict: 'fault',
    rewritten: false,
  },
];

describe('legacy provenance inference', () => {
  it.each(ROWS)('$name — the backfill never re-grades the row', ({ row, verdict }) => {
    const before = graded(row);
    expect(before).toBe(verdict);
    const after = backfillEntryProvenance(row) ?? row;
    expect(graded(after)).toBe(before);
  });

  it.each(ROWS)('$name — rewrites only what has no provenance of its own', ({ row, rewritten }) => {
    expect(backfillEntryProvenance(row) !== null).toBe(rewritten);
  });

  it('marks an inferred fault `unknown` and an inferred non-fault `legacy`', () => {
    expect(inferLegacyProvenance({ kind: 'text', prompt: 'q', text: 'q' })).toEqual({ distilled: false, skipReason: 'unknown' });
    expect(inferLegacyProvenance({ kind: 'text', prompt: 'q', text: 'a' })).toEqual({ distilled: false, skipReason: 'legacy' });
  });

  it('never claims `not_pinned` — that would invent a measurement nobody took', () => {
    for (const { row } of ROWS) {
      const inferred = inferLegacyProvenance(row);
      expect(inferred?.skipReason).not.toBe('not_pinned');
    }
  });

  it('is idempotent — a backfilled row is left alone on a second pass', () => {
    const legacy: ProvenanceRow = { kind: 'text', prompt: 'task', text: 'answer' };
    const once = backfillEntryProvenance(legacy)!;
    expect(hasRecordedProvenance(once)).toBe(true);
    expect(backfillEntryProvenance(once)).toBeNull();
  });

  it('preserves every other field on the row it rewrites', () => {
    const row = { kind: 'text' as const, prompt: 'task', text: 'answer', id: 12, version: 4, emb: 'AAAA' };
    expect(backfillEntryProvenance(row)).toMatchObject({ id: 12, version: 4, emb: 'AAAA', skipReason: 'legacy' });
  });

  it('treats a row that records only `distilled: false` as already provenanced', () => {
    // `distilled: false` alone is a recorded outcome (the merge ran and no teacher
    // shaped it), not an absence — overwriting its reason would destroy real data.
    expect(hasRecordedProvenance({ kind: 'text', distilled: false })).toBe(true);
    expect(backfillEntryProvenance({ kind: 'text', distilled: false })).toBeNull();
  });
});
