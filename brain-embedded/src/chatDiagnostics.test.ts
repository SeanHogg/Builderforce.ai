/**
 * chatDiagnostics — the "Copy diagnostics" serializer.
 *
 * The report is a SUPPORT artifact: a user pastes it and someone else has to reach the
 * right conclusion from it alone. So these tests assert on the two things that can
 * silently break that: a field quietly going missing (a reader can't tell "not gathered"
 * from "genuinely empty"), and a Signal failing to fire on the state it exists to name.
 *
 * The motivating case is a brand-new free signup with no card — the state that looks
 * exactly like a broken install until the report says otherwise.
 */

import { describe, it, expect } from 'vitest';
import { formatChatDiagnostics, classifyModelFunding, type ChatDiagnosticsData, type ChatDiagnosticsRun } from './chatDiagnostics';

/** A healthy, fully-gathered chat — each test perturbs only the field under test. */
function baseline(over: Partial<ChatDiagnosticsData> = {}): ChatDiagnosticsData {
  return {
    surface: 'VS Code (VSIX)',
    chatId: 12,
    chatTitle: 'Fix the build',
    projectId: 3,
    projectName: 'Acme',
    selectedProjectId: 3,
    tenantId: 91,
    userId: 'usr_1',
    evermind: { version: 4, mode: 'connected', contributions: 7, pending: 0, lastLearnedAt: '2026-07-18T10:00:00Z' },
    lastLearn: { learned: true, version: 4 },
    agents: [{ agentRef: 'coder', role: 'member' }],
    tickets: [],
    account: {
      plan: 'pro',
      billingStatus: 'active',
      periodStart: '2026-07-01T00:00:00Z',
      resetsAt: '2026-08-01T00:00:00Z',
      meters: [{ key: 'ai_tokens', unit: 'tokens', used: 1000, limit: 1_000_000, unlimited: false, remaining: 999_000, percentUsed: 0 }],
      model: 'anthropic/claude-opus-4-8',
      modelFunding: 'plan',
      canUsePremiumModels: true,
      planModelCount: 6,
      byoProviders: ['anthropic'],
    },
    ...over,
  };
}

const render = (d: ChatDiagnosticsData) => formatChatDiagnostics(d).join('\n');
/** Only the Signals section — assertions about what the report CONCLUDES. */
const signals = (d: ChatDiagnosticsData) => {
  const text = render(d);
  const i = text.indexOf('### Signals');
  return i === -1 ? '' : text.slice(i);
};

describe('formatChatDiagnostics — learn version signal', () => {
  it('stays silent when the head moved AHEAD of the learn step — that is the queued learn landing', () => {
    // Observed: "reported v22 · head v23" flagged as a mismatch on a healthy chat. The
    // gate reports the head it evaluated; its own contribution then bumps the head.
    const d = baseline({ evermind: { ...baseline().evermind!, version: 23 }, lastLearn: { learned: true, version: 22 } });
    expect(signals(d)).not.toContain('DIFFERENT projects/heads');
  });

  it('flags a head BEHIND the learn step — impossible for one head', () => {
    const d = baseline({ evermind: { ...baseline().evermind!, version: 3 }, lastLearn: { learned: true, version: 9 } });
    expect(signals(d)).toContain('DIFFERENT projects/heads');
  });
});

describe('formatChatDiagnostics — account block', () => {
  it('states plan, billing, quota and entitlement for a healthy paid tenant', () => {
    const out = render(baseline());
    expect(out).toContain('- Plan: pro · billing active · premium models entitled');
    expect(out).toContain('AI tokens: 1,000 / 1,000,000 (0%) · 999,000 left');
    expect(out).toContain('BYO accounts: anthropic');
    // A healthy account must not manufacture alarm.
    expect(signals(baseline())).not.toContain('Free plan');
  });

  it('says so explicitly when the account snapshot could not be gathered', () => {
    // The whole point of the block: "not gathered" must be distinguishable from "empty".
    const out = render(baseline({ account: null }));
    expect(out).toContain('- Plan / usage: not gathered');
  });

  it('reports an unlimited meter as unlimited rather than as a zero allowance', () => {
    const out = render(baseline({
      account: { ...baseline().account!, meters: [{ key: 'cloud_runs', unit: 'runs', used: 2, limit: -1, unlimited: true, remaining: -1, percentUsed: 0 }] },
    }));
    expect(out).toContain('Cloud runs: 2 used (unlimited)');
    // The raw -1 sentinel must never reach the reader as if it were an allowance.
    expect(out.split('\n').find((l) => l.includes('Cloud runs'))).not.toContain('-1');
  });

  it('scales byte meters into human units', () => {
    const out = render(baseline({
      account: { ...baseline().account!, meters: [{ key: 'ingestion', unit: 'bytes', used: 5_242_880, limit: 104_857_600, unlimited: false, remaining: 99_614_720, percentUsed: 5 }] },
    }));
    expect(out).toContain('Data ingested: 5 MB / 100 MB (5%) · 95 MB left');
  });

  it('records the client build and gateway when the host supplies them', () => {
    const out = render(baseline({ account: { ...baseline().account!, extensionVersion: '2026.7.71', baseUrl: 'https://builderforce.ai' } }));
    expect(out).toContain('- Client: v2026.7.71 → https://builderforce.ai');
  });
});

describe('formatChatDiagnostics — account signals', () => {
  /** THE case this feature exists for: new signup, free plan, no card, nothing connected. */
  const newFreeSignup = baseline({
    account: {
      plan: 'free',
      billingStatus: 'none',
      resetsAt: '2026-08-01T00:00:00Z',
      meters: [{ key: 'ai_tokens', unit: 'tokens', used: 0, limit: 250_000, unlimited: false, remaining: 250_000, percentUsed: 0 }],
      model: null,
      modelFunding: 'auto',
      canUsePremiumModels: false,
      planModelCount: 3,
      byoProviders: [],
    },
  });

  it('names the free/no-card posture and its three consequences', () => {
    const s = signals(newFreeSignup);
    expect(s).toContain('Free plan with NO payment method on file');
    // It must read as "expected", not as a fault — that is the whole diagnostic value.
    expect(s).toContain('none of this is a fault');
    expect(s).toContain('No bring-your-own provider accounts connected');
  });

  it('warns before the token cap bites, and explains the 429 once it has', () => {
    const near = { ...newFreeSignup.account!, meters: [{ key: 'ai_tokens', unit: 'tokens', used: 200_000, limit: 250_000, unlimited: false, remaining: 50_000, percentUsed: 80 }] };
    expect(signals(baseline({ account: near }))).toContain('80% used');

    const spent = { ...newFreeSignup.account!, meters: [{ key: 'ai_tokens', unit: 'tokens', used: 250_000, limit: 250_000, unlimited: false, remaining: 0, percentUsed: 100 }] };
    const s = signals(baseline({ account: spent }));
    expect(s).toContain('EXHAUSTED');
    // Must name the observable symptom, so "it stops mid-answer" is self-explaining.
    expect(s).toContain('plan_token_limit_exceeded');
  });

  it('stays quiet about quota well below the threshold', () => {
    expect(signals(baseline())).not.toContain('AI token allowance');
  });

  it('never warns about quota for an unlimited allowance', () => {
    const s = signals(baseline({
      account: { ...baseline().account!, meters: [{ key: 'ai_tokens', unit: 'tokens', used: 9e9, limit: -1, unlimited: true, remaining: -1, percentUsed: 0 }] },
    }));
    expect(s).not.toContain('AI token allowance');
  });

  it('flags a premium model picked without premium entitlement', () => {
    const s = signals(baseline({
      account: { ...baseline().account!, model: 'openai/gpt-5', modelFunding: 'premium', canUsePremiumModels: false },
    }));
    expect(s).toContain('NOT entitled to premium models');
  });

  it('flags past_due billing as a cause of sudden downgrade', () => {
    expect(signals(baseline({ account: { ...baseline().account!, billingStatus: 'past_due' } }))).toContain('past_due');
  });
});

describe('classifyModelFunding', () => {
  const surface = {
    data: [{ id: 'plan/model-a' }],
    byo: { models: [{ id: 'anthropic/claude-opus-4-8', vendor: 'anthropic' }] },
  };

  it('reports auto when no model is pinned', () => {
    expect(classifyModelFunding(undefined, surface)).toBe('auto');
    expect(classifyModelFunding(null, surface)).toBe('auto');
  });

  it('prefers the tenant\'s own connected account over the plan pool', () => {
    expect(classifyModelFunding('anthropic/claude-opus-4-8', surface)).toBe('byo:anthropic');
  });

  it('reports plan for a pooled model and premium for anything else', () => {
    expect(classifyModelFunding('plan/model-a', surface)).toBe('plan');
    expect(classifyModelFunding('openai/gpt-5', surface)).toBe('premium');
  });

  it('calls a project-Evermind pin what it is, not a metered premium model', () => {
    // It is in no pool, so it used to fall through to `premium` — which on a free plan
    // raised a "plan not entitled to premium" warning about a plan FEATURE.
    expect(classifyModelFunding('project_evermind:12', surface)).toBe('evermind');
  });

  it('does not guess when the model surface has not loaded', () => {
    // A null surface means "unknown", and an unpinned model is still auto — but a pinned
    // model must not be labelled `premium` merely because the pool list is missing.
    expect(classifyModelFunding(undefined, null)).toBe('auto');
  });
});

describe('chat mode', () => {
  it('states the mode directly under the chat line', () => {
    // The same trace is a healthy answer in `chat` and an unfinished execution in
    // `work` — a report that omits the mode makes those two indistinguishable.
    const lines = formatChatDiagnostics(baseline({ mode: 'work' }));
    const chatLine = lines.findIndex((l) => l.startsWith('- Chat: '));
    expect(lines[chatLine + 1]).toBe('- Mode: work');
  });

  it('omits the line entirely when the surface did not report a mode', () => {
    expect(formatChatDiagnostics(baseline()).some((l) => l.startsWith('- Mode:'))).toBe(false);
  });
});

/**
 * WHO is in the chat, and WHAT actually ran.
 *
 * Chat #103 is the motivating capture: three agents invited, seven tickets linked, every
 * code change made by the local session — and a report that printed three uuids and said
 * nothing at all about executions. The reader could not answer "who is on this?" or "did
 * anything run?", which are the first two questions anybody asks.
 */
describe('formatChatDiagnostics — the dispatch pathway', () => {
  const staffed = (over: Partial<ChatDiagnosticsData> = {}): ChatDiagnosticsData => baseline({
    agents: [
      { agentRef: 'd02ff7ee-9cf2-4c44-8558-c89104f6278f', role: 'participant', name: 'Bob' },
      { agentRef: 'manager-t1', role: 'participant', name: 'Manager', builtinKind: 'manager' },
    ],
    tickets: [{ kind: 'task', ref: '2466', label: 'Code change', linkType: 'created', status: 'done' }],
    ...over,
  });

  it('prints the agent NAMES, keeping the ref for the reader who needs it', () => {
    const out = formatChatDiagnostics(staffed()).join('\n');
    expect(out).toContain('Bob [d02ff7ee-9cf2-4c44-8558-c89104f6278f] (participant)');
    // A built-in is marked, because "Manager" could otherwise be an agent somebody named
    // Manager — and those have different remedies when nothing runs.
    expect(out).toContain('Manager [manager-t1] (participant, built-in manager)');
  });

  it('still renders an agent the API could not name', () => {
    const out = formatChatDiagnostics(staffed({ agents: [{ agentRef: 'raw-ref', role: 'participant' }] })).join('\n');
    expect(out).toContain('raw-ref (participant)');
  });

  it('separates "not gathered" from "nothing ran"', () => {
    // These are opposite findings. A surface that did not read the runs must not be able
    // to assert the stronger one by omission.
    expect(formatChatDiagnostics(staffed({ runs: undefined })).join('\n'))
      .toMatch(/Execution history: not gathered/);
    expect(formatChatDiagnostics(staffed({ runs: { linkedRunnableTickets: 3, runs: [], dispatchers: [] } })).join('\n'))
      .toMatch(/ZERO runs against 3 linked runnable ticket\(s\)/);
  });

  it('does not call an empty history a finding when there was nothing to run', () => {
    const out = formatChatDiagnostics(staffed({ runs: { linkedRunnableTickets: 0, runs: [], dispatchers: [] } })).join('\n');
    expect(out).toMatch(/no runnable ticket .* is linked to this chat/);
    expect(out).not.toMatch(/ZERO runs/);
  });

  it('RAISES the staffing gap — agents present, tickets linked, nothing dispatched', () => {
    // The chat #103 signal. Without it the capture reads clean: green tool steps, tickets
    // created, agents listed, and no line saying nobody was ever asked to run anything.
    const out = formatChatDiagnostics(staffed({ runs: { linkedRunnableTickets: 7, runs: [], dispatchers: [] } })).join('\n');
    expect(out).toMatch(/2 agent\(s\) are in this chat \(Bob, Manager\) and ZERO runs have ever been started/);
    expect(out).toMatch(/done by this session itself/);
  });

  it('does NOT raise it when nobody was staffed — that is a different chat', () => {
    const out = formatChatDiagnostics(staffed({
      agents: [],
      runs: { linkedRunnableTickets: 7, runs: [], dispatchers: [] },
    })).join('\n');
    expect(out).not.toMatch(/ZERO runs have ever been started/);
  });

  const run = (over: Partial<ChatDiagnosticsRun> & { executionId: number }): ChatDiagnosticsRun => ({
    taskId: 2466,
    taskTitle: 'Code change',
    agentRef: 'bob-1',
    agentName: 'Bob',
    status: 'completed',
    submittedBy: 'user:22c5fd96',
    source: 'vscode',
    produced: true,
    errorMessage: null,
    startedAt: null,
    completedAt: '2026-09-21T03:59:00.000Z',
    createdAt: '2026-09-21T03:45:34.121Z',
    ...over,
  });

  it('lists each run with who ran it and which pathway started it', () => {
    const out = formatChatDiagnostics(staffed({
      runs: { linkedRunnableTickets: 2, runs: [run({ executionId: 91 })], dispatchers: ['user:22c5fd96'] },
    })).join('\n');
    expect(out).toContain('run #91 · Bob · #2466 "Code change" · completed');
    expect(out).toContain('by user:22c5fd96 via vscode');
    // The gloss rides ALONGSIDE the raw label, never replacing it.
    expect(out).toContain('user:22c5fd96 (a human pressed Run)');
  });

  it('names a conversation whose runs all came from somewhere else', () => {
    const out = formatChatDiagnostics(staffed({
      runs: {
        linkedRunnableTickets: 2,
        runs: [run({ executionId: 92, submittedBy: 'system:lane-auto' })],
        dispatchers: ['system:lane-auto'],
      },
    })).join('\n');
    expect(out).toContain('system:lane-auto (board autonomy, not this conversation)');
    expect(out).toMatch(/none by a person pressing Run/);
  });

  it('flags a COMPLETED run that shipped nothing', () => {
    // A green run that left no commit, PR, merge or lane move is not progress, and every
    // surface that prints only the status reads it as success.
    const out = formatChatDiagnostics(staffed({
      runs: {
        linkedRunnableTickets: 2,
        runs: [run({ executionId: 93, produced: false })],
        dispatchers: ['user:22c5fd96'],
      },
    })).join('\n');
    expect(out).toContain('produced NOTHING');
    expect(out).toMatch(/1 run\(s\) on this chat COMPLETED without producing anything/);
  });

  it('caps the listing rather than pasting a hundred runs into a support report', () => {
    const many = Array.from({ length: 14 }, (_, i) => run({ executionId: 200 + i }));
    const out = formatChatDiagnostics(staffed({
      runs: { linkedRunnableTickets: 2, runs: many, dispatchers: ['user:22c5fd96'] },
    })).join('\n');
    expect(out).toContain('run #209');
    expect(out).not.toContain('run #210');
    expect(out).toContain('and 4 earlier run(s) not listed');
  });
});
