/**
 * The run delta panel carries the repository's history and trend (PRD 41 §C11.3): the editor mounts
 * `RunDeltaHistorySection` under the panel's body through the panel's `renderPanel` slot (`footerPanel`), exactly as
 * `useRunDeltaCards.tsx` does. Rendered to markup (the suite has no DOM): the first paint already holds the section.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'use-intl';
import { describe, expect, it, vi } from 'vitest';
import type { RunDelta } from '@builderforce/run-delta';
import { DEFAULT_RUN_DELTA_LABELS, RunDeltaPanel } from '@builderforce/knowledge-graph-view/delta';
import { footerPanel } from '@builderforce/knowledge-graph-view/delta/history';
import { RunDeltaHistorySection } from './RunDeltaHistorySection';

vi.mock('../../vscodeBridge', () => ({ request: vi.fn(() => new Promise(() => {})), onHostMessage: vi.fn(() => () => {}) }));

const delta = {
  version: 1, runId: 'r1', headline: 'same', digest: 'd', blocking: [], excluded: [],
  summary: { verdict: 'same', clauses: [], unchanged: [], notMeasured: [] },
  blastRadius: { score: 1, band: 'low', formula: 'v1', reasons: [] }, dimensions: [],
} as unknown as RunDelta;

describe('run delta panel in the editor', () => {
  it('renders the repository history section inside the open panel', () => {
    const labels = DEFAULT_RUN_DELTA_LABELS;
    const renderPanel = footerPanel(createElement(RunDeltaHistorySection, { repo: '/work/repo', labels }), { closeLabel: labels.close, compact: false, width: 440 });
    const html = renderToStaticMarkup(createElement(IntlProvider, {
      locale: 'en',
      messages: { runDelta: {} },
      onError: () => {},
      children: createElement(RunDeltaPanel, { open: true, delta, labels, onClose: () => {}, compact: false, renderPanel }),
    }));
    expect(html).toContain(labels.panelTitle);
    expect(html).toContain('data-run-delta-history-section');
    expect(html.indexOf('data-run-delta-history-section')).toBeGreaterThan(html.indexOf(labels.panelTitle));
  });
});
