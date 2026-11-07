import { describe, it, expect } from 'vitest';
import {
  CHAT_DIAGNOSTICS_SCHEMA_VERSION,
  buildChatDiagnosticsReport,
  formatChatDiagnosticsReportJson,
  compactReportJson,
  REPORT_JSON_MAX_CHARS,
  type ChatDiagnosticsReport,
} from './chatDiagnosticsReport';
import type { BrainTraceEvent } from './brainTriage';
import type { ChatDiagnosticsData } from './chatDiagnostics';
import type { BrainMessage } from './types';

const CHAT: ChatDiagnosticsData = {
  surface: 'VS Code (VSIX)',
  chatId: 113,
  chatTitle: 'Ship the migration',
  mode: 'work',
  projectId: 7,
  tenantId: 3,
};

const NOW = () => new Date('2026-09-15T12:00:00.000Z');

function events(): BrainTraceEvent[] {
  return [
    {
      ts: '2026-09-15T11:58:00.000Z',
      category: 'llm',
      label: 'llm.complete',
      args: { model: 'anthropic/claude-opus-5', account: 'own', toolCalls: 1 },
      usage: { prompt: 4000, completion: 300 },
      textChars: 120,
    },
    {
      ts: '2026-09-15T11:59:00.000Z',
      category: 'tool',
      label: 'builtin_tasks_create',
      args: { title: 'Port the auth middleware' },
      result: { ok: true, id: 1 },
    },
  ];
}

describe('buildChatDiagnosticsReport', () => {
  it('carries the version, the capture time and every half of the capture', () => {
    const report = buildChatDiagnosticsReport({
      diagnostics: CHAT,
      events: events(),
      messages: [],
      model: 'anthropic/claude-opus-5',
      surface: 'VS Code (VSIX)',
      now: NOW,
    });
    expect(report.schemaVersion).toBe(CHAT_DIAGNOSTICS_SCHEMA_VERSION);
    expect(report.capturedAt).toBe('2026-09-15T12:00:00.000Z');
    expect(report.surface).toBe('VS Code (VSIX)');
    expect(report.running).toBe(false);
    expect(report.chat.chatId).toBe(113);
    // The mode is what decides whether "filed it and stopped" is correct behaviour.
    expect(report.chat.mode).toBe('work');
    expect(report.run?.toolCalls).toBe(1);
    expect(report.likelyCause).toBe(report.run?.likelyCause);
    expect(report.provenance).toEqual({
      configuredModel: 'anthropic/claude-opus-5',
      modelsUsed: ['anthropic/claude-opus-5'],
      account: 'own',
    });
    // One ticket filed, nobody dispatched — the fact the whole report exists for.
    expect(report.staffing?.ticketsCreated).toBe(1);
    expect(report.staffing?.verdict).toBe('filed-not-staffed');
  });

  it('reports a null run rather than a zeroed one when nothing ran', () => {
    // A zeroed BrainDiagnostics would read as "0 turns, 0 errors, healthy" — a
    // measurement nobody took, indistinguishable from a clean run.
    const report = buildChatDiagnosticsReport({
      diagnostics: CHAT,
      events: [],
      messages: [],
      surface: 'Web',
      now: NOW,
    });
    expect(report.run).toBeNull();
    expect(report.staffing).toBeNull();
    expect(report.likelyCause).toBeNull();
    expect(report.provenance.configuredModel).toBeNull();
    expect(report.provenance.modelsUsed).toEqual([]);
  });

  it('treats the gateway placeholder model as "not configured"', () => {
    const report = buildChatDiagnosticsReport({
      diagnostics: CHAT, events: [], messages: [], model: 'default', surface: 'Web', now: NOW,
    });
    expect(report.provenance.configuredModel).toBeNull();
  });

  it('records a mid-flight capture as running', () => {
    const messages: BrainMessage[] = [{ role: 'user', content: 'ship it' } as BrainMessage];
    const report = buildChatDiagnosticsReport({
      diagnostics: CHAT, events: events(), messages, running: true, surface: 'Web', now: NOW,
    });
    expect(report.running).toBe(true);
  });
});

describe('formatChatDiagnosticsReportJson', () => {
  it('emits a fenced block whose body parses back to the same report', () => {
    const report = buildChatDiagnosticsReport({
      diagnostics: CHAT, events: events(), messages: [], surface: 'Web', now: NOW,
    });
    const lines = formatChatDiagnosticsReportJson(report);
    expect(lines[0]).toBe('## Diagnostics (JSON)');
    expect(lines[1]).toBe('```json');
    expect(lines[lines.length - 1]).toBe('```');
    // The block exists ONLY to be machine-read, so round-tripping it is the contract.
    const parsed = JSON.parse(lines.slice(2, -1).join('\n')) as ChatDiagnosticsReport;
    expect(parsed).toEqual(report);
  });

  it('is compact one-line JSON', () => {
    const report = buildChatDiagnosticsReport({
      diagnostics: CHAT, events: events(), messages: [], surface: 'Web', now: NOW,
    });
    const lines = formatChatDiagnosticsReportJson(report);
    expect(lines).toHaveLength(4);
    expect(lines[2]).not.toContain('\n');
  });

  it('elides bulky fields in order, still parses, and names what it dropped', () => {
    const report = buildChatDiagnosticsReport({
      diagnostics: {
        ...CHAT,
        tickets: Array.from({ length: 40 }, (_, i) => ({ kind: 'task', ref: String(i), label: 'L'.repeat(300) })),
      },
      events: events(), messages: [], surface: 'Web', now: NOW,
    });
    // Force the per-turn log to be the bulky field.
    (report.run as unknown as { modelTurns: unknown[] }).modelTurns = Array.from({ length: 200 }, (_, i) => ({ i, pad: 'p'.repeat(100) }));
    const lines = formatChatDiagnosticsReportJson(report);
    const body = lines[2]!;
    expect(body.length).toBeLessThanOrEqual(REPORT_JSON_MAX_CHARS);
    const parsed = JSON.parse(body) as Record<string, unknown> & { run: Record<string, unknown>; chat: Record<string, unknown> };
    expect(parsed._elided).toEqual(['run.modelTurns', 'run.modelScores', 'chat.tickets']);
    expect('modelTurns' in parsed.run).toBe(false);
    expect('tickets' in parsed.chat).toBe(false);
    // The caller's report is untouched.
    expect(report.chat.tickets).toHaveLength(40);
  });

  it('falls back to a minimal parseable skeleton when elision is not enough', () => {
    const report = buildChatDiagnosticsReport({
      diagnostics: { ...CHAT, agents: Array.from({ length: 2_000 }, (_, i) => ({ agentRef: `agent-${i}`, role: 'member' })) },
      events: events(), messages: [], surface: 'Web', now: NOW,
    });
    const json = compactReportJson(report);
    expect(json.length).toBeLessThanOrEqual(REPORT_JSON_MAX_CHARS);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed._elided).toEqual(['*']);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.capturedAt).toBe('2026-09-15T12:00:00.000Z');
    expect('chat' in parsed).toBe(false);
  });

  it('leaves a report under the cap unmarked', () => {
    const report = buildChatDiagnosticsReport({
      diagnostics: CHAT, events: events(), messages: [], surface: 'Web', now: NOW,
    });
    expect(JSON.parse(compactReportJson(report))._elided).toBeUndefined();
  });
});
