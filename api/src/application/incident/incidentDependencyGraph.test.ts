import { describe, it, expect } from 'vitest';
import { buildIncidentDependencyGraph, UNCLASSIFIED_SYSTEM, type IncidentGraphInput } from './incidentDependencyGraph';

const base: IncidentGraphInput = {
  incident: { id: 'i1', title: 'Checkout 500s', severity: 'sev1', status: 'open', affectedSystem: 'Payments' },
  monitors: [],
  relatedIncidents: [],
  implicatedTasks: [],
};

const edgeKeys = (g: { edges: { from: string; to: string }[] }) => g.edges.map((e) => `${e.from}->${e.to}`);

describe('buildIncidentDependencyGraph', () => {
  it('always yields a spine: the incident and the system it affects', () => {
    const g = buildIncidentDependencyGraph(base);
    expect(g.nodes.map((n) => n.id)).toEqual(['incident:i1', 'system:payments']);
    expect(edgeKeys(g)).toEqual(['system:payments->incident:i1']);
    expect(g.nodes[0]!.focus).toBe(true);
  });

  it('gives an unclassified incident a spine anyway', () => {
    // No affected system is the state an incident is in for its first minutes.
    // Rendering nothing then is rendering nothing exactly when triage is happening.
    const g = buildIncidentDependencyGraph({ ...base, incident: { ...base.incident, affectedSystem: null } });
    expect(g.nodes.map((n) => n.label)).toContain(UNCLASSIFIED_SYSTEM);
    expect(edgeKeys(g)).toEqual([`system:${UNCLASSIFIED_SYSTEM}->incident:i1`]);
  });

  it('folds systems case-insensitively so one outage is one node', () => {
    const g = buildIncidentDependencyGraph({
      ...base,
      monitors: [{ id: 'm1', label: 'Stripe webhook', status: 'breached', affectedSystem: 'payments', currentIncidentId: null }],
    });
    expect(g.nodes.filter((n) => n.kind === 'system')).toHaveLength(1);
    expect(edgeKeys(g)).toContain('system:payments->monitor:m1');
  });

  it('draws the detection path for the monitor that raised the incident', () => {
    const g = buildIncidentDependencyGraph({
      ...base,
      monitors: [{ id: 'm1', label: 'Checkout heartbeat', status: 'breached', affectedSystem: 'Payments', currentIncidentId: 'i1' }],
    });
    expect(edgeKeys(g)).toContain('monitor:m1->incident:i1');
    // …and the monitor stays attached to what it watches.
    expect(edgeKeys(g)).toContain('system:payments->monitor:m1');
  });

  it('hangs implicated tickets upstream of the system and prior incidents beside them', () => {
    const g = buildIncidentDependencyGraph({
      ...base,
      implicatedTasks: [{ taskId: 42, title: 'Bump payment SDK', status: 'done', relation: 'implicated' }],
      relatedIncidents: [{ id: 'i0', title: 'Card declines', severity: 'sev2', status: 'resolved', affectedSystem: 'Payments' }],
    });
    expect(edgeKeys(g)).toContain('ticket:42->system:payments');
    expect(edgeKeys(g)).toContain('incident:i0->system:payments');
    expect(g.edges.find((e) => e.from === 'ticket:42')!.label).toBe('implicated');
  });

  it('never emits the focus incident twice when it appears among the related rows', () => {
    const g = buildIncidentDependencyGraph({
      ...base,
      relatedIncidents: [{ ...base.incident }],
    });
    expect(g.nodes.filter((n) => n.id === 'incident:i1')).toHaveLength(1);
  });

  it('caps the node count so the picture stays a picture', () => {
    const g = buildIncidentDependencyGraph({
      ...base,
      monitors: Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, label: `M${i}`, status: 'ok', affectedSystem: 'Payments', currentIncidentId: null })),
      relatedIncidents: Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, title: `P${i}`, severity: 'sev3', status: 'resolved', affectedSystem: 'Payments' })),
      implicatedTasks: Array.from({ length: 20 }, (_, i) => ({ taskId: i, title: `T${i}`, status: 'done', relation: 'implicated' })),
    });
    expect(g.nodes.filter((n) => n.kind === 'monitor')).toHaveLength(8);
    expect(g.nodes.filter((n) => n.kind === 'incident')).toHaveLength(1 + 6);
    expect(g.nodes.filter((n) => n.kind === 'ticket')).toHaveLength(6);
  });

  it('deduplicates repeated edges', () => {
    const g = buildIncidentDependencyGraph({
      ...base,
      implicatedTasks: [
        { taskId: 7, title: 'Same ticket', status: 'done', relation: 'implicated' },
        { taskId: 7, title: 'Same ticket', status: 'done', relation: 'suspected' },
      ],
    });
    expect(edgeKeys(g).filter((k) => k === 'ticket:7->system:payments')).toHaveLength(1);
  });
});
