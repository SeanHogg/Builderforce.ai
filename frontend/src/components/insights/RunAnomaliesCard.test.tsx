import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { RunAnomaliesCard } from './RunAnomaliesCard';
import { runAnomalyApi, type RunAnomalyInsights } from '@/lib/runAnomalyApi';

import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import de from '@/i18n/messages/de.json';

/**
 * Run anomalies card (AI Effectiveness lens). Pins what makes it an insight rather
 * than a record dump: one row per REASON, the honest "not enough history" line, ≈ on a
 * sampled window, and that it follows the lens's window and project scope.
 * Copy is the passthrough key under the global next-intl mock (src/test/setup.ts).
 */

function insights(over: Partial<RunAnomalyInsights> = {}): RunAnomalyInsights {
  return {
    windowDays: 30,
    sampled: false,
    runs: 40,
    scored: 35,
    flagged: 3,
    minRuns: 5,
    issues: [
      {
        metric: 'cost',
        runs: 2,
        sharePct: 5.7,
        excessCostUsd: 12.5,
        examples: [{ executionId: 9, taskId: 41, model: 'anthropic/claude-sonnet-4', at: '2026-10-01T00:00:00.000Z', value: 7, typical: 0.5, score: 3.2 }],
      },
      {
        metric: 'toolFailures',
        runs: 1,
        sharePct: 2.9,
        excessCostUsd: 0,
        examples: [{ executionId: 12, taskId: null, model: 'openai/gpt-5', at: '2026-10-02T00:00:00.000Z', value: 6, typical: 0, score: 1.6 }],
      },
    ],
    ...over,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('RunAnomaliesCard', () => {
  it('reads the lens window and project scope', async () => {
    const read = vi.spyOn(runAnomalyApi, 'get').mockResolvedValue(insights());
    render(<RunAnomaliesCard days={14} projectId={7} />);
    await waitFor(() => expect(read).toHaveBeenCalledWith(14, 7));
  });

  it('renders one row per reason, with what to check and the worst run', async () => {
    vi.spyOn(runAnomalyApi, 'get').mockResolvedValue(insights());
    const { container } = render(<RunAnomaliesCard days={30} projectId={null} />);
    await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(2));
    const text = container.textContent ?? '';
    expect(text).toContain('insights.eng.anomaly.metric.cost');
    expect(text).toContain('insights.eng.anomaly.hint.cost');
    expect(text).toContain('insights.eng.anomaly.metric.toolFailures');
    expect(text).toMatch(/insights\.eng\.anomaly\.example .*anthropic\/claude-sonnet-4/);
    expect(text).toMatch(/insights\.eng\.anomaly\.exampleTask 41/);
    expect(text).toMatch(/insights\.eng\.anomaly\.summary 3 35/);
  });

  it('says honestly when there is not enough history, instead of an empty table', async () => {
    vi.spyOn(runAnomalyApi, 'get').mockResolvedValue(insights({ scored: 0, flagged: 0, issues: [] }));
    const { container } = render(<RunAnomaliesCard days={30} projectId={null} />);
    await waitFor(() => expect(container.textContent).toMatch(/insights\.eng\.anomaly\.notEnough 5/));
    expect(container.querySelector('table')).toBeNull();
  });

  it('marks a sampled window as an estimate', async () => {
    vi.spyOn(runAnomalyApi, 'get').mockResolvedValue(insights({ sampled: true }));
    const { container } = render(<RunAnomaliesCard days={30} projectId={null} />);
    await waitFor(() => expect(container.textContent).toContain('insights.eng.anomaly.summarySampled'));
    expect(container.textContent).toContain('≈');
  });
});

describe('localization', () => {
  const catalogs = { en, zh, es, fr, de } as unknown as Record<string, Record<string, unknown>>;
  const get = (root: unknown, path: string): unknown =>
    path.split('.').reduce<unknown>((at, k) => (at == null ? at : (at as Record<string, unknown>)[k]), root);

  const required = [
    'title', 'summary', 'summarySampled', 'notEnough', 'none',
    'colIssue', 'colRuns', 'colShare', 'colExcess', 'colWorst',
    'metric.cost', 'metric.duration', 'metric.toolFailures',
    'hint.cost', 'hint.duration', 'hint.toolFailures',
    'example', 'exampleTask',
  ].map((k) => `insights.eng.anomaly.${k}`);

  for (const [locale, catalog] of Object.entries(catalogs)) {
    it(`${locale} carries every run-anomaly key, translated`, () => {
      for (const key of required) {
        const value = get(catalog, key);
        expect(typeof value, `${locale}.${key}`).toBe('string');
        expect(value, `${locale}.${key}`).toBeTruthy();
        if (locale !== 'en') expect(value, `${locale}.${key}`).not.toBe(get(catalogs.en, key));
      }
    });
  }
});
