import { describe, expect, it } from 'vitest';
import { checkFootprintLimits, checkRunLimits } from './runLimits';

describe('checkFootprintLimits', () => {
  const limits = { maxFiles: 2, maxRepositories: 1 };
  it('checks files and repositories only — a tool call carries no spend', () => {
    expect(checkFootprintLimits(limits, { files: 2, repositories: 1 })).toBeNull();
    expect(checkFootprintLimits(limits, { files: 3, repositories: 1 })).toContain('file limit');
    expect(checkFootprintLimits(limits, { files: 0, repositories: 2 })).toContain('repository limit');
  });

  it('is the first half of checkRunLimits', () => {
    const full = { ...limits, maxSpendMillicents: 0 };
    expect(checkFootprintLimits(full, { files: 0, repositories: 0 })).toBeNull();
    expect(checkRunLimits(full, { files: 0, repositories: 0, spendMillicents: 0 })).toContain('spend limit');
  });
});
