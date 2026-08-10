import { describe, expect, it } from 'vitest';
import { selectAgentRelease } from './releaseSelection';
describe('selectAgentRelease', () => {
  const release = { stableVersionId: 'stable', canaryVersionId: 'canary', canaryPercent: 10 };
  it('assigns a deterministic canary cohort', () => expect(selectAgentRelease(105, release)).toBe('canary'));
  it('keeps the rest on stable', () => expect(selectAgentRelease(142, release)).toBe('stable'));
  it('cannot canary without a canary version', () => expect(selectAgentRelease(1, { ...release, canaryVersionId: null, canaryPercent: 100 })).toBe('stable'));
});
