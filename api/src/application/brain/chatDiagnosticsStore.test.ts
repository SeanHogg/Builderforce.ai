import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveChatDiagnostics,
  latestChatDiagnostics,
  DiagnosticsTooLargeError,
  MAX_REPORT_BYTES,
  MAX_REPORTS_PER_CHAT,
} from './chatDiagnosticsStore';
import { ValidationError, statusOf } from '../../domain/shared/errors';
import type { Db } from '../../infrastructure/database/connection';

/**
 * The store's job is the two things the ROUTE cannot check for itself: that a report
 * cannot outgrow the row it belongs in, and that a chat re-run fifty times does not leave
 * fifty verdicts nobody will read. Both are product decisions, so both are tested here
 * rather than inferred from a live table.
 *
 * Driven against an operation-typed fake of the Drizzle chains the helper actually calls —
 * no database (the same approach as `chatReadState.test.ts`).
 */

interface Captured {
  insertValues: Record<string, unknown> | null;
  deleted: boolean;
  selectLimit: number | null;
}
let captured: Captured;
/** What the retention SELECT (newest ids) answers with. */
let keptRows: Array<{ id: number }>;

/** Thenable select builder that resolves to `result` after any chain of methods. */
function selectBuilder(result: unknown[]) {
  const b: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'orderBy']) b[m] = () => b;
  b.limit = (n: number) => { captured.selectLimit = n; return b; };
  (b as { then: unknown }).then = (resolve: (v: unknown[]) => void) => resolve(result);
  return b;
}

function makeDb(): Db {
  return {
    select: () => selectBuilder(keptRows),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        captured.insertValues = v;
        return { returning: async () => [{ id: 7 }] };
      },
    }),
    delete: () => ({ where: async () => { captured.deleted = true; } }),
  } as unknown as Db;
}

const report = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  capturedAt: '2026-09-15T10:00:00.000Z',
  surface: 'vscode',
  likelyCause: 'tool_budget',
  chat: { id: 113 },
  run: { modelTurns: [], errorSteps: [] },
  ...over,
});

beforeEach(() => {
  captured = { insertValues: null, deleted: false, selectLimit: null };
  keptRows = [];
});

describe('saveChatDiagnostics', () => {
  it('lifts the indexed fields out of the report and stores the document whole', async () => {
    const saved = await saveChatDiagnostics(makeDb(), { chatId: 113, tenantId: 5, report: report() });

    expect(saved).toEqual({ id: 7 });
    expect(captured.insertValues).toMatchObject({
      chatId: 113,
      tenantId: 5,
      surface: 'vscode',
      schemaVersion: 1,
      likelyCause: 'tool_budget',
    });
    expect(captured.insertValues!.capturedAt).toEqual(new Date('2026-09-15T10:00:00.000Z'));
    // The whole report is kept — the columns are an index over it, not a replacement.
    expect(captured.insertValues!.report).toMatchObject({ chat: { id: 113 } });
  });

  it('records a capture that names no cause, rather than refusing it', async () => {
    // "We could not work out why" is itself a finding, and one worth counting.
    await saveChatDiagnostics(makeDb(), { chatId: 1, tenantId: 5, report: report({ likelyCause: null }) });
    expect(captured.insertValues!.likelyCause).toBeNull();
  });

  it('keeps the NOT NULL surface honest when the capture names none', async () => {
    await saveChatDiagnostics(makeDb(), { chatId: 1, tenantId: 5, report: report({ surface: '   ' }) });
    expect(captured.insertValues!.surface).toBe('unknown');
  });

  it('falls back to the arrival instant when capturedAt is not a real date', async () => {
    await saveChatDiagnostics(makeDb(), { chatId: 1, tenantId: 5, report: report({ capturedAt: 'whenever' }) });
    expect(captured.insertValues!.capturedAt).toBeInstanceOf(Date);
    expect(Number.isNaN((captured.insertValues!.capturedAt as Date).getTime())).toBe(false);
  });

  it('refuses anything that is not an object', async () => {
    for (const bad of ['a string', 42, null, ['an', 'array']]) {
      await expect(saveChatDiagnostics(makeDb(), { chatId: 1, tenantId: 5, report: bad }))
        .rejects.toBeInstanceOf(ValidationError);
    }
  });
});

describe('report size clamp', () => {
  /** An array of filler objects whose serialized size comfortably exceeds the cap. */
  const bulk = (n: number) => Array.from({ length: n }, (_, i) => ({ i, text: 'x'.repeat(200) }));

  it('drops the unbounded run arrays first, PRESERVING their counts', async () => {
    const turns = bulk(4000);
    await saveChatDiagnostics(makeDb(), {
      chatId: 1, tenantId: 5,
      report: report({ run: { modelTurns: turns, errorSteps: [] } }),
    });

    const stored = captured.insertValues!.report as { run: Record<string, unknown> };
    // "There were 4000 turns and here are none of them" is usable; "there were no
    // turns" would be false.
    expect(stored.run.modelTurns).toEqual([]);
    expect(stored.run.modelTurnsTruncated).toBe(4000);
    expect(new TextEncoder().encode(JSON.stringify(stored)).length).toBeLessThanOrEqual(MAX_REPORT_BYTES);
  });

  it('leaves a report that already fits completely untouched', async () => {
    const small = report({ run: { modelTurns: [{ model: 'a' }], errorSteps: [] } });
    await saveChatDiagnostics(makeDb(), { chatId: 1, tenantId: 5, report: small });
    expect(captured.insertValues!.report).toEqual(small);
  });

  it('refuses with a 413 when even the truncated report is too large', async () => {
    // The bulk sits OUTSIDE `run`, so dropping the truncatable arrays cannot save it.
    const oversized = report({ staffing: bulk(4000) });
    const err = await saveChatDiagnostics(makeDb(), { chatId: 1, tenantId: 5, report: oversized })
      .then(() => null, (e: unknown) => e);

    expect(err).toBeInstanceOf(DiagnosticsTooLargeError);
    // A payload that is too big is the caller's to fix, not a defect to report.
    expect(statusOf(err)).toBe(413);
  });
});

describe('retention', () => {
  it('deletes the older captures once a chat is at its cap', async () => {
    keptRows = Array.from({ length: MAX_REPORTS_PER_CHAT }, (_, i) => ({ id: 100 - i }));
    await saveChatDiagnostics(makeDb(), { chatId: 1, tenantId: 5, report: report() });

    expect(captured.selectLimit).toBe(MAX_REPORTS_PER_CHAT);
    expect(captured.deleted).toBe(true);
  });

  it('deletes nothing while a chat is still under the cap', async () => {
    keptRows = [{ id: 100 }, { id: 99 }];
    await saveChatDiagnostics(makeDb(), { chatId: 1, tenantId: 5, report: report() });
    expect(captured.deleted).toBe(false);
  });
});

describe('latestChatDiagnostics', () => {
  it('defaults to the single most recent capture', async () => {
    await latestChatDiagnostics(makeDb(), 113, 5);
    expect(captured.selectLimit).toBe(1);
  });

  it('never returns more than a chat can hold, whatever the caller asks for', async () => {
    await latestChatDiagnostics(makeDb(), 113, 5, 9999);
    expect(captured.selectLimit).toBe(MAX_REPORTS_PER_CHAT);
  });

  it('treats a junk limit as one rather than as none', async () => {
    await latestChatDiagnostics(makeDb(), 113, 5, 0);
    expect(captured.selectLimit).toBe(1);
  });
});
