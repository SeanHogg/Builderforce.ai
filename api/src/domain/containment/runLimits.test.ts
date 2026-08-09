import { describe, expect, it } from 'vitest';
import { checkRunLimits } from './runLimits';

describe('checkRunLimits', () => {
  const limits = { maxFiles: 2, maxRepositories: 1, maxSpendMillicents: 100 };
  it('allows usage inside every declared boundary', () => expect(checkRunLimits(limits, { files: 2, repositories: 1, spendMillicents: 99 })).toBeNull());
  it('blocks a new file beyond the boundary', () => expect(checkRunLimits(limits, { files: 3, repositories: 1, spendMillicents: 0 })).toContain('file limit'));
  it('fails closed at the spend boundary', () => expect(checkRunLimits(limits, { files: 0, repositories: 1, spendMillicents: 100 })).toContain('spend limit'));
});
