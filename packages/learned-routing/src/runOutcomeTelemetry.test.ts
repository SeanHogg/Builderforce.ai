import { describe, expect, it } from 'vitest';
import { PARENT_RUN_ID_MAX, parseRunOutcomeTelemetry } from './runOutcomeTelemetry.js';

/** A sub-agent's row names its owner; anything that is not an id is a missing fact, never a rejected report. */
describe('parseRunOutcomeTelemetry — parentRunId', () => {
  it('keeps the owner id a sub-agent reports, trimmed', () => {
    expect(parseRunOutcomeTelemetry({ parentRunId: ' onprem:run-9 ' }).parentRunId).toBe('onprem:run-9');
  });

  it('drops one that is not an id, or too long for its column', () => {
    for (const bad of [42, '', '   ', 'has space', 'semi;colon', 'x'.repeat(PARENT_RUN_ID_MAX + 1), null, undefined]) {
      expect(parseRunOutcomeTelemetry({ parentRunId: bad })).not.toHaveProperty('parentRunId');
    }
  });
});
