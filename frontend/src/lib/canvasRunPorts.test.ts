import { describe, expect, it } from 'vitest';
import { effortProfile, type Effort } from '@seanhogg/builderforce-brain-embedded';
import { CANVAS_BUILD_RESPONSE_TOKENS, canvasTurnShape } from './canvasAiTurnBudget';
import { canvasRunPolicy } from './canvasRunPorts';
import type { CanvasAiOptions } from './canvasAiRun';

const options = (runShaping?: CanvasAiOptions['runShaping']) => ({ prompt: 'p', canvasSnapshot: '{}', persistence: 'local', canvasActions: [], notices: {}, runShaping }) as unknown as CanvasAiOptions;

// Compaction holds back a reserve for the reply: the largest reply this turn can ask for.
describe('canvasRunPolicy — the compaction reserve', () => {
  it('is the build ceiling when the composer states no effort', () => {
    expect(canvasRunPolicy(options(), 'hybrid').budgets.reserveTokens).toBe(CANVAS_BUILD_RESPONSE_TOKENS);
  });

  it.each(['quick', 'balanced', 'thorough'] as Effort[])('follows %s effort: the wire request’s own ceiling', (effort) => {
    const shaping = { effort, thinking: true };
    const reserve = canvasRunPolicy(options(shaping), 'hybrid').budgets.reserveTokens;
    expect(reserve).toBe(canvasTurnShape(CANVAS_BUILD_RESPONSE_TOKENS, shaping).maxTokens);
    expect(reserve).toBe(Math.max(CANVAS_BUILD_RESPONSE_TOKENS, effortProfile(effort).maxTokens));
  });

  it('is never below the build ceiling, and Thorough raises it', () => {
    const quick = canvasRunPolicy(options({ effort: 'quick', thinking: false }), 'hybrid').budgets.reserveTokens ?? 0;
    const thorough = canvasRunPolicy(options({ effort: 'thorough', thinking: true }), 'hybrid').budgets.reserveTokens ?? 0;
    expect(quick).toBeGreaterThanOrEqual(CANVAS_BUILD_RESPONSE_TOKENS);
    expect(thorough).toBeGreaterThanOrEqual(quick);
  });
});
