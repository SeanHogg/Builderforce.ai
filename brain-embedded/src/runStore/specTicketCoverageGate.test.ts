import { describe, expect, it } from 'vitest';
import type { PolicyContext } from '@builderforce/agent-run';
import type { BrainTraceEvent } from '../brainTriage';
import type { BrainRunContext } from './brainRunContext';
import { isSpecTicketingRequest, specPathsFor, specTicketCoverageGate } from './specTicketCoverageGate';
import type { BrainRunRequest } from './runTypes';

/** Chat #157440's request, verbatim. */
const REQUEST =
  'restructure [docs/specs/measure.md] to have a section that outlines the features and tasks… update that section with the current status ' +
  '(Incomplete or Complete). For all the items that are incomplete, create associated tickets to this chat and complete all the requirements.';

const SPEC = [
  '## Features and tasks — status',
  '| ID | Feature / task | Status |',
  '|---|---|---|',
  '| P25-01 | Presets | Complete |',
  '| P25-09 | Slice D benchmark seeds for the other eight verticals | Incomplete |',
  '| P33-01 | D18 event lake | Blocked — operator |',
].join('\n');

const LISTING = { type: 'function', function: { name: 'builtin_chats_list_tickets' } };
const page = (tickets: unknown[]) => ({ tickets, total: tickets.length, matched: tickets.length, hasMore: false });
const ticket = (ref: string, label: string, status = 'todo') => ({ kind: 'task', ref, status, exists: true, label });

/** A bound work-mode run whose `read_file` serves `files` and whose chat listing answers `listed`. */
function fakeRun(listed: unknown, opts: { request?: string; files?: Record<string, string>; req?: Partial<BrainRunRequest>; deltaTicketId?: number | null } = {}) {
  const files = opts.files ?? { 'docs/specs/measure.md': SPEC };
  const calls: Array<{ name: string; args: unknown }> = [];
  const runTool = async (name: string, args: unknown): Promise<unknown> => {
    calls.push({ name, args });
    if (name === 'read_file') {
      const path = (args as { path: string }).path;
      const content = files[path];
      return content == null ? { ok: false, error: `not found: ${path}` } : { ok: true, path, content, totalLines: content.split('\n').length, offset: 1, truncated: false };
    }
    return listed;
  };
  const c = { trace: [] as BrainTraceEvent[], runTraceFrom: 0, listeners: new Set(), runId: 'r1', deltaTicketId: opts.deltaTicketId ?? null };
  const run = {
    c, req: { runTool, tools: [LISTING], ...opts.req }, serverChatId: 157440, userRequest: opts.request ?? REQUEST, metadata: { mode: 'work' },
  } as unknown as BrainRunContext;
  return { run, c, calls };
}

const ctx = (content = 'Done: the status section is up to date.'): PolicyContext =>
  ({ task: { dispatch: { source: 'chat' } }, content }) as unknown as PolicyContext;
const labels = (c: { trace: BrainTraceEvent[] }) => c.trace.map((e) => e.label);

describe('specTicketCoverageGate', () => {
  it('regression: chat #157440 — an incomplete row and a blocked row with no ticket hold the finish, listed with status and line', async () => {
    const { run, c } = fakeRun(page([]));
    const block = (await specTicketCoverageGate(run)(ctx()))!;
    expect(block).toContain('- P25-09 "Slice D benchmark seeds for the other eight verticals" (incomplete; docs/specs/measure.md:5)');
    expect(block).toContain('- P33-01 "D18 event lake" (blocked, blocker: operator; docs/specs/measure.md:6)');
    expect(block).not.toContain('P25-01');
    expect(block).toContain('builtin_tasks_create');
    expect(block).toMatch(/status "blocked"/);
    expect(labels(c)).toContain('finish.spec_tickets_held');
  });

  it('a backstop code-change ticket, and the run\'s delta ticket, never cover an item', async () => {
    const { run } = fakeRun(page([
      ticket('7001', 'Code change (4 files) from Brain chat #157440', 'in_review'),
      ticket('7002', 'P25-09 and P33-01 work', 'in_review'),
    ]), { deltaTicketId: 7002 });
    const block = (await specTicketCoverageGate(run)(ctx()))!;
    expect(block).toContain('P25-09');
    expect(block).toContain('P33-01');
  });

  it('an id-matched ticket covers its item (a blocked item by a blocked ticket); all covered ⇒ no hold', async () => {
    const { run } = fakeRun(page([
      ticket('6925', 'P25-09: seed the other verticals'),
      ticket('6926', '[P33-01] Event lake — operator provisions the pipeline', 'blocked'),
    ]));
    expect(await specTicketCoverageGate(run)(ctx())).toBeNull();
  });

  it('a ticket the run filed this turn covers its item before the listing shows it', async () => {
    const { run, c } = fakeRun(page([ticket('6926', 'P33-01 event lake', 'blocked')]));
    c.trace.push({ ts: 't', category: 'tool', label: 'builtin_tasks_create', args: { title: 'Seed the verticals', description: 'Covers P25-09.' }, result: { id: 7100 } });
    expect(await specTicketCoverageGate(run)(ctx())).toBeNull();
  });

  it('is inactive when the request is not a ticketing request, or names and read no spec', async () => {
    const plain = fakeRun(page([]), { request: 'Restructure docs/specs/measure.md for readability.' });
    expect(await specTicketCoverageGate(plain.run)(ctx())).toBeNull();
    expect(plain.calls).toEqual([]);
    const noSpec = fakeRun(page([]), { request: 'Create tickets for the incomplete items.' });
    expect(await specTicketCoverageGate(noSpec.run)(ctx())).toBeNull();
  });

  it('finds the spec in the run\'s read_file trace when the request names none', async () => {
    const { run, c } = fakeRun(page([]), { request: 'Create tickets for the open items in the spec you just read.' });
    c.trace.push({ ts: 't', category: 'tool', label: 'read_file', args: { path: 'docs/specs/measure.md' }, result: { ok: true } });
    expect(await specTicketCoverageGate(run)(ctx())).toContain('P25-09');
  });

  it('is bounded: the first repeat asks for the unticketed items in the report, the second repeat releases', async () => {
    const { run, c } = fakeRun(page([]));
    const gate = specTicketCoverageGate(run);
    expect(await gate(ctx())).toContain('File ONE ticket per item');
    const report = (await gate(ctx()))!;
    expect(report).toContain('final report MUST list');
    expect(report).toContain('P25-09');
    expect(await gate(ctx())).toBeNull();
    expect(labels(c)).toContain('finish.spec_tickets_released');
    expect(await gate(ctx())).toBeNull();
  });

  it('releases on the first repeat when the final report already lists the unticketed items', async () => {
    const { run, c } = fakeRun(page([]));
    const gate = specTicketCoverageGate(run);
    await gate(ctx());
    expect(await gate(ctx('Unticketed: P25-09 (incomplete) and P33-01 (blocked — operator).'))).toBeNull();
    expect(c.trace.find((e) => e.label === 'finish.spec_tickets_released')!.result).toMatch(/final report lists them/);
  });

  it('a spec or listing that cannot be read never holds the run, and says so', async () => {
    const unreadable = fakeRun(page([]), { files: {} });
    expect(await specTicketCoverageGate(unreadable.run)(ctx())).toBeNull();
    expect(labels(unreadable.c)).toContain('finish.spec_tickets_unreadable');
    const failedListing = fakeRun({ ok: false, error: 'boom' });
    expect(await specTicketCoverageGate(failedListing.run)(ctx())).toBeNull();
    expect(labels(failedListing.c)).toContain('finish.spec_tickets_unreadable');
  });

  it('stands down for a chat-mode run, a sub-agent and a turn that asks the person', async () => {
    expect(await specTicketCoverageGate(fakeRun(page([]), { req: { chatMode: 'chat' } }).run)(ctx())).toBeNull();
    expect(await specTicketCoverageGate(fakeRun(page([]), { req: { lineage: {} as never } }).run)(ctx())).toBeNull();
    const question = 'Which should I file first?\n- The seeds ticket\n- The event lake ticket';
    expect(await specTicketCoverageGate(fakeRun(page([])).run)(ctx(question))).toBeNull();
  });
});

describe('the gate\'s request reading', () => {
  it('recognises the three verbatim requests and the common phrasings', () => {
    expect(isSpecTicketingRequest('restructure [docs/specs/measure.md] to have a section that outlines the features and tasks')).toBe(true);
    expect(isSpecTicketingRequest('update that section with the current status (Incomplete or Complete)')).toBe(true);
    expect(isSpecTicketingRequest('For all the items that are incomplete, create associated tickets to this chat')).toBe(true);
    expect(isSpecTicketingRequest('create tickets for every row')).toBe(true);
    expect(isSpecTicketingRequest('list the open items')).toBe(true);
    expect(isSpecTicketingRequest('ticket the incomplete items')).toBe(true);
    expect(isSpecTicketingRequest('fix the login redirect loop')).toBe(false);
  });

  it('takes the specs the request names, never a README', () => {
    expect(specPathsFor('see [docs\\specs\\measure.md] and README.md', [])).toEqual(['docs/specs/measure.md']);
  });
});
