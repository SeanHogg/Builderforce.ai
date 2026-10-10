/**
 * @vitest-environment jsdom
 *
 * The planning reads, answered from the sample workspace. Coverage first — each
 * of these was a guest looking at an empty value stream or an empty Gantt — and
 * then the property that keeps the planning tier honest: the tree, the value
 * stream, the spine and the trackers describe ONE hierarchy, and the progress
 * they report is the board's own count.
 */
import { describe, it, expect } from 'vitest';
import { resolveGuestRead } from '../../application/guestRead';
import type { FunnelMetrics, Initiative, InnovationIdea, KeyResult, Objective, PmoTree, Portfolio, SpineResult, ValueStream } from '@/lib/builderforceApi';
import { SAMPLE_PROJECTS, isSampleTaskCompleted, sampleTaskId } from '../../domain/sampleWorkspace';
import { SAMPLE_IDEAS, SAMPLE_INITIATIVES } from '../../domain/samplePlanning';

const read = <T,>(path: string) => resolveGuestRead({ path, method: 'GET', hadToken: false })?.body as T | undefined;

describe('planning (PMO) fixtures', () => {
  it('answers every /api/pmo read a guest can fire', () => {
    for (const path of [
      '/api/pmo/tree',
      '/api/pmo/rollup?kind=workspace',
      '/api/pmo/value-stream',
      '/api/pmo/spine',
      '/api/pmo/spine?project=9001',
      '/api/pmo/portfolios',
      '/api/pmo/initiatives',
      '/api/pmo/objectives',
      '/api/pmo/key-results',
    ]) {
      expect(read(path), path).toBeDefined();
    }
  });

  it('describes ONE hierarchy across the tree, the value stream and the trackers', () => {
    const tree = read<PmoTree>('/api/pmo/tree')!;
    const stream = read<ValueStream>('/api/pmo/value-stream')!;
    const initiatives = read<Initiative[]>('/api/pmo/initiatives')!;
    const portfolios = read<Portfolio[]>('/api/pmo/portfolios')!;
    const ids = tree.initiatives.map((i) => i.id).sort();
    expect(stream.nodes.map((n) => n.id).sort()).toEqual(ids);
    expect(initiatives.map((i) => i.id).sort()).toEqual(ids);
    expect(initiatives.every((i) => i.portfolioId === portfolios[0]!.id)).toBe(true);
    expect(stream.edges.map((e) => e.id)).toEqual(tree.dependencies.map((d) => d.id));
  });

  it("reports each initiative's progress as its board's own completed count", () => {
    const stream = read<ValueStream>('/api/pmo/value-stream')!;
    for (const initiative of SAMPLE_INITIATIVES) {
      const work = initiative.project.tasks.filter((t) => !t.epic);
      const node = stream.nodes.find((n) => n.id === initiative.id)!;
      expect(node.totalTasks).toBe(work.length);
      expect(node.completedTasks).toBe(work.filter((t) => isSampleTaskCompleted(t.status)).length);
    }
  });

  it('walks the critical path along the dependency, blocker first', () => {
    const stream = read<ValueStream>('/api/pmo/value-stream')!;
    const edge = stream.edges[0]!;
    expect(stream.criticalPath).toEqual([edge.fromInitiativeId, edge.toInitiativeId]);
    expect(stream.nodes.find((n) => n.id === edge.toInitiativeId)!.blockedBy).toEqual([edge.fromInitiativeId]);
  });

  it('rolls spine cost up so the totals equal the sum of the leaves', () => {
    const spine = read<SpineResult>('/api/pmo/spine')!;
    const leaves = spine.nodes.filter((n) => n.kind === 'task');
    const leafTotal = leaves.reduce((sum, n) => sum + n.cost.totalUsd, 0);
    expect(spine.totals.totalUsd).toBe(leafTotal);
    expect(spine.totals.capexUsd + spine.totals.opexUsd).toBe(leafTotal);
    // Every parent the spine names is a node it carries.
    const keys = new Set(spine.nodes.map((n) => n.key));
    for (const n of spine.nodes) if (n.parentKey) expect(keys.has(n.parentKey), n.key).toBe(true);
  });

  it('keys spine tickets by the SAME id the board uses', () => {
    const spine = read<SpineResult>('/api/pmo/spine')!;
    const project = SAMPLE_PROJECTS[0]!;
    const task = project.tasks.find((t) => !t.epic)!;
    expect(spine.nodes.some((n) => n.key === `task:${sampleTaskId(project, task)}`)).toBe(true);
  });

  it('scopes the spine leaf set to one project and never points at a pruned row', () => {
    const project = SAMPLE_PROJECTS[0]!;
    const spine = read<SpineResult>(`/api/pmo/spine?project=${project.id}`)!;
    const initiatives = spine.nodes.filter((n) => n.kind === 'initiative');
    expect(initiatives.map((n) => n.title)).toEqual([project.name]);
    const keys = new Set(spine.nodes.map((n) => n.key));
    for (const n of spine.nodes) for (const dep of n.dependsOn) expect(keys.has(dep)).toBe(true);
  });

  it('hangs key results off an objective the objectives tracker returns', () => {
    const objectives = read<Objective[]>('/api/pmo/objectives')!;
    const keyResults = read<KeyResult[]>('/api/pmo/key-results')!;
    const ids = new Set(objectives.map((o) => o.id));
    expect(keyResults.length).toBeGreaterThan(0);
    expect(keyResults.every((kr) => ids.has(kr.objectiveId))).toBe(true);
  });
});

describe('innovation funnel fixture', () => {
  it('counts the same ideas the list under it renders', () => {
    const funnel = read<FunnelMetrics>('/api/innovation/funnel')!;
    const ideas = read<InnovationIdea[]>('/api/innovation/ideas')!;
    expect(funnel.totalIdeas).toBe(ideas.length);
    expect(funnel.killedCount).toBe(ideas.filter((i) => i.stage === 'killed').length);
    expect(funnel.stages.map((s) => s.stage)).toEqual(['idea', 'validated', 'in_build', 'shipped', 'measured']);
  });

  it('keeps "reached" cumulative, so it never rises down the funnel', () => {
    const funnel = read<FunnelMetrics>('/api/innovation/funnel')!;
    const reached = funnel.stages.map((s) => s.reached);
    expect(reached[0]).toBe(funnel.activeIdeas);
    for (let i = 1; i < reached.length; i += 1) expect(reached[i]!).toBeLessThanOrEqual(reached[i - 1]!);
  });

  it('narrows to the ideas that became one project', () => {
    const project = SAMPLE_PROJECTS[0]!;
    const funnel = read<FunnelMetrics>(`/api/innovation/funnel?projectId=${project.id}`)!;
    expect(funnel.totalIdeas).toBe(SAMPLE_IDEAS.filter((i) => i.projectKey === project.key).length);
  });
});
