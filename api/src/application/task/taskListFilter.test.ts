import { describe, expect, it } from 'vitest';
import { filterReadsMaskedFields, hasSelectiveField, parseTaskListFilter, TaskListFilterError } from './taskListFilter';

describe('parseTaskListFilter', () => {
  it('defaults to the open scope, and an explicit status is its own (all) scope', () => {
    expect(parseTaskListFilter(undefined)).toEqual({ scope: 'open' });
    expect(parseTaskListFilter({})).toEqual({ scope: 'open' });
    expect(parseTaskListFilter({ status: 'done' })).toEqual({ scope: 'all', status: 'done' });
    expect(parseTaskListFilter({ scope: 'closed' })).toEqual({ scope: 'closed' });
    // An unknown scope falls back, exactly like agent-loop's parseTaskListScope.
    expect(parseTaskListFilter({ scope: 'bogus' }, 'all')).toEqual({ scope: 'all' });
  });

  it('parses every narrowing field', () => {
    const f = parseTaskListFilter({
      projectId: '3', status: 'todo', scope: 'all', parentTaskId: 9,
      titlePrefix: ' [QA Engineer] ', titleMatch: 'login', createdBefore: '2026-11-01T00:00:00Z',
      createdAfter: '2026-10-01', assigned: 'none', isFanoutCopy: true, taskType: 'bug',
    });
    expect(f).toEqual({
      scope: 'all', projectId: 3, status: 'todo', parentTaskId: 9,
      titlePrefix: '[QA Engineer]', titleMatch: 'login',
      createdBefore: new Date('2026-11-01T00:00:00Z'), createdAfter: new Date('2026-10-01'),
      assigned: 'none', isFanoutCopy: true, taskType: 'bug',
    });
  });

  it('treats null as absent (strict-schema models send null for every unused field); top-level is explicit', () => {
    const allNull = parseTaskListFilter({
      projectId: null, status: null, parentTaskId: null, topLevelOnly: null, titlePrefix: null, titleMatch: null,
      createdBefore: null, createdAfter: null, assigned: null, isFanoutCopy: null, taskType: null,
    });
    expect(allNull).toEqual({ scope: 'open' });
    expect(parseTaskListFilter({ topLevelOnly: true })).toEqual({ scope: 'open', topLevelOnly: true });
    expect(parseTaskListFilter({ topLevelOnly: false })).toEqual({ scope: 'open' });
    expect(() => parseTaskListFilter({ topLevelOnly: true, parentTaskId: 4 })).toThrow(/parentTaskId OR topLevelOnly/);
  });

  it('rejects malformed values with an actionable error', () => {
    expect(() => parseTaskListFilter([])).toThrow(TaskListFilterError);
    expect(() => parseTaskListFilter({ projectId: 'abc' })).toThrow(/projectId must be a server id/);
    expect(() => parseTaskListFilter({ parentTaskId: -1 })).toThrow(/parentTaskId must be a server id/);
    expect(() => parseTaskListFilter({ createdBefore: 'yesterday' })).toThrow(/createdBefore must be an ISO/);
    // Date.parse would accept these; the contract is ISO only.
    expect(() => parseTaskListFilter({ createdAfter: 'March 7, 2026' })).toThrow(/createdAfter must be an ISO/);
    expect(() => parseTaskListFilter({ createdAfter: '11/01/2026' })).toThrow(/createdAfter must be an ISO/);
    expect(() => parseTaskListFilter({ createdBefore: '2026-01-01', createdAfter: '2026-02-01' })).toThrow(/earlier than/);
    expect(() => parseTaskListFilter({ assigned: 'some' })).toThrow(/assigned must be one of: none, any/);
    expect(() => parseTaskListFilter({ isFanoutCopy: 'yes' })).toThrow(/isFanoutCopy must be a boolean/);
    expect(() => parseTaskListFilter({ topLevelOnly: 'yes' })).toThrow(/topLevelOnly must be a boolean/);
    expect(() => parseTaskListFilter({ taskType: 'story' })).toThrow(/taskType must be one of/);
    expect(() => parseTaskListFilter({ titleMatch: 42 })).toThrow(/titleMatch must be a string/);
    expect(() => parseTaskListFilter({ titlePrefix: 'x'.repeat(501) })).toThrow(/capped at 500/);
  });

  it('accepts the ISO shapes', () => {
    for (const iso of ['2026-11-01', '2026-11-01T09:30', '2026-11-01T09:30:00Z', '2026-11-01T09:30:00.123+02:00']) {
      expect(parseTaskListFilter({ createdAfter: iso }).createdAfter).toBeInstanceOf(Date);
    }
  });
});

describe('hasSelectiveField', () => {
  it('is false for fields that still match most of a workspace', () => {
    for (const raw of [{}, { scope: 'closed' }, { assigned: 'none' }, { topLevelOnly: true }, { createdBefore: '2026-11-01' }, { isFanoutCopy: false }]) {
      expect(hasSelectiveField(parseTaskListFilter(raw))).toBe(false);
    }
  });

  it('is true for each selective field', () => {
    for (const raw of [
      { projectId: 3 }, { status: 'todo' }, { parentTaskId: 9 }, { titlePrefix: '[Dev]' }, { titleMatch: 'x' },
      { isFanoutCopy: true }, { taskType: 'gap' }, { createdAfter: '2026-10-01' },
    ]) {
      expect(hasSelectiveField(parseTaskListFilter(raw))).toBe(true);
    }
  });
});

describe('filterReadsMaskedFields', () => {
  it('flags the filters a SECURITY mask hides (title, assignee) and nothing else', () => {
    expect(filterReadsMaskedFields(parseTaskListFilter({ titlePrefix: 'x' }))).toBe(true);
    expect(filterReadsMaskedFields(parseTaskListFilter({ titleMatch: 'x' }))).toBe(true);
    expect(filterReadsMaskedFields(parseTaskListFilter({ assigned: 'any' }))).toBe(true);
    expect(filterReadsMaskedFields(parseTaskListFilter({ projectId: 3, status: 'todo', isFanoutCopy: true }))).toBe(false);
  });
});
