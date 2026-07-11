import { describe, it, expect } from 'vitest';
import { buildBrainTriageReport, isFailedToolResult, detectUnbackedWriteClaim, detectUnbackedTicketClaim, type BrainTraceEvent } from './brainTriage';
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
