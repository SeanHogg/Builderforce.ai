import { describe, expect, it } from 'vitest';
import {
  CHAT_RUN_HISTORY_LIMIT,
  MAX_CHAT_RUN_HISTORY_LIMIT,
  clampChatRunHistoryLimit,
  runAgentRefOf,
  toChatRunRecords,
  type ChatRunRow,
} from './chatRunHistory';

/**
 * The projection from `executions` rows onto a chat's reported run history.
 *
 * The query is one thing to get right; this is the other, and it is where the rules
 * live — WHICH agent a run names, how a failure is trimmed, and the difference between
 * "the run has not been judged" and "the run produced nothing".
 */

const BOB = 'd02ff7ee-9cf2-4c44-8558-c89104f6278f';
const ADA = 'ada-1';

const row = (p: Partial<ChatRunRow> & { id: number }): ChatRunRow => ({
  taskId: 2466,
  status: 'completed',
  submittedBy: 'user:22c5fd96',
  source: 'vscode',
  cloudAgentRef: null,
  payload: null,
  produced: null,
  errorMessage: null,
  startedAt: null,
  completedAt: null,
  createdAt: new Date('2026-09-21T03:45:34.121Z'),
  ...p,
});

const titles = new Map<number, string | null>([[2466, 'Code change (1 file) from Brain chat #103']]);
const names = new Map<string, string>([[BOB, 'Bob'], [ADA, 'Ada']]);

describe('clampChatRunHistoryLimit — `limit` is untrusted input', () => {
  it('bounds a caller that asks for everything', () => {
    // The tool argument comes from a model. `executions` holds thousands of rows per busy
    // ticket, so an unbounded read here is how a diagnostic read becomes an outage.
    expect(clampChatRunHistoryLimit(100_000)).toBe(MAX_CHAT_RUN_HISTORY_LIMIT);
  });

  it('never returns zero or a negative page', () => {
    expect(clampChatRunHistoryLimit(0)).toBe(1);
    expect(clampChatRunHistoryLimit(-5)).toBe(1);
  });

  it('falls back to the default for a value that is not a number at all', () => {
    expect(clampChatRunHistoryLimit(Number.NaN)).toBe(CHAT_RUN_HISTORY_LIMIT);
    expect(clampChatRunHistoryLimit(Number.POSITIVE_INFINITY)).toBe(CHAT_RUN_HISTORY_LIMIT);
  });

  it('passes a sensible request through untouched', () => {
    expect(clampChatRunHistoryLimit(10)).toBe(10);
    expect(clampChatRunHistoryLimit(25.7)).toBe(25);
  });
});

describe('runAgentRefOf — WHO actually ran it', () => {
  it('prefers the stamped column and falls back to the payload for older rows', () => {
    expect(runAgentRefOf(row({ id: 1, cloudAgentRef: BOB }))).toBe(BOB);
    expect(runAgentRefOf(row({ id: 2, payload: JSON.stringify({ cloudAgentRef: ADA }) }))).toBe(ADA);
  });

  it('answers null rather than guessing when the run names nobody', () => {
    // A gateway-default / host run genuinely has no cloud agent. Inventing one here would
    // put a name against work that agent never did.
    expect(runAgentRefOf(row({ id: 3 }))).toBeNull();
    expect(runAgentRefOf(row({ id: 4, payload: 'not json' }))).toBeNull();
  });
});

describe('toChatRunRecords', () => {
  it('names the agent and the ticket, so a line reads without a lookup', () => {
    const rec = toChatRunRecords([row({ id: 91, cloudAgentRef: BOB })], titles, names)[0]!;
    expect(rec.agentName).toBe('Bob');
    expect(rec.agentRef).toBe(BOB);
    expect(rec.taskTitle).toBe('Code change (1 file) from Brain chat #103');
  });

  it('degrades an unresolvable agent to its ref, never to blank', () => {
    // An agent unhired since the run still has to render as SOMETHING: a blank reads as
    // "no agent ran this", which is a different and false claim.
    const rec = toChatRunRecords([row({ id: 92, cloudAgentRef: 'gone-1' })], titles, new Map())[0]!;
    expect(rec.agentName).toBe('gone-1');
  });

  it('carries submittedBy VERBATIM — the pathway is the point', () => {
    // `user:` vs `system:lane-auto` is the difference between "this conversation drove
    // the work" and "board autonomy did"; normalising it destroys the only evidence.
    const recs = toChatRunRecords(
      [row({ id: 93, submittedBy: 'system:lane-auto' }), row({ id: 94, submittedBy: 'user:22c5fd96' })],
      titles,
      names,
    );
    expect(recs.map((r) => r.submittedBy)).toEqual(['system:lane-auto', 'user:22c5fd96']);
  });

  it('keeps "not judged" distinct from "produced nothing"', () => {
    // NULL `produced` is a legacy row or a surface that does not route through finalize.
    // Collapsing it to false would report an unknown as a failure — and the autonomy
    // breaker reads the same field.
    const recs = toChatRunRecords(
      [row({ id: 95, produced: null }), row({ id: 96, produced: false }), row({ id: 97, produced: true })],
      titles,
      names,
    );
    expect(recs.map((r) => r.produced)).toEqual([null, false, true]);
  });

  it('trims a failure to its first line and caps it', () => {
    const long = `${'x'.repeat(400)}\nsecond line`;
    const trimmed = toChatRunRecords(
      [row({ id: 98, errorMessage: '  \n\nfetch failed\nstack frame 1' }), row({ id: 99, errorMessage: long })],
      titles,
      names,
    );
    const short = trimmed[0]!;
    const capped = trimmed[1]!;
    expect(short.errorMessage).toBe('fetch failed');
    expect(capped.errorMessage?.endsWith('…')).toBe(true);
    expect(capped.errorMessage!.length).toBeLessThanOrEqual(201);
  });

  it('emits timestamps as ISO strings so every surface formats one shape', () => {
    const rec = toChatRunRecords(
      [row({ id: 100, startedAt: new Date('2026-09-21T03:40:00.000Z'), completedAt: new Date('2026-09-21T03:59:00.000Z') })],
      titles,
      names,
    )[0]!;
    expect(rec.startedAt).toBe('2026-09-21T03:40:00.000Z');
    expect(rec.completedAt).toBe('2026-09-21T03:59:00.000Z');
    expect(rec.createdAt).toBe('2026-09-21T03:45:34.121Z');
  });

  it('leaves a ticket with no title null rather than inventing one', () => {
    const rec = toChatRunRecords([row({ id: 101, taskId: 9999 })], titles, names)[0]!;
    expect(rec.taskTitle).toBeNull();
  });
});
