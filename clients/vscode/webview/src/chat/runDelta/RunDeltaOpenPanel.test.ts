/**
 * The chat's open run delta panel — what `useRunDeltaCards` renders on "Open details" — carries the repository's history
 * and trend under the panel body through `renderPanel` (PRD 41 §C11.3). Static markup: the suite has no DOM.
 *
 * This file is NAMED `RunDeltaOpenPanel.test.ts` (PascalCase, matching its subject) but was previously
 * `runDeltaOpenPanel.test.ts` (camelCase). On a case-insensitive filesystem the two names are the same
 * file, and the verify harness's changed-file targeting passes BOTH spellings as filters — vitest then
 * matches the file twice and, with two positional filters resolving to one file, fails to collect it
 * ("No test files found" on one collapsed filter), refusing the push. One spelling only keeps the
 * targeting deterministic.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'use-intl';
import { describe, expect, it, vi } from 'vitest';
import type { RunDelta } from '@builderforce/run-delta';
import { DEFAULT_RUN_DELTA_LABELS } from '@builderforce/knowledge-graph-view/delta';
import { RunDeltaOpenPanel } from './RunDeltaOpenPanel';

vi.mock('../../vscodeBridge', () => ({ request: vi.fn(() => new Promise(() => {})), onHostMessage: vi.fn(() => () => {}) }));

const delta = {
  version: 1, runId: 'r1', headline: 'same', digest: 'd', blocking: [], excluded: [],
  summary: { verdict: 'same', clauses: [], unchanged: [], notMeasured: [] },
  blastRadius: { score: 1, band: 'low', formula: 'v1', reasons: [] }, dimensions: [],
} as unknown as RunDelta;

describe('RunDeltaOpenPanel', () => {
  it('opens the panel with the repository history section under its body', () => {
    const labels = DEFAULT_RUN_DELTA_LABELS;
    const html = renderToStaticMarkup(createElement(IntlProvider, {
      locale: 'en',
      messages: { runDelta: {} },
      onError: () => {},
      children: createElement(RunDeltaOpenPanel, { card: { repo: '/work/repo', delta }, labels, compact: false, onClose: () => {} }),
    }));
    expect(html).toContain(`aria-label="${labels.panelTitle}"`);
    expect(html).toContain('data-run-delta-history-section');
    expect(html.indexOf('data-run-delta-history-section')).toBeGreaterThan(html.indexOf(labels.panelTitle));
  });

  it('carries the Resolve and Copy-diagnostics actions into the panel (PRD 41 §C11)', () => {
    const labels = DEFAULT_RUN_DELTA_LABELS;
    const html = renderToStaticMarkup(createElement(IntlProvider, {
      locale: 'en',
      messages: { runDelta: {} },
      onError: () => {},
      children: createElement(RunDeltaOpenPanel, {
        card: { repo: '/work/repo', delta },
        labels,
        compact: false,
        onClose: () => {},
        onResolve: () => {},
        onCopyDiagnostics: () => {},
      }),
    }));
    expect(html).toContain(`aria-label="${labels.resolve}"`);
    expect(html).toContain(`aria-label="${labels.copyDiagnostics}"`);
  });
});
