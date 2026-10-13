import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { filterFromQuery, type ReplayFlowDto } from '@builderforce/interaction-contract';
import { adminApi, type AdminVisitorFlow } from '@/lib/adminApi';
import { replayApi } from '@/lib/replayApi';
import { FLOW_SOURCES, FlowView, flowStepInsightsHref } from './FlowView';

/**
 * Selecting a step on the flow graph shows its numbers and, when the step is
 * a path, links to the Insights app filtered to sessions that visited it
 * (PRD 33 S5) — recordings are never shown in Admin (D17). The same view reads
 * an Insights site's kept-recording flow through its `replay` source, where a
 * step's action is the host's (`onWatchStep`).
 */

const data: AdminVisitorFlow = {
  nodes: [
    { id: 'page:/', kind: 'page', label: '/', visitors: 40, events: 50, exits: 5, medianStepIndex: 0 },
    { id: 'page:/pricing', kind: 'page', label: '/pricing', visitors: 12, events: 15, exits: 7, medianStepIndex: 1 },
    { id: '__exit__', kind: 'exit', label: '__exit__', visitors: 9, events: 9, exits: 9, medianStepIndex: 2 },
  ],
  edges: [
    { from: 'page:/', to: 'page:/pricing', visitors: 12, events: 12 },
    { from: 'page:/pricing', to: '__exit__', visitors: 7, events: 7 },
  ],
  totals: { visitors: 40, visits: 44, returningVisitors: 4, visitsWithPrompt: 10, visitsWithError: 0, convertedVisitors: 3 },
  windowDays: 30,
  truncated: false,
};

const replayFlow: ReplayFlowDto = {
  nodes: data.nodes,
  edges: data.edges,
  totals: data.totals,
};

beforeEach(() => {
  vi.spyOn(adminApi, 'visitorFlow').mockResolvedValue(data);
  vi.spyOn(replayApi, 'flow').mockResolvedValue(replayFlow);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function nodeButton(container: HTMLElement, label: string): Element {
  const match = [...container.querySelectorAll('g[role="button"]')].find((node) => node.querySelector('title')?.textContent?.includes(label));
  if (!match) throw new Error(`no node for ${label}`);
  return match;
}

describe('FlowView step detail', () => {
  it('shows the selected step and a link to its recordings in the Insights app', async () => {
    const { container } = render(<FlowView source={{ kind: 'admin', days: 30 }} onOpenVisitor={() => {}} />);
    await screen.findByText('admin.visitorFlow.stat.visitors');
    expect(adminApi.visitorFlow).toHaveBeenCalledWith(30);
    expect(screen.queryByRole('region', { name: /admin\.insights\.nodeStripAria/ })).toBeNull();

    fireEvent.click(nodeButton(container, '/pricing'));
    const strip = screen.getByRole('region', { name: 'admin.insights.nodeStripAria /pricing' });
    expect(strip).toHaveTextContent('admin.insights.nodeVisitors 12');
    expect(strip).toHaveTextContent('admin.insights.nodeExits 7');

    const link = screen.getByRole('link', { name: 'admin.insights.watchStep' });
    const href = new URL(link.getAttribute('href') ?? '', 'https://builderforce.ai');
    expect(href.pathname).toBe('/apps/insights');
    expect(href.searchParams.get('panel')).toBe('issues');
    expect(filterFromQuery(href.searchParams)).toEqual({ all: [{ field: 'visitedPath', op: 'eq', value: '/pricing' }] });
    expect(link.getAttribute('href')).toBe(flowStepInsightsHref('/pricing'));

    fireEvent.click(screen.getByRole('button', { name: 'admin.insights.nodeStripClose' }));
    expect(screen.queryByRole('region', { name: /admin\.insights\.nodeStripAria/ })).toBeNull();
  });

  it('offers no recordings link for a step that is not a path', async () => {
    const { container } = render(<FlowView source={{ kind: 'admin', days: 30 }} onOpenVisitor={() => {}} />);
    await screen.findByText('admin.visitorFlow.stat.visitors');
    fireEvent.click(nodeButton(container, 'admin.visitorFlow.kind.exit'));
    expect(screen.getByRole('region', { name: 'admin.insights.nodeStripAria __exit__' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'admin.insights.watchStep' })).toBeNull();
  });

  it('reads an Insights site through the replay source; a path step calls the host', async () => {
    const onWatchStep = vi.fn();
    const filter = { all: [{ field: 'device' as const, op: 'eq' as const, value: 'phone' }] };
    const { container } = render(<FlowView source={{ kind: 'replay', siteId: 'site-1', days: 7, filter }} onWatchStep={onWatchStep} />);
    await screen.findByText('admin.visitorFlow.stat.visitors');
    expect(replayApi.flow).toHaveBeenCalledWith('site-1', { days: 7, filter });
    expect(adminApi.visitorFlow).not.toHaveBeenCalled();
    // No visitor lookup without a journey drawer to open.
    expect(screen.queryByRole('textbox', { name: 'admin.visitorFlow.visitorPlaceholder' })).toBeNull();

    fireEvent.click(nodeButton(container, '/pricing'));
    expect(screen.queryByRole('link', { name: 'admin.insights.watchStep' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'admin.insights.watchStep' }));
    expect(onWatchStep).toHaveBeenCalledWith('/pricing');
  });

  it('switches loaders by source and re-reads on a new reload key', async () => {
    expect(Object.keys(FLOW_SOURCES).sort()).toEqual(['admin', 'replay']);
    const { rerender } = render(<FlowView source={{ kind: 'admin', days: 30 }} reloadKey={0} />);
    await waitFor(() => expect(adminApi.visitorFlow).toHaveBeenCalledTimes(1));
    rerender(<FlowView source={{ kind: 'admin', days: 30 }} reloadKey={1} />);
    await waitFor(() => expect(adminApi.visitorFlow).toHaveBeenCalledTimes(2));
  });
});
