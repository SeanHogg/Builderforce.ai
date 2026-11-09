/**
 * Unit tests for `toolExposure.ts` — the per-turn "Tools advertised" measurement
 * (PRD 45 §4.7 B8, extracted from `chatDiagnostics.ts`).
 *
 * The headline regression is chat #216: the report said "1 tool advertised per turn"
 * while the run actually called 15+ distinct tools. The number rendered must come off
 * the trace's per-turn `advertisedTools` field, never off a registry-ceiling snapshot.
 */
import { describe, it, expect } from 'vitest';
import { formatAdvertised, toolExposureInTrace } from './toolExposure';
import type { BrainTraceEvent } from './brainTriage';

const llmTurn = (advertisedTools: number, catalogTools = 317): BrainTraceEvent => ({
  ts: '2026-11-08T00:00:00Z',
  category: 'llm',
  label: 'llm.complete',
  args: { advertisedTools, catalogTools },
});

const toolCall = (name: string): BrainTraceEvent => ({
  ts: '2026-11-08T00:00:01Z',
  category: 'tool',
  label: name,
  args: {},
});

describe('toolExposureInTrace', () => {
  it('reads the last measured turn and the minimum across turns', () => {
    const exposure = toolExposureInTrace([
      llmTurn(40),
      toolCall('read_file'),
      llmTurn(64),
      toolCall('edit_file'),
    ]);
    expect(exposure.lastTurn).toBe(64);
    expect(exposure.min).toBe(40);
    expect(exposure.catalog).toBe(317);
  });

  it('returns nulls when no turn advertised tools (a run that predates the field)', () => {
    const exposure = toolExposureInTrace([toolCall('read_file'), toolCall('edit_file')]);
    expect(exposure).toEqual({ lastTurn: null, min: null, catalog: null });
  });

  it('ignores non-numeric advertisedTools noise instead of coercing it', () => {
    const noisy: BrainTraceEvent = {
      ts: '2026-11-08T00:00:00Z',
      category: 'llm',
      label: 'llm.complete',
      args: { advertisedTools: 'many', catalogTools: null },
    };
    expect(toolExposureInTrace([noisy])).toEqual({ lastTurn: null, min: null, catalog: null });
  });

  it('a turn offered zero tools is reported as min 0, not omitted', () => {
    const exposure = toolExposureInTrace([llmTurn(64), llmTurn(0), llmTurn(48)]);
    expect(exposure.min).toBe(0);
    expect(exposure.lastTurn).toBe(48);
  });
});

describe('formatAdvertised', () => {
  const LIMIT = 64;

  it('renders the measured range when turns were measured', () => {
    expect(formatAdvertised({ advertisedMin: 40, advertisedLastTurn: 64, count: 317 }, LIMIT))
      .toBe(' · 40–64 advertised per turn (measured)');
  });

  it('renders a single number (no range) when min equals the last turn', () => {
    expect(formatAdvertised({ advertisedMin: 64, advertisedLastTurn: 64, count: 317 }, LIMIT))
      .toBe(' · 64 advertised per turn (measured)');
  });

  it('warns when a turn was offered none', () => {
    expect(formatAdvertised({ advertisedMin: 0, advertisedLastTurn: 64, count: 317 }, LIMIT))
      .toBe(' · 0–64 advertised per turn (measured) · ⚠ a turn was offered NONE');
  });

  it('says capped-not-measured when the registry exceeds the cap but no turn was measured', () => {
    expect(formatAdvertised({ advertisedMin: null, advertisedLastTurn: null, count: 317 }, LIMIT))
      .toBe(' · per-turn selection capped at 64, not yet measured (no turn in this run advertised tools)');
  });

  it('renders nothing when the whole catalog already fits every turn', () => {
    expect(formatAdvertised({ advertisedMin: null, advertisedLastTurn: null, count: 12 }, LIMIT)).toBe('');
  });
});

/**
 * Chat #216: the copied diagnostics reported "1 tool advertised per turn" while the run
 * called 15+ distinct tools. The counter was measuring a collapsed registry snapshot
 * (the catalog ceiling), not the trace. A trace that actually handed the model a real
 * tool set on every turn must report THAT number — never "1" inferred from the catalog.
 */
describe('regression: chat #216 — tools advertised must reflect the real trace', () => {
  // The 15+ distinct tools chat #216 actually called across its turns.
  const CALLED_TOOLS = [
    'read_file', 'edit_file', 'write_file', 'search_code', 'list_files',
    'run_command', 'git_status', 'git_diff', 'git_commit', 'git_push',
    'find_symbol', 'file_outline', 'builtin_tasks_update', 'builtin_chats_list_tickets',
    'builtin_tools_find', 'spawn_agent',
  ];

  const trace: BrainTraceEvent[] = CALLED_TOOLS.flatMap((name, i) => [
    llmTurn(64 - (i % 3)), // per-turn advertised count, recorded by the loop
    toolCall(name),
  ]);

  it('a trace with 15+ distinct tools called does NOT report 1 advertised', () => {
    const exposure = toolExposureInTrace(trace);
    expect(exposure.lastTurn).not.toBe(1);
    expect(exposure.min).not.toBe(1);
    expect(exposure.lastTurn).toBeGreaterThanOrEqual(62);
  });

  it('the rendered per-turn line reflects the measured trace, not the catalog ceiling', () => {
    const exposure = toolExposureInTrace(trace);
    const line = formatAdvertised(
      { advertisedMin: exposure.min, advertisedLastTurn: exposure.lastTurn, count: 317 },
      64,
    );
    expect(line).toContain('advertised per turn (measured)');
    expect(line).not.toBe(' · 1 advertised per turn (measured)');
    expect(line).not.toContain('capped');
  });

  it('the distinct tools actually called are present in the trace the measurement reads', () => {
    const called = new Set(trace.filter((e) => e.category === 'tool').map((e) => e.label));
    expect(called.size).toBe(CALLED_TOOLS.length);
    expect(called.size).toBeGreaterThanOrEqual(15);
  });
});
