import { describe, it, expect } from 'vitest';
import { buildVisitorFlowGraph } from './visitorFlowGraph';

/** A visitor who typed a prompt, walked two pages and left. */
function visit(visitorId: string, visitId: string, paths: string[], startMs = 1_000) {
  return paths.map((path, index) => ({
    visitorId,
    visitId,
    kind: 'page_view',
    path,
    occurredAt: new Date(startMs + index * 1_000).toISOString(),
  }));
}

describe('buildVisitorFlowGraph', () => {
  it('derives an edge for each consecutive pair inside one visit', () => {
    const graph = buildVisitorFlowGraph({
      events: visit('v1', 'a', ['/', '/pricing']),
      prompts: [],
      conversions: [],
    });

    expect(graph.edges).toEqual([
      expect.objectContaining({ from: 'page:/', to: 'page:/pricing', visitors: 1 }),
    ]);
  });

  it('never joins two different visits into one edge', () => {
    // The whole point of visit_id: /pricing then / in a LATER visit is a return,
    // not a navigation, and drawing it as one would invent a path nobody walked.
    const graph = buildVisitorFlowGraph({
      events: [
        ...visit('v1', 'first', ['/', '/pricing'], 1_000),
        ...visit('v1', 'second', ['/docs'], 900_000),
      ],
      prompts: [],
      conversions: [],
    });

    expect(graph.edges.map((e) => `${e.from}->${e.to}`)).toEqual(['page:/->page:/pricing']);
    expect(graph.totals.visits).toBe(2);
    expect(graph.totals.returningVisitors).toBe(1);
  });

  it('places the prompt by its timestamp, ahead of the pages that followed it', () => {
    const graph = buildVisitorFlowGraph({
      events: visit('v1', 'a', ['/create'], 2_000),
      prompts: [{
        visitorId: 'v1',
        visitId: 'a',
        prompt: 'build me a CRM',
        surface: 'landing',
        createdAt: new Date(1_000).toISOString(),
      }],
      conversions: [],
    });

    expect(graph.edges).toEqual([
      expect.objectContaining({ from: 'prompt', to: 'page:/create' }),
    ]);
    expect(graph.totals.visitsWithPrompt).toBe(1);
  });

  it('counts the last step of a visit as an exit — the leak', () => {
    const graph = buildVisitorFlowGraph({
      events: [...visit('v1', 'a', ['/', '/pricing']), ...visit('v2', 'b', ['/', '/pricing'])],
      prompts: [],
      conversions: [],
    });

    const pricing = graph.nodes.find((n) => n.id === 'page:/pricing');
    const home = graph.nodes.find((n) => n.id === 'page:/');
    expect(pricing?.exits).toBe(2);
    expect(home?.exits).toBe(0);
  });

  it('ends a converted visitor at the account, so a signup page is not read as a leak', () => {
    const graph = buildVisitorFlowGraph({
      events: visit('v1', 'a', ['/signup']),
      prompts: [],
      conversions: [{ visitorId: 'v1', converted: true }],
    });

    const signup = graph.nodes.find((n) => n.id === 'page:/signup');
    expect(signup?.exits).toBe(0);
    expect(graph.nodes.some((n) => n.kind === 'converted')).toBe(true);
    expect(graph.totals.convertedVisitors).toBe(1);
  });

  it('puts an error on the flow between the page before it and what came next', () => {
    const graph = buildVisitorFlowGraph({
      events: [
        { visitorId: 'v1', visitId: 'a', kind: 'page_view', path: '/pricing', occurredAt: new Date(1_000).toISOString() },
        { visitorId: 'v1', visitId: 'a', kind: 'error', path: '/pricing', occurredAt: new Date(2_000).toISOString() },
        { visitorId: 'v1', visitId: 'a', kind: 'visit_end', path: '/pricing', occurredAt: new Date(3_000).toISOString() },
      ],
      prompts: [],
      conversions: [],
    });

    expect(graph.edges.map((e) => `${e.from}->${e.to}`)).toEqual([
      'page:/pricing->error:/pricing',
      'error:/pricing->exit',
    ]);
    expect(graph.totals.visitsWithError).toBe(1);
  });

  it('keeps rows that predate visit ids rather than dropping the history', () => {
    const graph = buildVisitorFlowGraph({
      events: [
        { visitorId: 'v1', visitId: null, kind: 'page_view', path: '/', occurredAt: new Date(1_000).toISOString() },
        { visitorId: 'v1', visitId: null, kind: 'page_view', path: '/docs', occurredAt: new Date(2_000).toISOString() },
      ],
      prompts: [],
      conversions: [],
    });

    expect(graph.totals.visitors).toBe(1);
    expect(graph.edges).toHaveLength(1);
  });

  it('bounds the node count and drops the edges that dangle off the trimmed tail', () => {
    const events = Array.from({ length: 30 }, (_, index) =>
      visit(`v${index}`, `visit${index}`, ['/', `/page-${index}`], 1_000 + index));
    const graph = buildVisitorFlowGraph({
      events: events.flat(),
      prompts: [],
      conversions: [],
      maxNodes: 5,
    });

    expect(graph.nodes.length).toBeLessThanOrEqual(5);
    const ids = new Set(graph.nodes.map((n) => n.id));
    for (const edge of graph.edges) {
      expect(ids.has(edge.from) && ids.has(edge.to)).toBe(true);
    }
  });
});
