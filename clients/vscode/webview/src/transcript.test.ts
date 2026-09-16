import { describe, it, expect } from 'vitest';
import { buildTranscript } from './transcript';
import {
  buildChatDiagnosticsReport,
  type BrainMessage,
  type BrainTraceEvent,
  type ChatDiagnosticsData,
  type ChatDiagnosticsReport,
} from '@seanhogg/builderforce-brain-embedded';

/**
 * The copied report has always been text for a human. It is now ALSO data: the same
 * capture rides at the end as one JSON block, and the same object is persisted with the
 * chat. These tests pin the only two things that can silently break that — the block
 * going missing, and the block being present but unparseable.
 */

const CHAT: ChatDiagnosticsData = { surface: 'VS Code (VSIX)', chatId: 113, mode: 'work', projectId: 7 };

const MESSAGES: BrainMessage[] = [
  { role: 'user', content: 'plan the migration' } as BrainMessage,
  { role: 'assistant', content: 'Filed twelve tickets.' } as BrainMessage,
];

const TRACE: BrainTraceEvent[] = [
  {
    ts: '2026-09-15T10:00:00.000Z',
    category: 'tool',
    label: 'builtin_tasks_create',
    args: { title: 'Port the auth middleware' },
    result: { ok: true, id: 1 },
  },
];

function report(): ChatDiagnosticsReport {
  return buildChatDiagnosticsReport({
    diagnostics: CHAT,
    events: TRACE,
    messages: MESSAGES,
    model: 'anthropic/claude-opus-5',
    surface: 'VS Code (VSIX)',
    now: () => new Date('2026-09-15T12:00:00.000Z'),
  });
}

/** The fenced JSON body, or null when the report carries no block. */
function jsonBlock(text: string): string | null {
  const start = text.indexOf('## Diagnostics (JSON)');
  if (start === -1) return null;
  const fence = text.indexOf('```json', start);
  const end = text.indexOf('```', fence + 7);
  return text.slice(fence + '```json'.length, end).trim();
}

describe('buildTranscript diagnostics JSON', () => {
  it('appends a parseable JSON block at the END of the report', () => {
    const r = report();
    const text = buildTranscript({
      messages: MESSAGES,
      trace: TRACE,
      assistantName: 'BuilderForce',
      diagnostics: CHAT,
      report: r,
    });
    const body = jsonBlock(text);
    expect(body).not.toBeNull();
    // Parseable is the whole contract: a half-elided block is worth nothing to the only
    // reader this exists for.
    expect(JSON.parse(body!)).toEqual(r);
    // LAST, after the turns and the budget note — the prose is what a human reads.
    expect(text.indexOf('## Diagnostics (JSON)')).toBeGreaterThan(text.indexOf('## You'));
  });

  it('carries the staffing verdict, so a paste answers "is anybody running this?"', () => {
    const parsed = JSON.parse(jsonBlock(buildTranscript({
      messages: MESSAGES, trace: TRACE, assistantName: 'BuilderForce', diagnostics: CHAT, report: report(),
    }))!) as ChatDiagnosticsReport;
    expect(parsed.staffing?.ticketsCreated).toBe(1);
    expect(parsed.staffing?.verdict).toBe('filed-not-staffed');
    expect(parsed.chat.mode).toBe('work');
  });

  it('emits no block at all when the caller passed no report', () => {
    const text = buildTranscript({
      messages: MESSAGES, trace: TRACE, assistantName: 'BuilderForce', diagnostics: CHAT,
    });
    expect(jsonBlock(text)).toBeNull();
    // The human half is unaffected either way.
    expect(text).toContain('## Chat diagnostics');
  });
});
