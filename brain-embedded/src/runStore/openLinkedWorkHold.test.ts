import { describe, expect, it } from 'vitest';
import type { PolicyContext } from '@builderforce/agent-run';
import type { BrainTraceEvent } from '../brainTriage';
import type { BrainRunContext } from './brainRunContext';
import { MAX_OPEN_WORK_HOLDS, openLinkedWorkHold } from './openLinkedWorkHold';
import type { BrainRunRequest } from './runTypes';

const EPIC = { kind: 'epic', ref: '6902', status: 'in_progress', exists: true, label: 'Implement the PRD' };
const page = (tickets: unknown[]) => ({ tickets, total: tickets.length, matched: tickets.length, hasMore: false });
/** The host's catalog carries the linked-ticket listing. */
const LISTING = { type: 'function', function: { name: 'builtin_chats_list_tickets' } };

/** A run in a bound chat whose listing answers `listed` (or throws it, when it is an Error). */
function fakeRun(listed: unknown, req: Partial<BrainRunRequest> = {}, serverChatId: number | null = 276, userRequest = 'Implement the full PRD.') {
  const calls: string[] = [];
  const runTool = async (name: string): Promise<unknown> => {
    calls.push(name);
    if (listed instanceof Error) throw listed;
    return listed;
  };
  const c = { trace: [] as BrainTraceEvent[], runTraceFrom: 0, listeners: new Set(), runId: 'r1' };
  const run = { c, req: { runTool, tools: [LISTING], ...req }, serverChatId, userRequest, metadata: { mode: 'work' } } as unknown as BrainRunContext;
  return { run, c, calls };
}

const ctx = (over: Partial<PolicyContext> = {}): PolicyContext =>
  ({ task: { dispatch: { source: 'chat' } }, content: "I haven't started the seeds migration.", ...over }) as unknown as PolicyContext;

const edit = (n: number): BrainTraceEvent => ({ ts: `t${n}`, category: 'tool', label: 'edit_file', args: { path: `src/${n}.ts` }, result: { ok: true } });
const labels = (c: { trace: BrainTraceEvent[] }) => c.trace.map((e) => e.label);

describe('openLinkedWorkHold', () => {
  it('records owned ticket evidence without scoring unrelated work', async () => {
    const { run, c } = fakeRun(page([
      { ...EPIC, status: 'done' },
      { ...EPIC, ref: '6999', status: 'done' },
    ]));
    c.trace.push({ ts: 't', category: 'tool', label: 'builtin_tasks_create', args: { title: 'Implement the PRD' }, result: { id: 6902 } });
    const state = {} as PolicyContext['state'];
    expect(await openLinkedWorkHold(run)(ctx({ state }))).toBeNull();
    expect(state.workObservations?.['linked-tickets']).toMatchObject([
      { id: '6902', evidence: { id: '6902', status: 'done' } },
    ]);
  });

  it('verifies child handoff references against the chat listing', async () => {
    const { run, calls } = fakeRun(page([
      { ...EPIC, ref: '6910', status: 'in_review' },
      { ...EPIC, ref: '6999', status: 'done' },
    ]), {}, 276, 'What happened?');
    run.childWorkRefs = new Set(['6910', 'outside-this-chat']);
    const state = {} as PolicyContext['state'];
    expect(await openLinkedWorkHold(run)(ctx({ state }))).toBeNull();
    expect(calls).toEqual(['builtin_chats_list_tickets']);
    expect(state.workObservations?.['linked-tickets']).toEqual([
      expect.objectContaining({ id: '6910', evidence: expect.objectContaining({ status: 'in_review' }) }),
    ]);
  });
  it('regression: chat #276 — an open linked epic holds a prose ending', async () => {
    const { run } = fakeRun(page([
      EPIC,
      { kind: 'task', ref: '6903', status: 'in_review', exists: true, label: 'Code change (3 files)' },
    ]));
    const block = await openLinkedWorkHold(run)(ctx());
    expect(block).toContain('#6902 epic "Implement the PRD" (in_progress)');
    expect(block).not.toContain('#6903');
    expect(block).toContain('CONTINUE EXECUTING');
    expect(block).toContain('blocked');
  });

  it('a question asked in a chat whose epic is in progress settles; once the run makes progress the epic holds it', async () => {
    const { run, c } = fakeRun(page([EPIC]), {}, 276, 'What does the FinanceLens module do?');
    const hold = openLinkedWorkHold(run);
    expect(await hold(ctx())).toBeNull();
    c.trace.push(edit(1));
    expect(await hold(ctx())).toContain('#6902');
  });

  it('a ticket the run CREATED is its own: held until it is done', async () => {
    const child = { kind: 'task', ref: '6910', status: 'todo', exists: true, label: 'Seeds migration' };
    const { run, c } = fakeRun(page([child]), {}, 276, 'What is left?');
    c.trace.push({ ts: 't', category: 'tool', label: 'builtin_tasks_create', args: { title: 'Seeds migration' }, result: { id: 6910 } });
    expect(await openLinkedWorkHold(run)(ctx())).toContain('#6910 task "Seeds migration" (todo)');
    const done = fakeRun(page([{ ...child, status: 'done' }]));
    done.c.trace.push({ ts: 't', category: 'tool', label: 'builtin_tasks_create', args: { title: 'Seeds migration' }, result: { id: 6910 } });
    expect(await openLinkedWorkHold(done.run)(ctx())).toBeNull();
  });

  it("a device filing's status is its LATEST move across both ids: in_progress by account id, then done by local id → not held", async () => {
    const LOCAL = '0b1c2d3e-0000-4000-8000-000000000004';
    const { run, c } = fakeRun(page([]), {}, null);
    c.trace.push(
      { ts: 't1', category: 'tool', label: 'ticket-create', args: { title: 'Slice', auto: true, reason: 'hand_off' }, result: { localId: LOCAL, syncId: 813 } },
      { ts: 't2', category: 'tool', label: 'builtin_tasks_update', args: { id: 813, status: 'in_progress' }, result: { ok: true } },
      { ts: 't3', category: 'tool', label: 'ticket-move', args: { id: LOCAL, status: 'done' }, result: { ok: true } },
    );
    expect(await openLinkedWorkHold(run)(ctx())).toBeNull();
  });

  it('a read-only shell command is not progress', async () => {
    const { run, c } = fakeRun(page([EPIC]));
    const hold = openLinkedWorkHold(run);
    expect(await hold(ctx())).toBeTruthy();
    c.trace.push({ ts: 'r', category: 'tool', label: 'run_command', args: { command: 'git status' }, result: { ok: true } });
    expect(await hold(ctx())).toBeNull();
  });

  it('a last-hold step that fell out of the bounded trace is not new progress', async () => {
    const { run, c } = fakeRun(page([EPIC]));
    const hold = openLinkedWorkHold(run);
    c.trace.push(edit(1));
    expect(await hold(ctx())).toBeTruthy();
    // The window dropped the step the hold was taken at: what is left cannot prove it came after the hold.
    c.trace = [edit(2)];
    expect(await hold(ctx())).toBeNull();
    expect(labels(c)).toContain('finish.open_work_released');
  });

  it('names in_review as an allowed end, and caps the listed tickets at 15', async () => {
    const many = Array.from({ length: 18 }, (_, i) => ({ kind: 'task', ref: String(100 + i), status: 'in_progress', exists: true }));
    const block = (await openLinkedWorkHold(fakeRun(page(many)).run)(ctx()))!;
    expect(block).toContain('"in_review"');
    expect(block).toContain('#114 task');
    expect(block).not.toContain('#115 task');
    expect(block).toContain('+3 more');
  });

  it('an untouched not-started ticket never holds the run; one the run touched does', async () => {
    const backlog = { kind: 'task', ref: '6905', status: 'backlog', exists: true, label: 'Seeds migration' };
    expect(await openLinkedWorkHold(fakeRun(page([backlog])).run)(ctx())).toBeNull();
    const touched = fakeRun(page([backlog]));
    touched.c.trace.push({ ts: 't', category: 'tool', label: 'builtin_tickets_from_delta', args: { taskId: 6905 }, result: { taskId: 6905 } });
    expect(await openLinkedWorkHold(touched.run)(ctx())).toContain('#6905 task "Seeds migration" (backlog)');
    const delta = fakeRun(page([{ ...backlog, ref: '7001', status: 'todo' }]));
    (delta.c as unknown as { deltaTicketId: number }).deltaTicketId = 7001;
    expect(await openLinkedWorkHold(delta.run)(ctx())).toContain('#7001');
  });

  it('bookkeeping is not progress: remember_fact and a chat post do not re-arm the hold; a commit does', async () => {
    const quiet = fakeRun(page([EPIC]));
    const hold = openLinkedWorkHold(quiet.run);
    expect(await hold(ctx())).toBeTruthy();
    quiet.c.trace.push({ ts: 'a', category: 'tool', label: 'remember_fact', args: {}, result: { ok: true } });
    quiet.c.trace.push({ ts: 'b', category: 'tool', label: 'builtin_chats_post_message', args: {}, result: { ok: true } });
    expect(await hold(ctx())).toBeNull();
    const busy = fakeRun(page([EPIC]));
    const again = openLinkedWorkHold(busy.run);
    expect(await again(ctx())).toBeTruthy();
    busy.c.trace.push({ ts: 'c', category: 'tool', label: 'git_commit', args: {}, result: { ok: true } });
    expect(await again(ctx())).toBeTruthy();
    busy.c.trace.push({ ts: 'd', category: 'tool', label: 'builtin_tasks_create', args: { title: 'slice' }, result: { id: 1 } });
    expect(await again(ctx())).toBeTruthy();
  });

  it('reads a device filing\'s status on its account id too, and leaves a synced filing to the listing', async () => {
    const LOCAL = '0b1c2d3e-0000-4000-8000-000000000002';
    const filed: BrainTraceEvent = { ts: 't', category: 'tool', label: 'ticket-create', args: { title: 'Slice', auto: true, reason: 'hand_off' }, result: { localId: LOCAL, syncId: 812 } };
    const movedBySyncId = fakeRun(page([]), {}, null);
    movedBySyncId.c.trace.push(filed, { ts: 't2', category: 'tool', label: 'builtin_tasks_update', args: { id: 812, status: 'done' }, result: { ok: true } });
    expect(await openLinkedWorkHold(movedBySyncId.run)(ctx())).toBeNull();
    // The listing carries it (done there): the stale device record does not hold the run.
    const listed = fakeRun(page([{ kind: 'task', ref: '812', status: 'done', exists: true }]));
    listed.c.trace.push(filed);
    expect(await openLinkedWorkHold(listed.run)(ctx())).toBeNull();
  });

  it('lets the run end once nothing it owns is open', async () => {
    const { run } = fakeRun(page([{ ...EPIC, status: 'done' }, { kind: 'task', ref: '1', status: 'blocked', exists: true }]));
    expect(await openLinkedWorkHold(run)(ctx())).toBeNull();
  });

  it('stands down for a child run, a conversation, an aborted run, a question to the person, and no tool runner', async () => {
    const listed = page([EPIC]);
    expect(await openLinkedWorkHold(fakeRun(listed, { lineage: {} as never }).run)(ctx())).toBeNull();
    expect(await openLinkedWorkHold(fakeRun(listed).run)(ctx({ task: { dispatch: { source: 'subagent', parentRunId: '9' } } } as never))).toBeNull();
    expect(await openLinkedWorkHold(fakeRun(listed, { chatMode: 'chat' }).run)(ctx())).toBeNull();
    const aborted = fakeRun(listed);
    (aborted.c as unknown as { abort: AbortController }).abort = new AbortController();
    (aborted.c as unknown as { abort: AbortController }).abort.abort();
    expect(await openLinkedWorkHold(aborted.run)(ctx())).toBeNull();
    const question = 'Which should I do first?\n- The seeds migration\n- The FinanceLens change';
    expect(await openLinkedWorkHold(fakeRun(listed).run)(ctx({ content: question }))).toBeNull();
    const noRunner = fakeRun(listed);
    (noRunner.run.req as { runTool?: unknown }).runTool = undefined;
    expect(await openLinkedWorkHold(noRunner.run)(ctx())).toBeNull();
  });

  it('reads no listing on a host whose catalog has none', async () => {
    const { run, calls, c } = fakeRun(page([EPIC]), { tools: [] });
    expect(await openLinkedWorkHold(run)(ctx())).toBeNull();
    expect(calls).toEqual([]);
    expect(c.trace).toEqual([]);
  });

  it('never holds on an unreadable listing, and traces why', async () => {
    const thrown = fakeRun(new Error('relay down'));
    expect(await openLinkedWorkHold(thrown.run)(ctx())).toBeNull();
    expect(thrown.c.trace.at(-1)).toMatchObject({ label: 'finish.open_work_unreadable' });
    expect(String(thrown.c.trace.at(-1)!.result)).toContain('relay down');
    const failed = fakeRun({ ok: false, error: 'Chat not found' });
    expect(await openLinkedWorkHold(failed.run)(ctx())).toBeNull();
    expect(labels(failed.c)).toContain('finish.open_work_unreadable');
  });

  it('releases a run that made no change after a hold, naming the open tickets', async () => {
    const { run, c } = fakeRun(page([EPIC]));
    const hold = openLinkedWorkHold(run);
    expect(await hold(ctx())).toBeTruthy();
    expect(await hold(ctx())).toBeNull();
    const released = c.trace.find((e) => e.label === 'finish.open_work_released')!;
    expect(released.args).toMatchObject({ reason: 'no_progress' });
    expect(String(released.result)).toContain('#6902');
    // Released for good: no further listing is read.
    expect(await hold(ctx())).toBeNull();
  });

  it('a host step is not progress; only a successful model mutation re-arms the hold', async () => {
    const { run, c } = fakeRun(page([EPIC]));
    const hold = openLinkedWorkHold(run);
    expect(await hold(ctx())).toBeTruthy();
    c.trace.push({ ts: 'a', category: 'tool', label: 'builtin_tickets_from_delta', args: { auto: true }, result: { ok: true } });
    c.trace.push({ ...edit(0), isError: true });
    expect(await hold(ctx())).toBeNull();
    expect(labels(c)).toContain('finish.open_work_released');
  });

  it(`caps the holds at ${MAX_OPEN_WORK_HOLDS} per run, then releases on the budget`, async () => {
    const { run, c } = fakeRun(page([EPIC]));
    const hold = openLinkedWorkHold(run);
    for (let i = 0; i < MAX_OPEN_WORK_HOLDS; i++) {
      c.trace.push(edit(i));
      expect(await hold(ctx())).toBeTruthy();
    }
    c.trace.push(edit(99));
    expect(await hold(ctx())).toBeNull();
    expect(c.trace.find((e) => e.label === 'finish.open_work_released')!.args).toMatchObject({ reason: 'budget', holds: MAX_OPEN_WORK_HOLDS });
  });

  it("holds an unbound chat for the tickets its hand-off filed on the device, until they are moved", async () => {
    const LOCAL = '0b1c2d3e-0000-4000-8000-000000000001';
    const { run, c, calls } = fakeRun(page([]), {}, null);
    c.trace.push({ ts: 't', category: 'tool', label: 'ticket-create', args: { title: 'Seeds migration', auto: true, reason: 'hand_off' }, result: { id: LOCAL } });
    const hold = openLinkedWorkHold(run);
    expect(await hold(ctx())).toContain(`#${LOCAL} task "Seeds migration" (backlog)`);
    expect(calls).toEqual([]);
    c.trace.push({ ts: 't2', category: 'tool', label: 'ticket-move', args: { id: LOCAL, status: 'done' }, result: { ok: true } });
    expect(await hold(ctx())).toBeNull();
  });
});
