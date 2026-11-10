// @vitest-environment jsdom
/** The run delta card and panel (PRD 41 §C11): localized words from codes, ≈ for heuristic, reasons for unmeasured rows, grouping, text-only snippets. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, within } from '@testing-library/react';
import { RunDeltaCard } from './RunDeltaCard';
import { RunDeltaPanel } from './RunDeltaPanel';
import { DEFAULT_RUN_DELTA_LABELS, runDeltaLabels, type RunDeltaLabels } from './labels';
import { headlineText, quantizedValue, reasonLabel } from './deltaText';
import { SCRIPT_SNIPPET, worseDelta } from './fixtures';

const L = DEFAULT_RUN_DELTA_LABELS;

/** A catalog that is not English: proves every word on the card comes from the labels, not from the data. */
const GERMAN: RunDeltaLabels = runDeltaLabels((key) => ({
    'verdicts.worse': 'Schlechter',
    'dimensions.security': 'Sicherheit',
    'dimensions.quality': 'Qualität',
    'rules.guardRemoved': 'Route hat ihren Auth-Guard verloren',
    'reasons.testsWeakened': 'Tests abgeschwächt',
    'headline.unchanged': 'Unverändert: {dimensions}.',
    'dimensions.performance': 'Leistung',
} as Record<string, string>)[key]);

describe('RunDeltaCard', () => {
    it('renders a worse security / tests-weakened run with localized words and ≈ for heuristic', () => {
        const { getByTestId, container } = render(<RunDeltaCard delta={worseDelta()} labels={GERMAN} onOpenDetails={() => {}} />);
        const headline = getByTestId('run-delta-headline').textContent!;
        expect(headline).toContain('Schlechter');
        expect(headline).toContain('Sicherheit (1 × Route hat ihren Auth-Guard verloren)');
        expect(headline).toContain('Qualität (1 × Tests abgeschwächt)');
        expect(headline).toContain('Unverändert: Leistung.');
        expect(headline).not.toContain('guard-removed');
        const security = container.querySelector('[data-dimension="security"]') as HTMLElement;
        expect(within(security).getByText('Schlechter')).toBeTruthy();
        expect(within(security).getByLabelText(L.heuristicHint).textContent).toBe('≈');
        expect(within(security).getByText('1 new')).toBeTruthy();
        // The verdict is never colour alone: word and icon are both drawn.
        expect(security.querySelector('[data-verdict="worse"] svg')).toBeTruthy();
    });

    it('shows why a not_measured row was not measured', () => {
        const { container } = render(<RunDeltaCard delta={worseDelta()} labels={L} onOpenDetails={() => {}} />);
        const row = container.querySelector('[data-dimension="ilities.reliability"]') as HTMLElement;
        expect(within(row).getByText(L.verdicts.notMeasured)).toBeTruthy();
        expect(within(row).getByText(L.reasons.ruleNotBuilt!)).toBeTruthy();
        expect(within(container.querySelector('[data-dimension="performance"]') as HTMLElement).getByText(L.reasons.staticOnly!)).toBeTruthy();
    });

    it('shows the blast radius band and opens details', () => {
        const open = vi.fn();
        const { getByText } = render(<RunDeltaCard delta={worseDelta()} labels={L} onOpenDetails={open} />);
        expect(getByText('Blast radius: high')).toBeTruthy();
        expect(getByText(L.reasons.insufficientHistory!)).toBeTruthy();
        fireEvent.click(getByText(L.openDetails));
        expect(open).toHaveBeenCalledOnce();
    });
});

describe('RunDeltaPanel', () => {
    const renderPanel = (onOpenCode = vi.fn()) => ({ onOpenCode, ...render(
        <RunDeltaPanel open delta={worseDelta()} labels={L} onClose={() => {}} onOpenCode={onOpenCode} compact={false} />,
    ) });

    it('is a non-modal side sheet', () => {
        const { getByRole } = renderPanel();
        expect(getByRole('dialog').getAttribute('aria-modal')).toBe('false');
    });

    it('groups findings by dimension, then by lineage', () => {
        const { container } = renderPanel();
        const order = [...container.querySelectorAll('section[data-dimension]')].map((s) => s.getAttribute('data-dimension'));
        expect(order).toEqual(['ilities.reliability', 'performance', 'quality', 'security']);
        const quality = container.querySelector('section[data-dimension="quality"]')!;
        const groups = [...quality.querySelectorAll('[data-lineage]')].map((g) => g.getAttribute('data-lineage'));
        expect(groups).toEqual(['introduced', 'resolved', 'persisting']);
        expect(quality.querySelector('[data-lineage="resolved"] [data-rule="assertions-reduced"]')).toBeTruthy();
        expect(within(quality as HTMLElement).getByText(L.lineages.introduced)).toBeTruthy();
        // A present-now finding is its own last group and is never counted as new.
        const security = container.querySelector('section[data-dimension="security"]')!;
        expect([...security.querySelectorAll('[data-lineage]')].map((g) => g.getAttribute('data-lineage'))).toEqual(['introduced', 'present']);
        expect(within(security as HTMLElement).getByText(L.lineages.present)).toBeTruthy();
    });

    it('renders a snippet containing <script> as text, never as HTML', () => {
        const { container } = renderPanel();
        expect(container.querySelector('script')).toBeNull();
        const pre = [...container.querySelectorAll('pre')].find((p) => p.textContent === SCRIPT_SNIPPET);
        expect(pre).toBeTruthy();
        expect(pre!.innerHTML).toContain('&lt;script&gt;');
    });

    it('shows params, severity, ≈ and metric values divided by their step', () => {
        const { container, getByText } = renderPanel();
        const guard = container.querySelector('[data-rule="guard-removed"]') as HTMLElement;
        expect(within(guard).getByText('POST /api/x', { selector: 'dd' })).toBeTruthy();
        expect(within(guard).getByText(L.severities.error)).toBeTruthy();
        expect(within(guard).getByLabelText(L.heuristicHint)).toBeTruthy();
        expect(getByText('3 → 7.25 cyclomatic')).toBeTruthy();
        expect(getByText(/Binary file/)).toBeTruthy();
    });

    it('emits Open code for an after-side location only', () => {
        const { container, onOpenCode } = renderPanel();
        const guard = container.querySelector('[data-rule="guard-removed"]') as HTMLElement;
        fireEvent.click(within(guard).getByText('src/routes.ts:12'));
        expect(onOpenCode).toHaveBeenCalledWith({ path: 'src/routes.ts', line: 12 });
        // The before side is an old revision: shown, never offered as openable.
        expect(within(guard).getByText('src/routes.ts:10').tagName).toBe('CODE');
        fireEvent.click(within(guard).getByText(L.openCode));
        expect(onOpenCode).toHaveBeenLastCalledWith({ path: 'src/routes.ts', line: 12 });
    });
});

describe('delta text', () => {
    it('fills tool reasons, keeps an unknown code readable and quantizes without float noise', () => {
        expect(reasonLabel(L, 'tool-missing:knip')).toBe('knip missing on one side');
        expect(reasonLabel(L, 'some-new-reason')).toBe('some-new-reason');
        expect(quantizedValue(725, 0.01)).toBe('7.25');
        expect(quantizedValue(3, 1)).toBe('3');
        expect(quantizedValue(1250, 0.001)).toBe('1.25');
    });

    it('reads a same-verdict run as one word, without repeating its unchanged list', () => {
        const delta = worseDelta();
        expect(headlineText(L, { verdict: 'same', clauses: [], unchanged: ['performance', 'security'], notMeasured: [] })).toBe('Unchanged.');
        expect(headlineText(L, { ...delta.summary, clauses: [{ dimension: 'performance', verdict: 'worse', code: 'metric:complexity.max', count: 1 }] }))
            .toContain('Performance (1 × Highest complexity regressed)');
    });
});
