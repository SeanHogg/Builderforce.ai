import { describe, expect, it } from 'vitest';
import type { BrainTraceEvent } from './brainTriage';
import { modelTurnLog } from './modelScorecard';
import { formatRoutingByRole, routingByRole } from './routingByRole';
import { coderReaskTrace, handOffTrace } from './runPolicyTraces';

const TS = '2026-10-26T00:00:00.000Z';
const llm = (model: string, role: string, extra: Record<string, unknown> = {}): BrainTraceEvent => ({
  ts: TS,
  category: 'llm',
  label: 'llm.complete',
  args: { model, requestedModel: 'default', role, toolCalls: 1, ...extra },
});
const mark = (label: string): BrainTraceEvent => ({ ts: TS, category: 'message', label });

describe('routingByRole', () => {
  it('names the planner answering every code turn, with what the gateway left on the way', () => {
    const flash = 'direct/minimax/MiniMax-M3.1-Flash-Preview';
    const events = [
      llm(flash, 'plan'),
      llm(flash, 'plan'),
      coderReaskTrace(TS, 2, flash),
      llm(flash, 'code', { failovers: 'direct/xai/grok-4.7:403 capacity' }),
    ];
    const r = routingByRole(modelTurnLog(events), events);
    expect(r.coderReasks).toBe(1);
    expect(r.handOffs).toBe(0);
    const lines = formatRoutingByRole(r);
    expect(lines[0]).toBe('Routing by role:');
    expect(lines).toContain(`  • code: 1 turn(s) — ${flash} ×1 · gateway left: direct/xai/grok-4.7:403 capacity ×1`);
    expect(lines.some((l) => l.includes('every code turn was answered by the planning model'))).toBe(true);
  });

  it('counts hand-offs and the analysis budget, and stays quiet when a stronger coder served', () => {
    const events = [
      llm('direct/minimax/MiniMax-M3.1-Flash-Preview', 'plan'),
      mark('loop.hand_off_due'),
      handOffTrace(TS, 2, 1, 'hand_off'),
      llm('direct/xai/grok-4.7', 'code'),
    ];
    const lines = formatRoutingByRole(routingByRole(modelTurnLog(events), events));
    expect(lines.some((l) => l.includes('1 hand_off call(s) · 1 forced by the analysis budget'))).toBe(true);
    expect(lines.some((l) => l.startsWith('  ⚠'))).toBe(false);
  });

  it('renders nothing for a trace that never recorded a role', () => {
    const events = [{ ...llm('m', 'plan'), args: { model: 'm', toolCalls: 1 } }];
    expect(formatRoutingByRole(routingByRole(modelTurnLog(events), events))).toEqual([]);
  });
});
