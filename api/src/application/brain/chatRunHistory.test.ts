import { describe, expect, it } from 'vitest';
import {
  CHAT_RUN_HISTORY_LIMIT,
  MAX_CHAT_RUN_HISTORY_LIMIT,
  clampChatRunHistoryLimit,
  liveChatSubagentsOf,
  runAgentRefOf,
  toChatRunRecords,
  toChatSubagentRecord,
  type ChatRunRow,
} from './chatRunHistory';
import { childPayload, type CloudChildSpec } from '../runtime/cloudChildRuns';

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
  agentHostId: null,
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

describe('toChatRunRecords — WHERE the run executed', () => {
  /**
   * Every cloud run is the one engine on the durable runner; `github_actions` means its
   * sandbox was the repo's own runner. A payload stamped while a container ran its own
   * loop (`container`) reads as the one cloud runtime it now is.
   */
  it('reads the executor the dispatcher stamped on the payload', () => {
    const recs = toChatRunRecords(
      [
        row({ id: 200, payload: JSON.stringify({ executor: 'container' }) }),
        row({ id: 201, payload: JSON.stringify({ executor: 'durable' }) }),
        row({ id: 202, payload: JSON.stringify({ executor: 'github_actions' }) }),
      ],
      titles,
      names,
    );
    expect(recs.map((r) => r.executor)).toEqual(['durable', 'durable', 'github_actions']);
  });

  it('reads which sandbox served the run, and null for one with no stamp', () => {
    const recs = toChatRunRecords(
      [
        row({ id: 210, payload: JSON.stringify({ executor: 'durable', sandbox: 'container' }) }),
        row({ id: 211, payload: JSON.stringify({ executor: 'github_actions', sandbox: 'actions' }) }),
        row({ id: 212, payload: JSON.stringify({ executor: 'durable', sandbox: 'none' }) }),
        row({ id: 213, payload: JSON.stringify({ executor: 'durable' }) }),
        row({ id: 214, payload: JSON.stringify({ sandbox: 'bogus' }) }),
      ],
      titles,
      names,
    );
    expect(recs.map((r) => r.sandbox)).toEqual(['container', 'actions', 'none', null, null]);
  });

  it('is null — not a guess — for a run with no stamp or an executor that no longer exists', () => {
    // The in-request Worker executor was removed. A payload stamped by that build must
    // read as "not recorded", never be asserted as a surface the platform no longer has.
    const recs = toChatRunRecords(
      [row({ id: 203 }), row({ id: 204, payload: 'not json' }), row({ id: 205, payload: JSON.stringify({ executor: 'worker' }) })],
      titles,
      names,
    );
    expect(recs.map((r) => r.executor)).toEqual([null, null, null]);
  });

  it('names the on-prem MACHINE, and degrades to its id rather than to blank', () => {
    // Same rule the agent names follow: an id alone is as unreadable in a report about
    // where work ran as the raw agent uuids this history used to print.
    const hosts = new Map<number, string>([[7, 'studio-mac-mini']]);
    const [named, unknown] = toChatRunRecords(
      [row({ id: 206, agentHostId: 7 }), row({ id: 207, agentHostId: 9 })],
      titles,
      names,
      hosts,
    );
    expect(named!.hostId).toBe(7);
    expect(named!.hostName).toBe('studio-mac-mini');
    expect(unknown!.hostId).toBe(9);
    expect(unknown!.hostName).toBeNull();
  });

  it('leaves hostName null for an ordinary cloud run', () => {
    const rec = toChatRunRecords([row({ id: 208, payload: JSON.stringify({ executor: 'durable' }) })], titles, names)[0]!;
    expect(rec.hostId).toBeNull();
    expect(rec.hostName).toBeNull();
  });
});

const childSpec = (over: Partial<CloudChildSpec> = {}): CloudChildSpec => ({
  parentExecutionId: 41,
  rootExecutionId: 40,
  depth: 1,
  handle: 'a42',
  label: 'port auth',
  task: 'Move the auth middleware.',
  owner: 'Ada',
  ...over,
});

describe('toChatSubagentRecord — live children on the Agents list', () => {
  it('maps a child payload onto the existing ChatSubagentVM shape', () => {
    const payload = childPayload(JSON.stringify({ chatId: 7 }), childSpec());
    expect(toChatSubagentRecord({ id: 42, payload })).toEqual({
      key: '42',
      handle: 'a42',
      name: 'port auth',
      label: 'port auth',
      owner: 'Ada',
    });
  });

  it('prefers asAgent name, then persona, then the slice label', () => {
    expect(toChatSubagentRecord({
      id: 42,
      payload: childPayload(undefined, childSpec({ asAgent: { ref: 'bob', name: 'Bob' } })),
    })?.name).toBe('Bob');
    expect(toChatSubagentRecord({
      id: 42,
      payload: childPayload(undefined, childSpec({ persona: { name: 'Persona', brief: 'x' } })),
    })?.name).toBe('Persona');
  });

  it('returns null for a parent run or an unreadable payload', () => {
    expect(toChatSubagentRecord({ id: 1, payload: JSON.stringify({ chatId: 7 }) })).toBeNull();
    expect(toChatSubagentRecord({ id: 1, payload: null })).toBeNull();
    expect(toChatSubagentRecord({ id: 1, payload: 'not json' })).toBeNull();
  });
});

describe('liveChatSubagentsOf — payload chatId is this chat', () => {
  it('keeps only children whose originating chatId matches', () => {
    const ours = { id: 42, payload: childPayload(JSON.stringify({ chatId: 7 }), childSpec()) };
    const theirs = { id: 43, payload: childPayload(JSON.stringify({ chatId: 70 }), childSpec({ handle: 'a43' })) };
    expect(liveChatSubagentsOf(7, [ours, theirs]).map((s) => s.key)).toEqual(['42']);
  });

  it('drops a child whose payload has no chatId', () => {
    expect(liveChatSubagentsOf(7, [{ id: 42, payload: childPayload(undefined, childSpec()) }])).toEqual([]);
  });
});
