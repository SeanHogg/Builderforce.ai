import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { filterFromQuery } from '@builderforce/interaction-contract';
import type { AdminVisitorFlow } from '@/lib/adminApi';
import { FlowView, flowStepInsightsHref } from './FlowView';

/**
 * Selecting a step on the flow graph shows its numbers and, when the step is
 * a path, links to the Insights app filtered to sessions that visited it
 * (PRD 33 S5) — recordings are never shown in Admin (D17).
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

function nodeButton(container: HTMLElement, label: string): Element {
  const match = [...container.querySelectorAll('g[role="button"]')].find((node) => node.querySelector('title')?.textContent?.includes(label));
  if (!match) throw new Error(`no node for ${label}`);
  return match;
}

describe('FlowView step detail', () => {
  it('shows the selected step and a link to its recordings in the Insights app', () => {
    const { container } = render(<FlowView data={data} loading={false} error="" onOpenVisitor={() => {}} />);
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

  it('offers no recordings link for a step that is not a path', () => {
    const { container } = render(<FlowView data={data} loading={false} error="" onOpenVisitor={() => {}} />);
    fireEvent.click(nodeButton(container, 'admin.visitorFlow.kind.exit'));
    expect(screen.getByRole('region', { name: 'admin.insights.nodeStripAria __exit__' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'admin.insights.watchStep' })).toBeNull();
  });
});
