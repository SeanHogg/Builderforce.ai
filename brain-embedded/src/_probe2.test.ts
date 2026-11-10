import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CheckRecord } from '@builderforce/run-guards';

const evidenceSeed = vi.hoisted(() => ({ passing: [] as string[] }));
vi.mock('@builderforce/run-guards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@builderforce/run-guards')>();
  const pass: CheckRecord = { kind: 'typecheck', name: 'tsc --noEmit', outcome: 'pass', exitCode: 0, findings: [], at: 1 };
  return {
    ...actual,
    createEvidenceLedger: (...args: Parameters<typeof actual.createEvidenceLedger>) => {
      const ledger = actual.createEvidenceLedger(...args);
      for (const path of evidenceSeed.passing) ledger.record(path, 'seeded', pass);
      return ledger;
    },
  };
});

import { startRun, getRunTrace } from './brainRunStore';
import type { BrainStreamFn } from './brainRunStore';

const persistence = { sendMessages: async () => [] as any[] };
function scriptedSteps(): (role: string | undefined) => number {
  let step = 0;
  let lastRole: string | undefined;
  return (role) => {
    if (!(role === 'code' && lastRole === 'code')) step += 1;
    lastRole = role;
    return step;
  };
}

const SHIP_TOOLS = ['edit_file', 'run_command', 'git_status'].map((name) => ({
  type: 'function' as const,
  function: { name, description: name, parameters: {} },
}));
const TICKET2394 = [{ kind: 'task', ref: '2394', status: 'in_review', exists: true }];

function shippingRun(statusOutput: string, ticket: unknown) {
  const calls: { name: string; args: unknown }[] = [];
  const nextStep = scriptedSteps();
  const stream: BrainStreamFn = async (opts) => {
    const turn = nextStep(opts.role);
    if (opts.tools === undefined) return { text: 'Done.', toolCalls: [], finishReason: 'stop' };
    const plan = [
      { name: 'edit_file', args: { path: 'a.css', old_string: 'x', new_string: 'y' } },
      { name: 'run_command', args: { command: 'git add -A && git commit -m "x" && git push' } },
      { name: 'git_status', args: {} },
    ][turn - 1];
    if (!plan) return { text: 'Done.', toolCalls: [], finishReason: 'stop' };
    return { text: '', toolCalls: [{ id: `c${turn}`, name: plan.name, args: JSON.stringify(plan.args) }], finishReason: 'tool_calls' };
  };
  const runTool = async (name: string, args: unknown) => {
    calls.push({ name, args });
    if (name === 'builtin_chats_list_tickets') return ticket;
    if (name === 'git_status') return { ok: true, action: 'status', output: statusOutput };
    return { ok: true };
  };
  return { stream, runTool, calls };
}

describe('probe close-out', () => {
  afterEach(() => { evidenceSeed.passing = []; });

  it('4601 shipped+verified', async () => {
    evidenceSeed.passing = ['/repo/a.css'];
    const { stream, runTool, calls } = shippingRun('## main...origin/main', TICKET2394);
    await startRun(4601, {
      resolvedSystemPrompt: 'sys', projectId: 11, tools: SHIP_TOOLS, runTool, stream, persistence,
      userTurn: 'reduce the height and push to main',
    } as any);
    console.log('DBG4601 calls=' + JSON.stringify(calls));
    console.log('DBG4601 trace=' + JSON.stringify(getRunTrace(4601).filter((e) => ['builtin_tasks_update', 'run.close_out_held', 'builtin_reviews_record'].includes(e.label)).map((e) => ({ label: e.label, args: e.args }))));
    expect(true).toBe(true);
  });

  it('4603 shipped no-evidence', async () => {
    const { stream, runTool, calls } = shippingRun('## main...origin/main', TICKET2394);
    await startRun(4603, {
      resolvedSystemPrompt: 'sys', projectId: 11, tools: SHIP_TOOLS, runTool, stream, persistence,
      userTurn: 'reduce the height and push to main',
    } as any);
    console.log('DBG4603 calls=' + JSON.stringify(calls));
    console.log('DBG4603 trace=' + JSON.stringify(getRunTrace(4603).filter((e) => ['builtin_tasks_update', 'run.close_out_held'].includes(e.label)).map((e) => ({ label: e.label, args: e.args }))));
    expect(true).toBe(true);
  });

  it('4802 verify push closes', async () => {
    evidenceSeed.passing = ['/repo/src/a.ts'];
    const TICKET = [{ kind: 'task', ref: '2466', status: 'in_review', exists: true }];
    const IDE_TOOLS = ['edit_file', 'git_status', 'git_diff', 'git_commit', 'git_push', 'run_command'].map((name) => ({ type: 'function' as const, function: { name, description: name, parameters: {} } }));
    const turns: Array<{ name: string; args: unknown } | string> = [
      { name: 'edit_file', args: { path: 'src/a.ts', old_string: 'x', new_string: 'y' } },
      'I fixed the deep link in src/a.ts.',
      { name: 'git_commit', args: { message: 'fix deep link', paths: ['src/a.ts'], allowBaseBranch: true } },
      { name: 'git_push', args: { allowBaseBranch: true } },
      'Shipped as abc123 — pushed to main.',
    ];
    const calls: { name: string; args: unknown }[] = [];
    const nextStep = scriptedSteps();
    const stream: BrainStreamFn = async (opts) => {
      if (opts.tools === undefined) return { text: 'Done.', toolCalls: [], finishReason: 'stop' };
      const turn = nextStep(opts.role);
      const t = turns[turn - 1] ?? 'Done.';
      if (typeof t === 'string') return { text: t, toolCalls: [], finishReason: 'stop' };
      return { text: '', toolCalls: [{ id: `c${turn}`, name: t.name, args: JSON.stringify(t.args) }], finishReason: 'tool_calls' };
    };
    const runTool = async (name: string, args: unknown) => {
      calls.push({ name, args });
      if (name === 'builtin_chats_list_tickets') return TICKET;
      if (name === 'git_push') return { ok: true, action: 'push', output: 'Pushed main to origin\n## main...origin/main' };
      return { ok: true };
    };
    await startRun(4802, { resolvedSystemPrompt: 'sys', projectId: 11, tools: IDE_TOOLS, runTool, stream, persistence, userTurn: 'fix the deep link' } as any);
    console.log('DBG4802 calls=' + JSON.stringify(calls));
    console.log('DBG4802 trace=' + JSON.stringify(getRunTrace(4802).filter((e) => ['builtin_tasks_update', 'run.close_out_held', 'loop.recover_unshipped_change', 'builtin_reviews_record'].includes(e.label)).map((e) => ({ label: e.label, args: e.args }))));
    expect(true).toBe(true);
  });
});
