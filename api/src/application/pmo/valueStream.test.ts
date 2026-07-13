import { describe, expect, it } from 'vitest';
import { buildValueStream, type VsInitiativeRow, type VsEdgeRow, type VsTaskRow } from './valueStream';

const inits: VsInitiativeRow[] = [
  { id: 'a', name: 'A', status: 'active' },
  { id: 'b', name: 'B', status: 'active' },
  { id: 'c', name: 'C', status: 'active' },
  { id: 'd', name: 'D', status: 'completed' },
];
// a → b → c chain; d is done.
const edges: VsEdgeRow[] = [
  { id: 'e1', fromInitiativeId: 'a', toInitiativeId: 'b' },
  { id: 'e2', fromInitiativeId: 'b', toInitiativeId: 'c' },
];
const taskRows: VsTaskRow[] = [
  { initiativeId: 'a', status: 'done' }, { initiativeId: 'a', status: 'in_progress' },
  { initiativeId: 'b', status: 'backlog' },
];

describe('buildValueStream', () => {
  it('marks the critical path across incomplete initiatives', () => {
    const vs = buildValueStream(inits, edges, taskRows);
    expect(vs.criticalPath).toEqual(['a', 'b', 'c']);
    expect(vs.nodes.find((n) => n.id === 'a')!.onCriticalPath).toBe(true);
    expect(vs.nodes.find((n) => n.id === 'd')!.onCriticalPath).toBe(false);
    expect(vs.cycleDetected).toBe(false);
  });

  it('flags the edges that lie on the critical path', () => {
    const vs = buildValueStream(inits, edges, taskRows);
    expect(vs.edges.every((e) => e.onCriticalPath)).toBe(true);
  });

  it('records who blocks whom', () => {
    const vs = buildValueStream(inits, edges, taskRows);
    expect(vs.nodes.find((n) => n.id === 'b')!.blockedBy).toEqual(['a']);
    expect(vs.nodes.find((n) => n.id === 'a')!.blockedBy).toEqual([]);
  });

  it('rolls up per-initiative delivery progress from tasks', () => {
    const vs = buildValueStream(inits, edges, taskRows);
    const a = vs.nodes.find((n) => n.id === 'a')!;
    expect(a.totalTasks).toBe(2);
    expect(a.completedTasks).toBe(1);
    expect(a.completionPct).toBe(50);
    const c = vs.nodes.find((n) => n.id === 'c')!;
    expect(c.totalTasks).toBe(0);
    expect(c.completionPct).toBe(0);
  });

  it('detects a cycle among incomplete initiatives', () => {
    const cyc: VsEdgeRow[] = [...edges, { id: 'e3', fromInitiativeId: 'c', toInitiativeId: 'a' }];
    const vs = buildValueStream(inits, cyc, taskRows);
    expect(vs.cycleDetected).toBe(true);
  });
});
