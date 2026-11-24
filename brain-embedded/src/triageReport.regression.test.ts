/**
 * Regressions for the copied "Chat diagnostics" report (VSIX 2026.10.191): one test per
 * way the report was wrong or wasteful on chats #273 / #275.
 */
import { describe, expect, it } from 'vitest';
import { computeBrainDiagnostics, formatBrainDiagnostics, type BrainTraceEvent } from './brainTriage';
import { computeRunProgress } from './runProgress';
import { formatRunProgress } from './runProgressReport';
import { createPayloadBudget } from './transcriptBudget';
import { staffingSummaryInTrace } from './staffingSummary';
import { formatChatDiagnostics, type ChatDiagnosticsData } from './chatDiagnostics';
import { gatherChatDiagnostics } from './gatherChatDiagnostics';
import { formatSubagentDiagnostics, type SubagentDiagnosticsInput } from './subagentDiagnostics';
import type { BrainMessage } from './types';

const at = (sec: number): string => new Date(Date.UTC(2026, 10, 19, 0, 0, sec)).toISOString();
const msg = (sec: number, role: 'user' | 'assistant', content: string): BrainMessage =>
  ({ id: sec, role, content, metadata: null, seq: sec, createdAt: at(sec) }) as BrainMessage;
const turn = (sec: number): BrainTraceEvent => ({ ts: at(sec), category: 'llm', label: 'llm.complete', args: { toolCalls: 1 } });
const tool = (sec: number, label: string, args: unknown, result: unknown, isError = false): BrainTraceEvent =>
  ({ ts: at(sec), category: 'tool', label, args, result, ...(isError ? { isError: true } : {}) });
const cmd = (sec: number, command: string, ok: boolean): BrainTraceEvent =>
  tool(sec, 'run_command', { command }, { ok, exitCode: ok ? 0 : 1, stdout: ok ? 'passed' : 'FAILED' }, !ok);
const edit = (sec: number, path: string): BrainTraceEvent =>
  tool(sec, 'edit_file', { path, old_string: 'a', new_string: 'b' }, { ok: true });

describe('triage report regressions', () => {
  it('reports missing acceptance evidence even after a successful search and a prose verdict', () => {
    const events: BrainTraceEvent[] = [
      turn(1), tool(2, 'search_code', { query: 'spawnChild' }, { ok: true }),
      { ts: at(3), category: 'message', label: 'run.spec_validation', args: { completed: 0, failed: 0, pending: 0, unverified: 2, incomplete: true } },
    ];
    const d = computeBrainDiagnostics(events, undefined, [msg(0, 'user', 'Validate the PRD.'), msg(3, 'assistant', 'All checks passed.')]);
    expect(d.likelyCause).toBe('spec-validation-incomplete');
    expect(formatBrainDiagnostics(d).join('\n')).toContain('Declared acceptance checks still unverified: 2');
  });
  it('regression: a run whose failed steps were each recovered by a later retry, and that shipped, reads healthy (chat #275)', () => {
    const events = [
      turn(1),
      cmd(2, 'pnpm check:a', false), edit(3, 'src/a.ts'), cmd(4, 'pnpm check:a', true),
      cmd(5, 'pnpm check:b', false), edit(6, 'src/b.ts'), cmd(7, 'pnpm check:b', true),
      cmd(8, 'pnpm check:c', false), edit(9, 'src/c.ts'), cmd(10, 'pnpm check:c', true),
      cmd(11, 'pnpm check', true),
      tool(12, 'git_commit', { message: 'fix guards' }, { ok: true }),
      tool(13, 'git_push', {}, { ok: true }),
      turn(14),
    ];
    const d = computeBrainDiagnostics(events, undefined, [msg(0, 'user', 'fix the 3 failing guards, then commit and push')]);
    expect(d.errors).toBe(3);
    expect(d.recoveredFailures).toBe(3);
    expect(d.likelyCause).toBe('healthy');
    const text = formatBrainDiagnostics(d);
    expect(text[1]).toContain('Completed — 3 failed step(s) recovered');
    expect(text.join('\n')).not.toContain('Inconclusive');
    expect(text.join('\n')).toContain('(recovered by a later successful retry)');
  });

  it('regression: an unrecovered failure still blocks healthy', () => {
    const d = computeBrainDiagnostics([turn(1), edit(2, 'a.ts'), cmd(3, 'pnpm check', false), turn(4)], undefined, [msg(0, 'user', 'fix it')]);
    expect(d.recoveredFailures).toBe(0);
    expect(d.likelyCause).not.toBe('healthy');
  });

  it('regression: a DIFFERENT command succeeding later does not recover a failed one', () => {
    const d = computeBrainDiagnostics(
      [turn(1), edit(2, 'a.ts'), cmd(3, 'pnpm test', false), cmd(4, 'git status', true), turn(5)],
      undefined, [msg(0, 'user', 'fix the tests')],
    );
    expect(d.recoveredFailures).toBe(0);
    expect(d.likelyCause).not.toBe('healthy');
  });

  it('regression: a failed edit of one file is not recovered by an edit of another, nor by a success later re-failed', () => {
    const failedEdit = (sec: number, path: string): BrainTraceEvent =>
      tool(sec, 'edit_file', { path, old_string: 'a', new_string: 'b' }, { ok: false, error: 'old_string not found' }, true);
    const other = computeBrainDiagnostics([turn(1), failedEdit(2, 'a.ts'), edit(3, 'b.ts'), turn(4)], undefined, [msg(0, 'user', 'fix a.ts')]);
    expect(other.recoveredFailures).toBe(0);
    const refailed = computeBrainDiagnostics(
      [turn(1), cmd(2, 'pnpm test', false), edit(3, 'a.ts'), cmd(4, 'pnpm test', true), edit(5, 'b.ts'), cmd(6, 'pnpm test', false), turn(7)],
      undefined, [msg(0, 'user', 'fix the tests')],
    );
    expect(refailed.recoveredFailures).toBe(0);
    expect(refailed.likelyCause).not.toBe('healthy');
  });

  it('regression: a capture taken mid-run names no verdict and makes no "nothing changed" claim (chat #273 run #6)', () => {
    const events = [turn(1), tool(2, 'read_file', { path: 'a.ts' }, { ok: true }), tool(3, 'read_file', { path: 'b.ts' }, { ok: true })];
    const d = computeBrainDiagnostics(events, undefined, [msg(0, 'user', 'change the header colour')], { running: true });
    expect(d.likelyCause).toBe('run-in-progress');
    const text = formatBrainDiagnostics(d).join('\n');
    expect(text).toContain('Run in progress — verdict pending');
    expect(text).not.toContain('Inconclusive');
    expect(text).not.toContain('NOTHING WAS CHANGED');
    expect(text).toContain('run in progress — no effect verdict yet');
  });

  it('regression: multi-run figures are labelled as the latest run and carry chat totals', () => {
    const p = computeRunProgress(
      [turn(1), tool(2, 'read_file', { path: 'a.ts' }, { ok: true }), edit(3, 'a.ts'), turn(61), tool(62, 'read_file', { path: 'b.ts' }, { ok: true })],
      [msg(0, 'user', 'change a.ts'), msg(60, 'user', 'now look at b.ts')],
    );
    const lines = formatRunProgress(p);
    expect(lines.find((l) => l.includes('Progress:'))).toMatch(/^Latest run \(#2 of 2\) · Progress:/);
    expect(lines.some((l) => l.startsWith('Chat totals (2 runs): 2 turn(s) · 3 call(s) · 1 change(s)'))).toBe(true);
    expect(lines.find((l) => l.includes('Time:'))).toMatch(/^Latest run \(#2 of 2\) · Time:/);
  });

  it('regression: paged list-tool calls count as targets, and a re-fetched page is a revisit (chat #273)', () => {
    const pages = Array.from({ length: 15 }, (_, i) =>
      tool(i + 1, 'builtin_tasks_list', { status: 'open', offset: (i % 10) * 50, limit: 50 }, { ok: true, items: [] }));
    const p = computeRunProgress([turn(0), ...pages]);
    expect(p.targetedCalls).toBe(15);
    expect(p.distinctTargets).toBe(10);
    expect(p.repeatedTargets.length).toBe(5);
    expect(formatRunProgress(p)[0]).not.toContain('no targeted calls');
  });

  it('regression: polling an unpaged list tool is not a revisit and never reads as no-progress', () => {
    // Poll, look at something new, poll again — counted as targets, the 7 re-polls would be
    // 7 revisits of 16 calls (44%) and the run would read as spinning.
    const polls = Array.from({ length: 8 }, (_, i) => [
      tool(2 * i + 1, 'builtin_executions_list', { status: 'running' }, { ok: true, items: [{ id: 1, status: 'running' }] }),
      tool(2 * i + 2, 'read_file', { path: `logs/step${i}.txt` }, { ok: true, content: 'still running' }),
    ]).flat();
    const d = computeBrainDiagnostics([turn(0), ...polls, turn(20)], undefined, [msg(0, 'user', 'watch the run until it finishes')]);
    expect(d.progress.spinning).toBe(false);
    expect(d.likelyCause).not.toBe('no-progress');
  });

  it('regression: the budget keeps a mutating command and write args after reads drained the pool', () => {
    const b = createPayloadBudget({ total: 4_000, perPayload: 2_000, minPayload: 200 });
    for (let i = 0; i < 4; i++) b.cap(`read ${i} `.repeat(400), 'Output');
    const command = b.cap(`$ git commit -m "fix guards" && git push`, 'Command');
    expect(command).toBe('$ git commit -m "fix guards" && git push');
    const args = JSON.stringify({ path: 'src/a.ts', old_string: 'x'.repeat(300), new_string: 'y'.repeat(300) }, null, 2);
    expect(b.cap(args, 'Input')).toBe(args);
  });

  it('regression: the hold for high-priority payloads never starves the tail when none arrive', () => {
    // A read-heavy run with NO high-priority payload: the final reply still prints.
    const b = createPayloadBudget({ total: 6_000, perPayload: 2_000, minPayload: 200, highPriorityDemand: 0 });
    for (let i = 0; i < 2; i++) b.cap(`read ${i} `.repeat(400), 'Output');
    const tail = b.cap('FINAL '.repeat(200), 'assistant reply');
    expect(tail).toBe('FINAL '.repeat(200));
    // Undeclared demand holds the share, but a normal payload still gets the floor.
    const held = createPayloadBudget({ total: 6_000, perPayload: 4_200, minPayload: 200 });
    held.cap('r'.repeat(10_000), 'Output');
    const last = held.cap('FINAL '.repeat(200), 'assistant reply');
    expect(last.startsWith('FINAL FINAL')).toBe(true);
    expect(last).not.toContain('omitted');
  });

  it('regression: the final reply and last user message print even when high-priority demand exceeds the whole budget', () => {
    const lastAsk = 'ASK '.repeat(100);
    const finalReply = 'FINAL '.repeat(300);
    const b = createPayloadBudget({
      total: 5_000, perPayload: 2_000, minPayload: 200,
      highPriorityDemand: 20_000, tailReserve: lastAsk.length + finalReply.length,
    });
    // Errors and diffs near the top, far more than the budget holds.
    for (let i = 0; i < 10; i++) b.cap(`{"ok": false, "error": "boom ${i} ${'x'.repeat(2_000)}"}`, 'Output', undefined, 'high');
    expect(b.cap(lastAsk, 'user message', 3_000, 'tail')).toBe(lastAsk);
    expect(b.cap(finalReply, 'assistant reply', 6_000, 'tail')).toBe(finalReply);
  });

  it('regression: tiny repeated blocks are reprinted, never dropped or back-referenced', () => {
    const b = createPayloadBudget({ total: 50_000, perPayload: 8_000 });
    const input = '{"cwd": "C:/code/agentic/Builderforce.ai"}';
    for (let i = 0; i < 5; i++) expect(b.fence('Input', input)).toEqual(['Input:', '```', input, '```']);
    expect(b.fence('Command', '$ pnpm test')).toHaveLength(4);
    expect(b.fence('Command', '$ pnpm test')).toEqual(['Command:', '```', '$ pnpm test', '```']);
    expect(b.stats().deduped).toBe(0);
    expect(b.fence('Input', '')).toEqual([]);
  });

  it('regression: work filed then shipped by the session itself is self-served, not filed-not-staffed', () => {
    const events = [
      tool(1, 'builtin_tasks_create', { title: 'fix guards' }, { ok: true, id: 1 }),
      edit(2, 'src/a.ts'),
      tool(3, 'git_commit', { message: 'x' }, { ok: true }),
    ];
    expect(staffingSummaryInTrace(events).verdict).toBe('self-served');
    const d = computeBrainDiagnostics([turn(0), ...events], undefined, [msg(0, 'user', 'fix the guards')]);
    expect(d.likelyCause).not.toBe('work-filed-not-staffed');
  });

  it('regression: the chat block words zero dispatch on a self-served chat neutrally', async () => {
    const data = await gatherChatDiagnostics({
      surface: 'test',
      trace: [edit(1, 'src/a.ts'), tool(2, 'git_push', {}, { ok: true })],
      readAgents: async () => [{ agentRef: 'r1', role: 'participant', name: 'Bob' }],
      readRuns: async () => ({ linkedRunnableTickets: 2, runs: [], dispatchers: [] }),
    });
    expect(data.sessionWork).toBe(2);
    expect(data.sessionShipped).toBe(0);
    const text = formatChatDiagnostics(data).join('\n');
    expect(text).toContain('Execution history: self-served');
    expect(text).not.toContain('ZERO runs');
    expect(text).not.toContain('No cloud agent has ever been dispatched');
    expect(text).toContain('ℹ️ Self-served');
    expect(text).toContain('A push to the base branch is unverified');
  });

  it('regression: the free-plan signal does not claim what the account data contradicts', () => {
    const base: ChatDiagnosticsData = { surface: 'test', projectId: 1, selectedProjectId: 1 };
    const entitled = formatChatDiagnostics({
      ...base,
      account: { plan: 'free', billingStatus: 'none', canUsePremiumModels: true, byoProviders: ['anthropic'], modelFunding: 'byo:anthropic', servedBy: 'own' },
    }).join('\n');
    expect(entitled).toContain('premium models entitled');
    expect(entitled).not.toContain('no premium/frontier models');
    expect(entitled).not.toContain('funded by the shared free pool');
    const plain = formatChatDiagnostics({ ...base, account: { plan: 'free', billingStatus: 'none', canUsePremiumModels: false } }).join('\n');
    expect(plain).toContain('no premium/frontier models, and');
    expect(plain).toContain('turns funded by the shared free pool');
    const own = formatChatDiagnostics({
      ...base,
      account: { plan: 'free', billingStatus: 'none', canUsePremiumModels: false, model: 'local/kimi-code/kimi-for-coding', modelFunding: 'premium', servedBy: 'own' },
    }).join('\n');
    expect(own).toContain('your own connected provider account');
    expect(own).not.toMatch(/402|falls back|shared plan does not cover/i);
  });

  it('regression: a sub-agent that ended on a question or an unproduced deliverable is not "done" (chat #273)', () => {
    const child = (lastMessage: string): SubagentDiagnosticsInput => ({
      handle: 'a1', name: 'Analyst', label: 'alignment report', owner: 'Brain', depth: 1, running: false, events: [], lastMessage,
    });
    const asked = formatSubagentDiagnostics([child(
      'I have enough to produce the report.\n\n```ask-user\n{"question":"Which scope?","options":["All","Frontend"]}\n```',
    )], 0).join('\n');
    expect(asked).toContain('State: ENDED ON A QUESTION');
    expect(asked).toContain('Last message:');
    const announced = formatSubagentDiagnostics([child('I have enough to write the alignment report.')], 0).join('\n');
    expect(announced).toContain('State: ENDED WITHOUT ITS DELIVERABLE');
    const done = formatSubagentDiagnostics([child('Report: all 12 endpoints are aligned; two gaps listed below.')], 0).join('\n');
    expect(done).toContain('State: done');
  });
});
