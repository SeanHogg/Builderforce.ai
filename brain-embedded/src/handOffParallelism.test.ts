import { describe, expect, it } from 'vitest';
import { handOffModeSentence, modeOf, planScopeClash, scopeClashCorrective, splitForParallel, splitLayoutLine, type ScopedTask } from './handOffParallelism';

const t = (title: string, ...paths: string[]): ScopedTask => ({ title, paths });

/** VS Code chat #70776: task 1 owns the parent of tasks 2–4's paths. */
const CHAT_70776 = [
  t('Restructure the surface', 'Builderforce.ai/packages/knowledge-graph-view/src/surface'),
  t('Restyle', 'Builderforce.ai/packages/knowledge-graph-view/src/surface/style'),
  t('Feature panels', 'Builderforce.ai/packages/knowledge-graph-view/src/surface/features'),
  t('Overlay test', 'Builderforce.ai/packages/knowledge-graph-view/src/surface/SceneOverlay.test.tsx'),
];

describe('splitForParallel — order beats parallelism', () => {
  it('regression #70776: a parent-directory task FIRST keeps the whole plan inline — its children may not start before it', () => {
    const split = splitForParallel(CHAT_70776);
    expect(split.parallel).toEqual([]);
    expect(split.inline).toEqual([0, 1, 2, 3]);
    expect(split.clash).toEqual({ a: 'Restructure the surface', b: 'Restyle', path: 'Builderforce.ai/packages/knowledge-graph-view/src/surface' });
    expect(modeOf(split)).toBe('inline');
  });

  it('an overlapping task LAST lets the disjoint tasks before it fan out; it runs inline after them', () => {
    const split = splitForParallel([t('Style', 'src/style'), t('Features', 'src/features'), t('Tidy the surface', 'src')]);
    expect(split.parallel).toEqual([0, 1]);
    expect(split.inline).toEqual([2]);
    expect(split.clash).toEqual({ a: 'Style', b: 'Tidy the surface', path: 'src/style' });
    expect(modeOf(split)).toBe('mixed');
  });

  it('never fans out a task that comes after an inline one, even when it is disjoint', () => {
    const split = splitForParallel([t('A', 'a'), t('B', 'b'), t('Docs'), t('C', 'c')]);
    expect(split).toEqual({ parallel: [0, 1], inline: [2, 3], clash: null });
  });

  it('runs a fully disjoint plan wholly side by side', () => {
    const split = splitForParallel([t('A', 'a'), t('B', 'b'), t('C', 'c')]);
    expect(split).toEqual({ parallel: [0, 1, 2], inline: [], clash: null });
    expect(modeOf(split)).toBe('parallel');
  });

  it('keeps a single task, a plan that leads with a pathless task, or a nested pair inline', () => {
    expect(modeOf(splitForParallel([t('A', 'a')]))).toBe('inline');
    expect(modeOf(splitForParallel([t('A'), t('B', 'b'), t('C', 'c')]))).toBe('inline');
    expect(modeOf(splitForParallel([t('A', 'a'), t('Docs'), t('B', 'b')]))).toBe('inline');
    const nested = splitForParallel([t('A', 'src'), t('B', 'src/b.ts')]);
    expect(nested.parallel).toEqual([]);
    expect(nested.clash).not.toBeNull();
  });
});

describe('the clash is named, never thrown away', () => {
  it('names both tasks and the path, and says truthfully what an unchanged plan does', () => {
    const clash = planScopeClash(CHAT_70776)!;
    const text = scopeClashCorrective(clash);
    expect(text).toContain('"Restructure the surface" and "Restyle" both own Builderforce.ai/packages/knowledge-graph-view/src/surface');
    expect(text).toContain('a parent directory that contains another task\'s paths blocks parallel work');
    expect(text).toContain('every task from the first overlapping one onward then runs inline, in plan order');
    expect(planScopeClash([t('A', 'a'), t('B'), t('C', 'c')])).toBeNull();
  });

  it('says which tasks run side by side and which in order, and why', () => {
    const line = splitLayoutLine(splitForParallel([t('Style', 'src/style'), t('Features', 'src/features'), t('Tidy', 'src')]));
    expect(line).toContain('Side by side: tasks 1 and 2.');
    expect(line).toContain('Then in order, by the coding model: task 3 — "Style" and "Tidy" both own src/style');
    expect(splitLayoutLine(splitForParallel(CHAT_70776))).toContain('In order, by the coding model — "Restructure the surface" and "Restyle" both own');
    expect(splitLayoutLine(splitForParallel([t('A', 'a'), t('B', 'b')]))).toBe('');
    expect(handOffModeSentence({ mode: 'mixed', parallelTasks: ['B', 'C'], inlineTasks: ['A'], clash: { a: 'A', b: 'B', path: 'src' } }))
      .toBe('2 task(s) ran side by side as coding sub-agents; 1 went to the coding model inline ("A" and "B" both own src).');
  });
});
