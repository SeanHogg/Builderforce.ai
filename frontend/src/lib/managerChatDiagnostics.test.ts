import { describe, it, expect } from 'vitest';
import {
  buildManagerChatDiagnosticsReport,
  looksLikeToolNarration,
  managerChatFindings,
  summarizeTrace,
  type ManagerChatDiagnosticsInput,
} from './managerChatDiagnostics';
import type { BrainChatTraceRow, BrainMessage, ManagerChatHandle } from './builderforceApi';

/**
 * The fixture is the REAL failure, verbatim.
 *
 * On 2026-07-27 an operator asked the manager three accountability questions and got
 * three non-answers — "The tools required are manager.digest, manager.decisions…",
 * "The required tools have not returned results yet". The transcript alone cannot say
 * which of four bugs that was, and the cause (the system prompt naming tools by catalog
 * id, which matches nothing in the model's tool list) was found by a human reading it.
 *
 * These tests hold the property that would have made the report say it outright, and the
 * one that keeps it honest: a FAILED trace read must never be reported as "it called
 * nothing", because that is the most alarming finding here and would be unfounded.
 */
const CAPTURED_AT = '2026-07-27T20:25:00.000Z';
const ctx = {
  capturedAt: CAPTURED_AT,
  uiVersion: '2026.7.131',
  apiVersion: '2026.7.167',
  sourceUrl: 'https://builderforce.ai/projects?tab=manager&sub=ask',
};

const msg = (over: Partial<BrainMessage> & { id: number; role: string; content: string }): BrainMessage => ({
  metadata: null, seq: over.id, createdAt: CAPTURED_AT, ...over,
});

const MESSAGES: BrainMessage[] = [
  msg({ id: 1, role: 'user', content: 'What will you do next to unblock it?' }),
  msg({
    id: 2, role: 'assistant',
    content: 'The tools required are manager.digest, manager.decisions, manager.census and manager.policy. No other tools provide the needed data.',
    metadata: JSON.stringify({
      authoredBy: { kind: 'agent', ref: 'manager-t1', name: 'Manager' },
      provenance: { model: 'claude-opus-5', account: 'own', vendor: 'anthropic' },
    }),
  }),
  msg({ id: 3, role: 'user', content: 'Why did so little get done — what is blocking the work?' }),
  msg({
    id: 4, role: 'assistant',
    content: 'The required tools have not returned results yet, so I have no new data on digest, decisions, census or policy for project 11.',
    metadata: JSON.stringify({ authoredBy: { kind: 'agent', ref: 'manager-t1', name: 'Manager' } }),
  }),
];

const handle: ManagerChatHandle = { chatId: 77, agentRef: 'manager-t1', agentName: 'Manager', designated: false };

const traceRow = (over: Partial<BrainChatTraceRow> & { id: number; kind: string }): BrainChatTraceRow => ({
  turnSeq: 1, label: null, argsJson: null, resultJson: null,
  isError: false, durationMs: null, ttftMs: null, createdAt: CAPTURED_AT, ...over,
});

/** What the loop records when the model narrates: model turns, zero tool rows. */
const NARRATED_TRACE: BrainChatTraceRow[] = [
  traceRow({ id: 1, kind: 'llm', label: 'claude-opus-5', resultJson: JSON.stringify({ finishReason: 'stop', toolCalls: 0, replyChars: 138, advertisedTools: 96 }) }),
  traceRow({ id: 2, kind: 'llm', label: 'claude-opus-5', turnSeq: 2, resultJson: JSON.stringify({ finishReason: 'stop', toolCalls: 0, replyChars: 129, advertisedTools: 96 }) }),
];

/** What it records once the tools are named correctly. */
const HEALTHY_TRACE: BrainChatTraceRow[] = [
  traceRow({ id: 1, kind: 'llm', label: 'claude-opus-5', resultJson: JSON.stringify({ finishReason: 'tool_calls', toolCalls: 2, advertisedTools: 96 }) }),
  traceRow({ id: 2, kind: 'tool', label: 'manager.digest', argsJson: '{"projectId":11}', resultJson: '{"team":{"shipped":{"today":3}}}', durationMs: 140 }),
  traceRow({ id: 3, kind: 'tool', label: 'manager.policy', argsJson: '{"projectId":11}', resultJson: '{"policy":{"allowAutoMerge":false}}', durationMs: 90 }),
  traceRow({ id: 4, kind: 'llm', label: 'claude-opus-5', turnSeq: 2, resultJson: JSON.stringify({ finishReason: 'stop', toolCalls: 0, advertisedTools: 96 }) }),
];

const input = (over: Partial<ManagerChatDiagnosticsInput> = {}): ManagerChatDiagnosticsInput => ({
  projectId: 11, handle, messages: MESSAGES, trace: NARRATED_TRACE, ...over,
});
const codes = (over: Partial<ManagerChatDiagnosticsInput> = {}) =>
  managerChatFindings(input(over)).map((f) => f.code);

describe('looksLikeToolNarration', () => {
  it('recognises the excuses the manager actually gave', () => {
    expect(looksLikeToolNarration('The tools required are manager.digest, manager.decisions and manager.census.')).toBe(true);
    expect(looksLikeToolNarration('The required tools have not returned results yet, so I have no new data.')).toBe(true);
    expect(looksLikeToolNarration('No other tools provide the needed data.')).toBe(true);
    expect(looksLikeToolNarration('I would need to call the digest first.')).toBe(true);
  });

  it('does not fire on an answer that actually reports results', () => {
    expect(looksLikeToolNarration('Today the team finished 3 tickets and merged 5 pull requests; ENG-9 and ENG-12 closed.')).toBe(false);
    expect(looksLikeToolNarration('Nothing merged today because merge authority is withheld on this project.')).toBe(false);
  });
});

describe('summarizeTrace', () => {
  it('counts model turns that emitted NO tool call — the only evidence of narration', () => {
    expect(summarizeTrace(NARRATED_TRACE)).toMatchObject({
      toolCalls: 0, toolErrors: 0, modelTurns: 2, turnsWithoutTools: 2, advertisedTools: 96,
    });
  });

  it('ranks the tools that ran and counts their failures separately', () => {
    const withFailure = [...HEALTHY_TRACE, traceRow({ id: 5, kind: 'tool', label: 'manager.census', isError: true, resultJson: '{"error":"Forbidden"}' })];
    const roll = summarizeTrace(withFailure);
    expect(roll.toolCalls).toBe(3);
    expect(roll.toolErrors).toBe(1);
    expect(roll.byTool).toContainEqual({ tool: 'manager.census', count: 1, errors: 1 });
  });
});

describe('managerChatFindings', () => {
  it('names the NAME-MISMATCH cause when replies narrate tools and none were called', () => {
    const found = managerChatFindings(input());
    const finding = found.find((f) => f.code === 'tools_narrated_never_called');
    expect(finding?.severity).toBe('critical');
    // The report must state the actual mechanism, not just "the model was unhelpful" —
    // this is the sentence that would have shortened the real investigation to nothing.
    expect(finding?.text).toContain('builtin_manager_digest');
    expect(finding?.text).toContain('advertised 96 tools');
    // …and where to look. The code guards were ALL green while this was broken — the
    // dead names were in the agent's persisted persona, which no deploy rewrites.
    expect(finding?.text).toContain('ide_agents.bio');
  });

  it('separates "called nothing" from "calls failed" from "never got the tools"', () => {
    // Calls ran and failed → a different finding and a different fix.
    const failed = [...HEALTHY_TRACE, traceRow({ id: 5, kind: 'tool', label: 'manager.digest', isError: true, resultJson: '{"error":"Project not found"}' })];
    const c = codes({ trace: failed });
    expect(c).toContain('tool_errors');
    expect(c).not.toContain('tools_narrated_never_called');
  });

  it('reports a healthy conversation as healthy', () => {
    const answered = [msg({ id: 5, role: 'assistant', content: 'Today: 3 finished, 5 merged. ENG-9 closed.' })];
    const c = codes({ messages: answered, trace: HEALTHY_TRACE });
    expect(c).not.toContain('tools_narrated_never_called');
    expect(c).not.toContain('no_tools_called');
    expect(c).not.toContain('tool_errors');
  });

  it('never turns a FAILED trace read into "it called nothing"', () => {
    // The most alarming finding in this report must not be invented from a network error.
    const c = codes({ trace: null, traceError: 'network error' });
    expect(c).toContain('trace_unavailable');
    expect(c).not.toContain('tools_narrated_never_called');
    expect(c).not.toContain('no_tools_called');
  });

  it('says plainly when nobody can answer at all', () => {
    expect(codes({ handle: { ...handle, agentRef: null, agentName: null } })).toContain('no_manager_agent');
  });
});

describe('buildManagerChatDiagnosticsReport', () => {
  const report = buildManagerChatDiagnosticsReport(input(), ctx);

  it('carries the build stamp, the project and the chat it came from', () => {
    expect(report).toContain('uiVersion: 2026.7.131');
    expect(report).toContain('apiVersion: 2026.7.167');
    expect(report).toContain('projectId: 11');
    expect(report).toContain('chatId: 77');
  });

  it('puts the findings above the transcript, and the trace below it', () => {
    // A report cut short must keep the diagnosis; the trace is the evidence for what the
    // reader already saw, so it comes last.
    expect(report.indexOf('-- Findings')).toBeLessThan(report.indexOf('-- Transcript'));
    expect(report.indexOf('-- Transcript')).toBeLessThan(report.indexOf('-- Tool trace'));
  });

  it('copies the conversation verbatim, with who said it and on which model', () => {
    expect(report).toContain('Why did so little get done');
    expect(report).toContain('The required tools have not returned results yet');
    expect(report).toContain('[assistant] Manager');
    expect(report).toContain('model=claude-opus-5');
    expect(report).toContain('account=own');
  });

  it('reports the trace rollup even when no tool ever ran', () => {
    expect(report).toContain('tool calls: 0');
    expect(report).toContain('model turns that emitted NO tool call: 2');
    expect(report).toContain('(none — the manager called nothing)');
  });

  it('prints tool arguments and results when calls DID run', () => {
    const r = buildManagerChatDiagnosticsReport(input({ trace: HEALTHY_TRACE }), ctx);
    expect(r).toContain('manager.digest');
    expect(r).toContain('args:   {"projectId":11}');
    expect(r).toContain('"shipped":{"today":3}');
  });

  it('states an unavailable trace instead of rendering it as empty', () => {
    const r = buildManagerChatDiagnosticsReport(input({ trace: null, traceError: 'network error' }), ctx);
    expect(r).toContain('unavailable: network error');
    expect(r).toContain('NOT the same as "it called nothing"');
  });
});
