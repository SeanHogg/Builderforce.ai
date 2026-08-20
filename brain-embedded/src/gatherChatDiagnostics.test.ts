import { describe, it, expect } from 'vitest';
import { gatherChatDiagnostics, type ChatDiagnosticsSources } from './gatherChatDiagnostics';
import { formatChatDiagnostics } from './chatDiagnostics';
import type { BrainTraceEvent } from './brainTriage';

/**
 * A REPORT THAT IS "EQUIVALENT" TO A COPY CLICK IS NOT THE SAME AS ONE THAT IS
 * IDENTICAL TO IT.
 *
 * Three hosts used to assemble `ChatDiagnosticsData` inline — the VS Code webview in
 * `App.tsx`, the web app in `BrainPanel.tsx`, the headless probe in `probe.ts` — and
 * the probe's copy silently omitted `projectName`, `chatVisibility`, `modelFunding`
 * and `extensionVersion` because those four came from React state it cannot reach. A
 * capture that is missing the field explaining the fault is worse than no capture.
 */
const base: ChatDiagnosticsSources = { surface: 'test' };

describe('gatherChatDiagnostics', () => {
  it('never rejects — a failing read degrades that field, not the report', async () => {
    const d = await gatherChatDiagnostics({
      ...base,
      readAgents: async () => { throw new Error('401'); },
      readTickets: async () => { throw new Error('offline'); },
      readEvermind: async () => { throw new Error('500'); },
      readPlan: async () => { throw new Error('nope'); },
      readApiVersion: async () => { throw new Error('stalled'); },
    });
    expect(d.agents).toEqual([]);
    expect(d.tickets).toEqual([]);
    expect(d.evermind).toBeNull();
    expect(d.account?.plan).toBeNull();
    expect(d.versions?.api).toBeNull();
    // The report still renders, and still says which surface produced it.
    expect(formatChatDiagnostics(d).join('\n')).toContain('- Surface: test');
  });

  it('survives a reader that throws SYNCHRONOUSLY, not just one that rejects', async () => {
    const d = await gatherChatDiagnostics({
      ...base,
      readAgents: (() => { throw new Error('bad wiring'); }) as never,
    });
    expect(d.agents).toEqual([]);
  });

  it('carries the four fields the probe used to drop', async () => {
    const d = await gatherChatDiagnostics({
      ...base,
      surface: 'VS Code (headless probe)',
      projectName: 'Atlas',
      projectId: 7,
      chatVisibility: 'locked',
      uiVersion: '2026.8.128',
      model: 'byo-model',
      modelSurface: { data: [{ id: 'plan-model' }], byo: { providers: ['anthropic'], models: [{ id: 'byo-model', vendor: 'anthropic' }] } },
    });
    expect(d.projectName).toBe('Atlas');
    expect(d.chatVisibility).toBe('locked');
    expect(d.account?.modelFunding).toBe('byo:anthropic');
    expect(d.account?.extensionVersion).toBe('2026.8.128');
    const out = formatChatDiagnostics(d).join('\n');
    expect(out).toContain("Chat's project: Atlas (#7)");
    expect(out).toContain('funded by byo:anthropic');
  });

  it('reads the OBSERVED per-turn tool exposure off the trace', async () => {
    // Two `llm` turns with different advertised counts — the range the ceiling used
    // to stand in for.
    const trace: BrainTraceEvent[] = [
      { ts: '2026-08-19T00:00:00Z', category: 'llm', label: 'llm.complete', args: { advertisedTools: 12, catalogTools: 317 } },
      { ts: '2026-08-19T00:00:01Z', category: 'llm', label: 'llm.complete', args: { advertisedTools: 64, catalogTools: 317 } },
    ];
    const d = await gatherChatDiagnostics({ ...base, tools: { count: 317 }, trace });
    expect(d.tools?.advertisedMin).toBe(12);
    expect(d.tools?.advertisedLastTurn).toBe(64);
    expect(formatChatDiagnostics(d).join('\n')).toContain('12–64 advertised per turn (measured)');
  });

  it('leaves the exposure NULL when no turn was measured, rather than guessing', async () => {
    const d = await gatherChatDiagnostics({ ...base, tools: { count: 317 } });
    expect(d.tools?.advertisedMin).toBeNull();
    expect(formatChatDiagnostics(d).join('\n')).toContain('not yet measured');
  });

  it('takes the NEWEST assistant learn outcome without reordering the transcript', async () => {
    const messages = [
      { role: 'assistant', evermindLearn: { learned: false, version: 0, reason: 'not-seeded' } },
      { role: 'user' },
      { role: 'assistant', evermindLearn: { learned: true, version: 4 } },
    ];
    const snapshot = [...messages];
    const d = await gatherChatDiagnostics({ ...base, messages });
    expect(d.lastLearn).toEqual({ learned: true, version: 4 });
    expect(messages).toEqual(snapshot);
  });

  it('reports "not gathered" tools when the host has no registry to report', async () => {
    const d = await gatherChatDiagnostics(base);
    expect(d.tools).toBeNull();
    expect(formatChatDiagnostics(d).join('\n')).toContain('Tools available to the model: not gathered');
  });
});
