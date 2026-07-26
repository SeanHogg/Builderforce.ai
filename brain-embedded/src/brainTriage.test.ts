import { describe, it, expect } from 'vitest';
import {
  buildBrainTriageReport,
  computeBrainDiagnostics,
  detectAnnouncedButUnmadeToolCall,
  detectUnbackedTicketClaim,
  detectUnbackedWriteClaim,
  formatBrainDiagnostics,
  isFailedToolResult,
  type BrainTraceEvent,
} from './brainTriage';
import type { BrainMessage } from './types';

describe('isFailedToolResult', () => {
  it('flags { ok: false } and error fields', () => {
    expect(isFailedToolResult({ ok: false, error: 'no repo bound' })).toBe(true);
    expect(isFailedToolResult({ error: 'boom' })).toBe(true);
    expect(isFailedToolResult('{"ok":false,"error":"x"}')).toBe(true);
  });
  it('does not flag successful results', () => {
    expect(isFailedToolResult({ ok: true, paths: [] })).toBe(false);
    expect(isFailedToolResult(null)).toBe(false);
    expect(isFailedToolResult('done')).toBe(false);
  });
  it('does not flag legit data that merely contains the word "error"', () => {
    // A task whose title/description mentions "error" is a success, not a failure.
    expect(isFailedToolResult({ ok: true, tasks: [{ id: 1, title: 'Fix login error' }] })).toBe(false);
    expect(isFailedToolResult([{ title: 'Investigate failed deploy' }])).toBe(false);
    expect(isFailedToolResult('No errors found')).toBe(false);
    // An object with a non-string `error` field (e.g. a count) is not a failure.
    expect(isFailedToolResult({ ok: true, errorCount: 0 })).toBe(false);
  });
  it('still flags a stringified error envelope', () => {
    expect(isFailedToolResult('{"ok":false,"reason":"x"}')).toBe(true);
    expect(isFailedToolResult('{"error":"boom"}')).toBe(true);
  });
});

/**
 * The "VSIX doesn't execute, it just dies" failure: the model writes its tool calls as
 * PROSE, the agent loop only runs structured `tool_calls`, so nothing ever executes —
 * while every other signal (no errors, no truncation, low tokens) reads perfectly
 * clean and the run used to be scored "healthy".
 */
describe('detectAnnouncedButUnmadeToolCall', () => {
  const msg = (role: string, content: string): BrainMessage => ({ role, content } as BrainMessage);
  const llm: BrainTraceEvent = { ts: '', category: 'llm', label: 'llm.complete', usage: { prompt: 3454, completion: 663 } };
  const toolEv: BrainTraceEvent = { ts: '', category: 'tool', label: 'builtin_chats_list_tickets', result: { ok: true } };

  it('flags a bare advertised tool id typed into prose', () => {
    const messages = [msg('assistant', 'run tool builtin_chats_list_tickets with chatId is 85')];
    expect(detectAnnouncedButUnmadeToolCall([llm], messages)).toBe(true);
  });

  it('flags a first-person announcement that never became a call', () => {
    const messages = [msg('assistant', "I'll start by listing the tickets. Calling the required function now.")];
    expect(detectAnnouncedButUnmadeToolCall([llm], messages)).toBe(true);
    expect(detectAnnouncedButUnmadeToolCall([llm], [msg('assistant', 'I will now call the tool to list them.')])).toBe(true);
  });

  it('stays silent once the run actually made a tool call', () => {
    const messages = [msg('assistant', 'run tool builtin_chats_list_tickets with chatId is 85')];
    expect(detectAnnouncedButUnmadeToolCall([llm, toolEv], messages)).toBe(false);
  });

  it('does not fire on ordinary talk about tooling, or on the user\'s own words', () => {
    expect(detectAnnouncedButUnmadeToolCall([llm], [msg('assistant', 'You can use the export tool in Settings.')])).toBe(false);
    expect(detectAnnouncedButUnmadeToolCall([llm], [msg('assistant', 'Visit builderforce.ai for the docs.')])).toBe(false);
    expect(detectAnnouncedButUnmadeToolCall([llm], [msg('user', 'run tool builtin_chats_list_tickets')])).toBe(false);
  });

  it('makes the verdict the cause instead of scoring the run healthy', () => {
    const messages = [msg('assistant', 'run tool builtin_chats_list_tickets with chatId is 85')];
    expect(computeBrainDiagnostics([llm], undefined, messages).likelyCause).toBe('tool-calls-not-emitted');
    // Same trace, no narrated call ⇒ the old healthy verdict still stands.
    expect(computeBrainDiagnostics([llm], undefined, [msg('assistant', 'Here is the summary.')]).likelyCause).toBe('healthy');
  });

  it('surfaces the verdict in the report a user pastes', () => {
    const report = buildBrainTriageReport({
      capturedAt: '2026-07-25T00:00:00.000Z',
      events: [llm],
      messages: [msg('assistant', "I'll call the tool to list the tickets for chat #85 now.")],
    });
    expect(report).toContain('TOOL CALLS NOT EMITTED');
  });
});

describe('detectUnbackedWriteClaim', () => {
  const msg = (role: string, content: string): BrainMessage => ({ role, content } as BrainMessage);
  const toolEv = (label: string, result: unknown, isError = false): BrainTraceEvent =>
    ({ ts: '', category: 'tool', label, result, isError });

  it('flags a "I updated the roadmap" claim with no successful write tool call', () => {
    const events = [toolEv('attachments.read', { content: '…' })];
    const messages = [msg('assistant', "I've updated the roadmap file with the new IDs.")];
    expect(detectUnbackedWriteClaim(events, messages)).toBe(true);
  });

  it('does NOT flag when a write tool actually succeeded this run', () => {
    const events = [toolEv('attachments.write', { key: '1/u/rm.md', updated: true })];
    const messages = [msg('assistant', 'Saved the updated ROADMAP.md.')];
    expect(detectUnbackedWriteClaim(events, messages)).toBe(false);
  });

  it('does NOT count a FAILED write as backing the claim', () => {
    const events = [toolEv('builtin_attachments_write', { ok: false, error: 'attachment not found' }, false)];
    const messages = [msg('assistant', 'Done — I wrote the changes back to the file.')];
    expect(detectUnbackedWriteClaim(events, messages)).toBe(true);
  });

  it('ignores assistant prose that is not a file-save claim', () => {
    const events: BrainTraceEvent[] = [];
    const messages = [msg('assistant', 'I created 3 tasks and 2 objectives on the board.')];
    expect(detectUnbackedWriteClaim(events, messages)).toBe(false);
  });
});

describe('detectUnbackedTicketClaim', () => {
  const msg = (role: string, content: string): BrainMessage => ({ role, content } as BrainMessage);
  const toolEv = (label: string, result: unknown, isError = false): BrainTraceEvent =>
    ({ ts: '', category: 'tool', label, result, isError });

  it('flags "I filed it as a bug ticket" when no create/link tool succeeded', () => {
    const events = [toolEv('builtin_search_code', { matches: [] })];
    const messages = [msg('assistant', "I've filed it as a bug ticket, tracked on the board (project 11).")];
    expect(detectUnbackedTicketClaim(events, messages)).toBe(true);
  });

  it('does NOT flag when tasks.create actually succeeded', () => {
    const events = [toolEv('builtin_tasks_create', { id: 343, taskType: 'gap' })];
    const messages = [msg('assistant', 'Created the gap and linked it to this chat.')];
    expect(detectUnbackedTicketClaim(events, messages)).toBe(false);
  });

  it('does NOT flag when the chat-link tool succeeded', () => {
    const events = [toolEv('builtin_chats_link_ticket', { ok: true })];
    const messages = [msg('assistant', 'Linked the gap to the chat.')];
    expect(detectUnbackedTicketClaim(events, messages)).toBe(false);
  });

  it('counts a FAILED create as NOT backing the claim', () => {
    const events = [toolEv('builtin_tasks_create', { ok: false, error: 'nope' }, false)];
    const messages = [msg('assistant', 'Opened a gap ticket for the observability fix.')];
    expect(detectUnbackedTicketClaim(events, messages)).toBe(true);
  });
});

describe('buildBrainTriageReport', () => {
  const events: BrainTraceEvent[] = [
    { ts: '2026-06-13T00:00:00.000Z', category: 'llm', label: 'llm.complete', durationMs: 1200, args: { model: 'x', step: 0, toolCalls: 1 }, result: '1 tool call(s)' },
    { ts: '2026-06-13T00:00:01.000Z', category: 'tool', label: 'write_file', durationMs: 5, args: { path: 'a.md' }, result: { ok: false, error: 'no repo bound' }, isError: true },
    { ts: '2026-06-13T00:00:02.000Z', category: 'tool', label: 'finish', durationMs: 1, args: {}, result: { ok: true } },
  ];

  it('captures the full tool chain, errors-first, with derived logs', () => {
    const report = buildBrainTriageReport({
      capturedAt: '2026-06-13T00:00:03.000Z',
      events,
      messages: [{ id: 1, role: 'user', content: 'hi', metadata: null, seq: 1, createdAt: '2026-06-13T00:00:00.000Z' }],
      chatId: 42,
      agentLabel: 'Brain (default)',
    });
    expect(report).toContain('=== BuilderForce Brain Triage ===');
    expect(report).toContain('Chat:      #42');
    // The failed write_file is counted and surfaced in the Errors section.
    expect(report).toContain('Steps: 3 · Errors: 1 · Messages: 1');
    expect(report).toContain('--- Errors (1) ---');
    expect(report).toContain('no repo bound');
    // Full trace + derived logs + transcript are all present.
    expect(report).toContain('--- Execution trace (3) ---');
    expect(report).toContain('write_file (tool) · 5ms · ERROR');
    expect(report).toContain('--- Logs (3) ---');
    expect(report).toContain('--- Conversation (1) ---');
    expect(report).toContain('USER: hi');
  });

  it('reports an empty run without throwing', () => {
    const report = buildBrainTriageReport({ capturedAt: '2026-06-13T00:00:03.000Z', events: [] });
    expect(report).toContain('Steps: 0 · Errors: 0 · Messages: 0');
  });

  it('surfaces the account + a connected-but-unresolved BYO provider WITH its reason', () => {
    const report = buildBrainTriageReport({
      capturedAt: '2026-06-13T00:00:03.000Z',
      surface: 'VS Code (VSIX)',
      events: [
        {
          ts: '2026-06-13T00:00:00.000Z', category: 'llm', label: 'llm.complete',
          args: { model: 'deepseek/deepseek-v4-flash', step: 0, toolCalls: 1, account: 'shared', byoUnresolved: 'anthropic:revoked' },
          result: '1 tool call(s)',
        },
      ],
    });
    expect(report).toContain('Surface: VS Code (VSIX)');
    expect(report).toContain('Account: the shared model pool');
    // The connected-but-unresolved Anthropic account is flagged WITH the precise reason + fix.
    expect(report).toContain('⚠ CONNECTED ACCOUNT NOT USED');
    expect(report).toContain('anthropic (revoked)');
    expect(report).toContain('reconnect it in the web app under Settings ▸ API Keys');
  });

  it('renders the tenant-mismatch reason (connected in another workspace) distinctly', () => {
    const report = buildBrainTriageReport({
      capturedAt: '2026-06-13T00:00:03.000Z',
      events: [
        {
          ts: '2026-06-13T00:00:00.000Z', category: 'llm', label: 'llm.complete',
          args: { model: 'x', step: 0, toolCalls: 0, account: 'shared', byoUnresolved: 'anthropic:other-workspace' },
          result: 'ok',
        },
      ],
    });
    expect(report).toContain('anthropic (other-workspace)');
    expect(report).toContain('connected this account in a DIFFERENT workspace');
  });
});

describe('tool exposure + stall handling signals', () => {
  /** One `llm` turn as the run loop records it. */
  const turn = (step: number, args: Record<string, unknown>): BrainTraceEvent => ({
    ts: `2026-06-13T00:00:0${step}.000Z`,
    category: 'llm',
    label: 'llm.complete',
    args: { model: 'x', requestedModel: 'x', step, toolCalls: 0, ...args },
    result: 'ok',
  });

  it('reports how many tools each turn was actually offered, not the catalog total', () => {
    const d = computeBrainDiagnostics([
      turn(0, { advertisedTools: 40, catalogTools: 317 }),
      turn(1, { advertisedTools: 64, catalogTools: 317 }),
    ]);
    expect(d.advertisedToolsLastTurn).toBe(64);
    expect(d.advertisedToolsMin).toBe(40);
    expect(d.catalogTools).toBe(317);
    expect(formatBrainDiagnostics(d).join('\n')).toContain('Tools advertised per turn: 40–64 (of 317 in the catalog)');
  });

  it('blames the catalog, not the model, when a turn was handed zero tools', () => {
    const d = computeBrainDiagnostics(
      [turn(0, { advertisedTools: 0, catalogTools: 0 })],
      undefined,
      [{ id: 1, role: 'assistant', content: "I'll call the tool now.", metadata: null, seq: 1, createdAt: '' }],
    );
    expect(d.likelyCause).toBe('no-tools-advertised');
    expect(formatBrainDiagnostics(d).join('\n')).toContain('Switching models will not help.');
  });

  it('names a tool the selection dropped instead of blaming the model for not calling it', () => {
    const d = computeBrainDiagnostics(
      [turn(0, { advertisedTools: 12, catalogTools: 317, narratedUnadvertised: ['builtin_chats_list_tickets'] })],
      undefined,
      [{ id: 1, role: 'assistant', content: 'I will call builtin_chats_list_tickets now.', metadata: null, seq: 1, createdAt: '' }],
    );
    expect(d.narratedUnadvertisedTools).toEqual(['builtin_chats_list_tickets']);
    expect(d.likelyCause).toBe('tool-not-advertised');
    const text = formatBrainDiagnostics(d).join('\n');
    expect(text).toContain('TOOL NOT ADVERTISED');
    expect(text).toContain('Narrated but never advertised: builtin_chats_list_tickets');
  });

  it('counts the loop re-prompts and model swaps, so a stalled run shows what was tried', () => {
    const d = computeBrainDiagnostics([
      turn(0, { advertisedTools: 20 }),
      { ts: '2026-06-13T00:00:01.000Z', category: 'message', label: 'loop.recover_announced_tool_call', result: 'x' },
      { ts: '2026-06-13T00:00:02.000Z', category: 'message', label: 'loop.recover_announced_tool_call', result: 'x' },
      { ts: '2026-06-13T00:00:03.000Z', category: 'message', label: 'loop.model_failover', result: 'x' },
      { ts: '2026-06-13T00:00:04.000Z', category: 'error', label: 'loop.stall_unrecovered', result: 'x', isError: true },
    ]);
    expect(d.stallRecoveries).toBe(2);
    expect(d.modelFailovers).toBe(1);
    expect(d.stallUnrecovered).toBe(true);
    expect(formatBrainDiagnostics(d).join('\n')).toContain('Stall handling: 2 re-prompt(s) · 1 model failover(s) · GAVE UP');
  });

  it('does not count the loop\u2019s OWN deliberate model failover as a gateway downgrade', () => {
    // After a failover every turn differs from the run's original ask. Comparing against
    // that ask made a run the loop successfully RESCUED report "context exhaustion".
    const d = computeBrainDiagnostics(
      [
        turn(0, { model: 'grok', requestedModel: 'grok', advertisedTools: 20 }),
        turn(1, { model: 'sonnet', requestedModel: 'sonnet', advertisedTools: 20, toolCalls: 1 }),
      ],
      'grok',
    );
    expect(d.downgradeEvents).toBe(0);
  });

  it('still flags a real gateway downgrade — resolved differs from what THAT turn asked for', () => {
    const d = computeBrainDiagnostics(
      [turn(0, { model: 'gpt-4o-mini', requestedModel: 'sonnet', advertisedTools: 20 })],
      'sonnet',
    );
    expect(d.downgradeEvents).toBe(1);
  });
});

/**
 * The memory-first short-circuit answers WITHOUT calling a model, so its turn has no
 * `llm` event, no tokens and no tool steps — indistinguishable from "the model refused
 * to emit tool calls" unless the report names it. It matters most when the answering
 * head is the project Evermind SSM: it cannot call tools at all, so a garbled or stale
 * reply is explained by WHO answered, not by which model was picked.
 */
describe('memory-first answers in the diagnostics', () => {
  const memStep = (over: Record<string, unknown> = {}): BrainTraceEvent => ({
    ts: '',
    category: 'recall',
    label: 'evermind.answer',
    args: { query: 'what project is this chat associated with ?' },
    result: { source: 'evermind', skippedLlm: true, version: 768, evermindProjectId: 42, ...over },
  });

  it('names ANSWERED FROM MEMORY when no model ran, instead of blaming the model', () => {
    const d = computeBrainDiagnostics([memStep()], undefined, []);
    expect(d.likelyCause).toBe('memory-answered');
    expect(d.memoryAnswers).toEqual([{ source: 'evermind', version: 768, projectId: 42 }]);
    const report = formatBrainDiagnostics(d).join('\n');
    expect(report).toContain('ANSWERED FROM MEMORY');
    expect(report).toContain('project #42');
    expect(report).toContain('cannot call tools');
    // The remedy the model-fault verdicts prescribe is actively wrong here.
    expect(report).toContain('Switching models changes nothing');
  });

  it('distinguishes a Q&A cache replay from an SSM generation', () => {
    const d = computeBrainDiagnostics([memStep({ source: 'qa-cache', version: undefined, evermindProjectId: undefined })], undefined, []);
    expect(d.memoryAnswers).toEqual([{ source: 'qa-cache' }]);
    expect(formatBrainDiagnostics(d).join('\n')).toContain('replay of an earlier answer');
  });

  it('does NOT hijack the verdict on a mixed run, but still reports the memory turn', () => {
    // A run where the model narrated its calls AND an earlier turn came from memory:
    // the model fault is still the thing to fix, and the memory turn is still stated.
    const llm: BrainTraceEvent = { ts: '', category: 'llm', label: 'llm.complete', args: { advertisedTools: 20 }, usage: { prompt: 3454, completion: 663 } };
    const messages = [{ role: 'assistant', content: 'run tool builtin_chats_list_tickets with chatId is 85' } as BrainMessage];
    const d = computeBrainDiagnostics([memStep(), llm], undefined, messages);
    expect(d.likelyCause).toBe('tool-calls-not-emitted');
    expect(formatBrainDiagnostics(d).join('\n')).toContain('Answered from memory (LLM skipped): 1 turn(s)');
  });

  it('ignores a recall step that did NOT skip the model', () => {
    const d = computeBrainDiagnostics([memStep({ skippedLlm: false })], undefined, []);
    expect(d.memoryAnswers).toEqual([]);
    expect(d.likelyCause).not.toBe('memory-answered');
  });
});
