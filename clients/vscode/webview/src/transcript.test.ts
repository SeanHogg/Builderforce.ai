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

describe('buildTranscript whole-report ceiling', () => {
  it('stays under the 50,000-character paste limit and keeps the tail', () => {
    // The shape of the real 110 KB report: many linked tickets, ~40 tool calls with 3 KB
    // payloads, a 20 KB assistant reply and a big report object.
    const tickets = Array.from({ length: 25 }, (_, i) => ({
      kind: 'task', ref: String(1000 + i), label: `Linked ticket number ${i} ${'w'.repeat(200)}`, status: 'todo',
    }));
    const chat: ChatDiagnosticsData = { ...CHAT, tickets };
    const trace: BrainTraceEvent[] = [];
    for (let i = 0; i < 40; i++) {
      trace.push({
        ts: `2026-09-15T10:${String(i).padStart(2, '0')}:00.000Z`,
        category: 'tool',
        label: 'read_file',
        args: { path: `src/file${i}.ts`, note: `${i}`.repeat(3_000) },
        result: { ok: true, content: `line ${i} `.repeat(500) },
      });
      trace.push({
        ts: `2026-09-15T10:${String(i).padStart(2, '0')}:30.000Z`,
        category: 'llm',
        label: 'llm.complete',
        args: { model: `provider/model-${i}`, account: 'own', toolCalls: 1 },
        usage: { prompt: 4000 + i, completion: 300 },
        textChars: 120,
      });
    }
    const messages: BrainMessage[] = [
      { role: 'user', content: 'plan the migration' } as BrainMessage,
      { role: 'assistant', content: `BIG-REPLY ${'r'.repeat(20_000)}` } as BrainMessage,
      { role: 'user', content: 'now finish it' } as BrainMessage,
      { role: 'assistant', content: 'FINAL-ANSWER-MARKER done.' } as BrainMessage,
    ];
    const bigReport = buildChatDiagnosticsReport({
      diagnostics: chat, events: trace, messages, surface: 'VS Code (VSIX)',
      now: () => new Date('2026-09-15T12:00:00.000Z'),
    });

    const text = buildTranscript({
      messages, trace, assistantName: 'ZetaBot', diagnostics: chat, report: bigReport,
    });

    expect(text.length).toBeLessThanOrEqual(50_000);
    expect(text).toContain('FINAL-ANSWER-MARKER');
    expect(text).toContain('## ZetaBot');
    expect(text).toContain('## Diagnostics (JSON)');
    const parsed = JSON.parse(jsonBlock(text)!) as ChatDiagnosticsReport;
    expect(parsed.schemaVersion).toBe(bigReport.schemaVersion);
    // Only the first ten of the 25 tickets are itemised in the prose.
    expect(text).toContain('…and 15 more linked ticket(s)');
  });

  const duplicateTools: BrainTraceEvent[] = [0, 1].map((i) => ({
    ts: `2026-09-15T10:0${i}:00.000Z`,
    category: 'tool',
    label: 'read_file',
    args: { path: 'src/same.ts' },
    result: { ok: true, content: 'identical payload '.repeat(100) },
  }) as BrainTraceEvent);

  it('unbounded error and title cannot push the report over the limit; JSON stays last and parses', () => {
    const chat: ChatDiagnosticsData = { ...CHAT, chatTitle: 'T'.repeat(50_000) };
    // Stays big after every listed elision: forces the minimal skeleton.
    const bigReport = { ...report(), chat: { ...chat, agents: Array.from({ length: 800 }, (_, i) => ({ agentRef: `agent-${i}`, role: 'member' })) } };
    const text = buildTranscript({
      messages: MESSAGES, trace: duplicateTools, assistantName: 'ZetaBot', diagnostics: chat,
      chatTitle: 'T'.repeat(50_000), error: 'E'.repeat(100_000), report: bigReport,
    });
    expect(text.length).toBeLessThanOrEqual(50_000);
    const jsonAt = text.indexOf('## Diagnostics (JSON)');
    expect(jsonAt).toBeGreaterThan(-1);
    // JSON is the LAST section: nothing after its closing fence, and no later heading.
    expect(text.indexOf('\n## ', jsonAt + 1)).toBe(-1);
    expect(text.trimEnd().endsWith('```')).toBe(true);
    const parsed = JSON.parse(jsonBlock(text)!) as Record<string, unknown>;
    expect(parsed._elided).toEqual(['*']);
    // Order: error, then the budget note, then the JSON.
    const errAt = text.indexOf('### Conversation error');
    const noteAt = text.indexOf('Note: this report is size-budgeted');
    expect(errAt).toBeGreaterThan(-1);
    expect(noteAt).toBeGreaterThan(errAt);
    expect(jsonAt).toBeGreaterThan(noteAt);
    // The 100 KB error was bounded, the 50 KB title too.
    expect(text).not.toContain('E'.repeat(5_000));
    expect(text).not.toContain('T'.repeat(500));
  });

  it('fires the last-resort middle cut inside buildTranscript when the header is huge', () => {
    const chat: ChatDiagnosticsData = {
      ...CHAT,
      agents: Array.from({ length: 3_000 }, (_, i) => ({ agentRef: `agent-${i}`, role: 'member', name: `Agent ${i}` })),
    };
    const text = buildTranscript({
      messages: MESSAGES, trace: TRACE, assistantName: 'ZetaBot', diagnostics: chat, report: report(),
    });
    expect(text.length).toBeLessThanOrEqual(50_000);
    expect(text).toContain('chars of the middle of the timeline omitted to keep this report under the 50,000-character paste limit');
    expect(text).toContain('## Diagnostics (JSON)');
    expect(() => JSON.parse(jsonBlock(text)!)).not.toThrow();
  });
});
