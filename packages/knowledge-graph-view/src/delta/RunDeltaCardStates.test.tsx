// @vitest-environment jsdom
/** The run delta card's states (PRD 41 §C11.1, §12.5): measuring / not measured, held with "Release run", released, refused; the panel's ignored overrides. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { RunDeltaCard } from './RunDeltaCard';
import { RunDeltaPanel } from './RunDeltaPanel';
import { RunDeltaStatusCard } from './RunDeltaStatusCard';
import { DEFAULT_RUN_DELTA_LABELS, runDeltaLabels } from './labels';
import { overrideLabel } from './deltaText';
import { worseDelta } from './fixtures';

const L = DEFAULT_RUN_DELTA_LABELS;

describe('RunDeltaStatusCard', () => {
    it('shows "Measuring…" while the delta computes, and not measured when it never came', () => {
        const pending = render(<RunDeltaStatusCard status="pending" runId="r1" labels={L} />);
        expect(pending.getByRole('status').textContent).toBe(L.pendingCard);
        expect(pending.container.querySelector('[aria-busy="true"]')).toBeTruthy();
        pending.unmount();
        const failed = render(<RunDeltaStatusCard status="failed" runId="r1" labels={L} />);
        expect(failed.getByRole('status').textContent).toBe(L.failedCard);
        expect(failed.container.querySelector('[aria-busy="true"]')).toBeNull();
    });

    it('reads its words from the catalog', () => {
        const labels = runDeltaLabels((key) => (key === 'pendingCard' ? 'Messe …' : undefined));
        expect(render(<RunDeltaStatusCard status="pending" runId="r1" labels={labels} />).getByRole('status').textContent).toBe('Messe …');
    });
});

describe('a held run on its card', () => {
    it('names the blocking rules through their labels and offers "Release run"', () => {
        const onRelease = vi.fn();
        const { getByText, getByTestId } = render(
            <RunDeltaCard delta={worseDelta()} labels={L} onOpenDetails={() => {}} held={{ rules: ['guard-removed', 'not-comparable:secret-added'], onRelease }} />,
        );
        expect(getByText(L.held)).toBeTruthy();
        const rules = getByTestId('run-delta-held-rules').textContent!;
        expect(rules).toContain(L.rules.guardRemoved!);
        expect(rules).toContain('Secret added to code could not be certified');
        expect(rules).not.toContain('guard-removed');
        fireEvent.click(getByText(L.releaseRun));
        expect(onRelease).toHaveBeenCalledTimes(1);
    });

    it('shows the refusal, disables the button while releasing, and shows "Released by you" without a button once released', () => {
        const refused = render(<RunDeltaCard delta={worseDelta()} labels={L} onOpenDetails={() => {}} held={{ rules: ['guard-removed'], onRelease: () => {}, refused: true, releasing: true }} />);
        expect(refused.getByRole('alert').textContent).toBe(L.releaseRefused);
        expect((refused.getByText(L.releaseRun) as HTMLButtonElement).disabled).toBe(true);
        refused.unmount();
        const released = render(<RunDeltaCard delta={worseDelta()} labels={L} onOpenDetails={() => {}} held={{ rules: ['guard-removed'], released: true, onRelease: () => {} }} />);
        expect(released.getByText(L.released)).toBeTruthy();
        expect(released.queryByText(L.releaseRun)).toBeNull();
        expect(released.queryByText(L.held)).toBeNull();
    });

    it('shows no hold for a card that held nothing', () => {
        const { queryByText } = render(<RunDeltaCard delta={worseDelta()} labels={L} onOpenDetails={() => {}} />);
        expect(queryByText(L.held)).toBeNull();
        expect(queryByText(L.releaseRun)).toBeNull();
    });
});

describe('ignored overrides in the panel', () => {
    it('lists each dropped override under "Overrides ignored", unsafe patterns with their reason label', () => {
        const overrides = {
            dropped: [
                { code: 'unsafe-regex' as const, section: 'io', reason: 'nested-quantifier' },
                { code: 'unknown-key' as const, section: 'guardz' },
                { code: 'invalid-json' as const, section: '' },
                { code: 'unreadable' as const, section: '', reason: 'git-unavailable' },
                { code: 'truncated' as const, section: '', count: 3 },
            ],
        };
        const { container, getByText } = render(
            <RunDeltaPanel open delta={worseDelta()} overrides={overrides} labels={L} onClose={() => {}} compact={false} />,
        );
        expect(getByText(L.overridesHeading)).toBeTruthy();
        const items = [...container.querySelectorAll('[data-override]')].map((li) => li.textContent);
        expect(items).toEqual([
            'io: unsafe pattern dropped (nested quantifier)',
            'Unknown setting “guardz”',
            L.overrides.invalidJson,
            'The policy file could not be read (Git unavailable)',
            '3 more not shown',
        ]);
    });

    it('labels an unsafe pattern without a reason (an older record) and drops nothing silently', () => {
        expect(overrideLabel(L, { code: 'unsafe-regex', section: 'weakCrypto' })).toBe('Unsafe pattern in “weakCrypto”');
        expect(overrideLabel(L, { code: 'unreadable', section: '' })).toBe('The policy file could not be read');
    });

    it('has no section when nothing was dropped', () => {
        const { queryByText } = render(<RunDeltaPanel open delta={worseDelta()} labels={L} onClose={() => {}} compact={false} />);
        expect(queryByText(L.overridesHeading)).toBeNull();
    });
});
