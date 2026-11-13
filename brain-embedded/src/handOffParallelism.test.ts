import { describe, expect, it } from 'vitest';
import { handOffModeSentence, modeOf, planScopeClash, referencesPackage, scopeClashCorrective, splitForParallel, splitLayoutLine, taskPackageDir, type ScopedTask } from './handOffParallelism';

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

describe('order dependencies — a consumer runs after its producer (chat #80006)', () => {
  it('regression: dependent slices are staged, not parallel', () => {
    const plan = [
      { title: 'Add RunDelta exports', paths: ['packages/knowledge-graph-view/src/delta'] },
      {
        title: 'Wire the web host',
        brief: 'imports the new RunDelta/CopiedNote exports from @builderforce/knowledge-graph-view',
        paths: ['frontend/src/components/runDelta'],
      },
      { title: 'Wire the VS Code host', paths: ['clients/vscode/webview/src/chat'] },
    ];
    const split = splitForParallel(plan);
    expect(split.parallel).toEqual([]);
    expect(split.inline).toEqual([0, 1, 2]);
    expect(split.clash).toBeNull();
    expect(split.order).toEqual([{ producer: 0, consumer: 1, packageDir: 'packages/knowledge-graph-view' }]);
    expect(modeOf(split)).toBe('inline');
  });

  it('lets the consumers that do NOT consume the producer fan out beside each other after it', () => {
    const plan = [
      { title: 'Add RunDelta exports', paths: ['packages/knowledge-graph-view/src/delta'] },
      { title: 'Wire the web host', brief: 'imports the new RunDelta/CopiedNote exports from @builderforce/knowledge-graph-view', paths: ['frontend/src/components/runDelta'] },
      { title: 'Docs', paths: ['docs/run-delta.md'] },
    ];
    const split = splitForParallel(plan);
    expect(split.parallel).toEqual([]);
    expect(split.inline).toEqual([0, 1, 2]);
    expect(split.order).toHaveLength(1);
    expect(split.order![0]).toMatchObject({ producer: 0, consumer: 1 });
  });

  it('keeps independent tasks parallel — no order field when nothing is consumed', () => {
    const split = splitForParallel([t('A', 'a'), t('B', 'b'), t('C', 'c')]);
    expect(split.parallel).toEqual([0, 1, 2]);
    expect(split.order).toBeUndefined();
    expect(splitLayoutLine(split)).toBe('');
  });

  it('a bare-filename task whose package resolves to the repo root never yields a false dependency', () => {
    // 'a.ts' has no directory, so taskPackageDir falls back to '.', whose basename is a period
    // that would match any brief containing a dot — pinning the whole plan inline.
    const plan = [
      { title: 'Add file', paths: ['a.ts'] },
      { title: 'Write notes v1.2', brief: 'capture what we shipped in notes v1.2', paths: ['docs/notes.md'] },
    ];
    const split = splitForParallel(plan);
    expect(split.parallel).toEqual([0, 1]);
    expect(split.inline).toEqual([]);
    expect(split.clash).toBeNull();
    expect(split.order).toBeUndefined();
    expect(modeOf(split)).toBe('parallel');
  });

  it('leaves the all-inline plan inline when the brief names an earlier task\'s package', () => {
    const plan = [
      { title: 'Kernel exports', paths: ['packages/agent-loop/src/kernel.ts'] },
      { title: 'Surface', brief: 'render the kernel state exported by the agent-loop package', paths: ['packages/brain-ui/src/kernel.ts'] },
    ];
    const split = splitForParallel(plan);
    expect(split.parallel).toEqual([]);
    expect(split.inline).toEqual([0, 1]);
    expect(split.clash).toBeNull();
    const line = splitLayoutLine(split, plan.map((p) => p.title));
    expect(line).toContain('In order, by the coding model');
    expect(line).toContain('"Surface" consumes packages/agent-loop');
    expect(line).toContain('so the consumer runs after the producer');
  });

  it('taskPackageDir finds the package root and falls back to the deepest common parent', () => {
    expect(taskPackageDir({ title: 'A', paths: ['packages/knowledge-graph-view/src/delta'] })).toBe('packages/knowledge-graph-view');
    expect(taskPackageDir({ title: 'A', paths: ['packages/knowledge-graph-view/src/a.ts', 'packages/knowledge-graph-view/src/b.ts'] })).toBe('packages/knowledge-graph-view');
    expect(taskPackageDir({ title: 'A', paths: [] })).toBeNull();
    expect(taskPackageDir({ title: 'A', paths: ['src/surface/style', 'src/surface/features'] })).toBe('src/surface');
    expect(taskPackageDir({ title: 'A', paths: ['docs/run-delta.md'] })).toBe('docs');
    expect(taskPackageDir({ title: 'A', paths: ['frontend/src/components/runDelta'] })).toBe('frontend');
  });

  it('referencesPackage matches the directory or its basename, normalized', () => {
    expect(referencesPackage('imports the new RunDelta/CopiedNote exports from @builderforce/knowledge-graph-view', 'packages/knowledge-graph-view')).toBe(true);
    expect(referencesPackage('imports from packages\\knowledge-graph-view', 'packages/knowledge-graph-view')).toBe(true);
    expect(referencesPackage('touch up the run delta host', 'packages/knowledge-graph-view')).toBe(false);
    expect(referencesPackage('', 'packages/knowledge-graph-view')).toBe(false);
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
