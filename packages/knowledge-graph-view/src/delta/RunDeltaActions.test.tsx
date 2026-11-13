// @vitest-environment jsdom
/** The run delta actions (PRD 41 §C11): the Resolve and Copy diagnostics icon buttons render only
 * when their callback is passed, fire it on click, carry <svg> icons, and take every word from the
 * labels; plus the two pure text builders (diagnostics + fix directive) the hosts wire to them. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { RunDeltaCard } from './RunDeltaCard';
import { RunDeltaPanel } from './RunDeltaPanel';
import { resolveDirectiveText, runDeltaDiagnosticsText } from './deltaActionsText';
import { DEFAULT_RUN_DELTA_LABELS, runDeltaLabels, type RunDeltaLabels } from './labels';
import { worseDelta } from './fixtures';

const L = DEFAULT_RUN_DELTA_LABELS;

/** A catalog that is not English: proves the buttons' aria-labels come from the labels, not the data. */
const GERMAN_ACTIONS: RunDeltaLabels = runDeltaLabels((key) => ({
    'resolve': 'Beheben',
    'resolveHint': 'Die Probleme dieses Runs beheben',
    'copyDiagnostics': 'Diagnostik kopieren',
    'copied': 'Kopiert',
    'copyFailed': 'Kopieren fehlgeschlagen',
} as Record<string, string>)[key]);

describe('run delta action buttons', () => {
    it('renders Resolve and Copy diagnostics only when their callbacks are passed, with svg icons', () => {
        const onResolve = vi.fn();
        const onCopy = vi.fn();
        const { getByRole, queryByRole, rerender } = render(
            <RunDeltaCard delta={worseDelta()} labels={L} onOpenDetails={() => {}} onResolve={onResolve} onCopyDiagnostics={onCopy} />,
        );
        const resolveButton = getByRole('button', { name: L.resolve });
        const copyButton = getByRole('button', { name: L.copyDiagnostics });
        expect(resolveButton.querySelector('svg')).toBeTruthy();
        expect(copyButton.querySelector('svg')).toBeTruthy();
        expect(resolveButton.getAttribute('title')).toBe(L.resolveHint);
        expect(copyButton.getAttribute('title')).toBe(L.copyDiagnostics);
        fireEvent.click(resolveButton);
        fireEvent.click(copyButton);
        expect(onResolve).toHaveBeenCalledOnce();
        expect(onCopy).toHaveBeenCalledOnce();

        // Absent callbacks ⇒ absent buttons; everything else still renders.
        rerender(<RunDeltaCard delta={worseDelta()} labels={L} onOpenDetails={() => {}} />);
        expect(queryByRole('button', { name: L.resolve })).toBeNull();
        expect(queryByRole('button', { name: L.copyDiagnostics })).toBeNull();
    });

    it('takes the aria-labels from the labels catalog (German)', () => {
        const { getByRole, getByTitle } = render(
            <RunDeltaCard delta={worseDelta()} labels={GERMAN_ACTIONS} onOpenDetails={() => {}} onResolve={() => {}} onCopyDiagnostics={() => {}} />,
        );
        const resolveButton = getByRole('button', { name: 'Beheben' });
        const copyButton = getByRole('button', { name: 'Diagnostik kopieren' });
        expect(resolveButton.querySelector('svg')).toBeTruthy();
        expect(copyButton.querySelector('svg')).toBeTruthy();
        expect(getByTitle('Die Probleme dieses Runs beheben')).toBeTruthy();
    });

    it('renders the same two buttons at the top of the panel body', () => {
        const onResolve = vi.fn();
        const onCopy = vi.fn();
        const { getByRole, queryByRole, rerender } = render(
            <RunDeltaPanel open delta={worseDelta()} labels={L} onClose={() => {}} compact={false} onResolve={onResolve} onCopyDiagnostics={onCopy} />,
        );
        fireEvent.click(getByRole('button', { name: L.resolve }));
        fireEvent.click(getByRole('button', { name: L.copyDiagnostics }));
        expect(onResolve).toHaveBeenCalledOnce();
        expect(onCopy).toHaveBeenCalledOnce();

        rerender(<RunDeltaPanel open delta={worseDelta()} labels={L} onClose={() => {}} compact={false} />);
        expect(queryByRole('button', { name: L.resolve })).toBeNull();
        expect(queryByRole('button', { name: L.copyDiagnostics })).toBeNull();
    });
});

describe('runDeltaDiagnosticsText', () => {
    it('contains the headline, a finding rule label and evidence path, and the supplied time', () => {
        const delta = worseDelta();
        const time = '2026-11-13T05:00:00.000Z';
        const text = runDeltaDiagnosticsText(L, delta, time);
        expect(text).toContain('Run delta diagnostics');
        expect(text).toContain(`run: ${delta.runId}`);
        expect(text).toContain('Worse');
        expect(text).toContain(L.rules.guardRemoved!);
        expect(text).toContain('src/routes.ts:12');
        expect(text).toContain(`time: ${time}`);
    });
});

describe('resolveDirectiveText', () => {
    it('names the run and the introduced finding, and never lists persisting/present findings', () => {
        const delta = worseDelta();
        const text = resolveDirectiveText(L, delta);
        expect(text).toContain(`Run ${delta.runId}`);
        expect(text).toContain(L.rules.guardRemoved!);
        expect(text).toContain('src/routes.ts:12');
        // Context, not work: resolved, persisting and present findings are never directives.
        expect(text).not.toContain(L.rules.assertionsReduced!);
        expect(text).not.toContain('only-added');
        expect(text).not.toContain('weak-crypto');
    });
});
