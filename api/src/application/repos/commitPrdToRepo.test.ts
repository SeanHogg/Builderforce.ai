import { describe, expect, it } from 'vitest';
import { taskPrdRepoPath } from './commitPrdToRepo';

describe('task PRD repository path', () => {
  it('isolates each task brief from the repository-wide product PRD', () => {
    expect(taskPrdRepoPath(42)).toBe('specs/tasks/task-42.md');
    expect(taskPrdRepoPath(43)).not.toBe(taskPrdRepoPath(42));
    expect(taskPrdRepoPath(42)).not.toBe('PRD.md');
  });
});
