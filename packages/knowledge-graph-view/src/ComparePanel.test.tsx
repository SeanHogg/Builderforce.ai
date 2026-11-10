// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComparePanel } from './ComparePanel';
import { compareReasonText, reviewAgainFixes } from './compareReasons';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, resolveLabels } from './labels';
import { surfaceFixture } from './testing';

const graph = surfaceFixture();

describe('Compare: why before and after do not compare (PRD 41 §C9)', () => {
    it('reads every memory reason as a sentence; a pack reads as the pack, an unknown code as itself', () => {
        expect(compareReasonText(L, 'extractor-version-changed')).toBe(L.compareReasonExtractorVersion);
        expect(compareReasonText(L, 'tool-version-changed:knip')).toBe('knip changed version between the two reviews.');
        expect(compareReasonText(L, 'tool-missing:knip')).toBe('knip measured only one side.');
        expect(compareReasonText(L, 'tool-missing:pack:docs')).toBe('The Documents pack reviewed only one side.');
        expect(compareReasonText(L, 'analyzer-failed:jscpd')).toBe('jscpd failed on one side.');
        expect(compareReasonText(L, 'scope-changed')).toBe(L.compareReasonScope);
        expect(compareReasonText(L, 'measured-unknown')).toBe(L.compareReasonMeasuredUnknown);
        expect(compareReasonText(L, 'some-new-reason')).toBe('some-new-reason');
    });

    it('asks for a new review only when a version or tool drifted', () => {
        expect(reviewAgainFixes(['tool-version-changed:knip'])).toBe(true);
        expect(reviewAgainFixes(['extractor-version-changed'])).toBe(true);
        expect(reviewAgainFixes(['tool-missing:pack:docs'])).toBe(true);
        expect(reviewAgainFixes(['measured-unknown'])).toBe(true);
        expect(reviewAgainFixes(['scope-changed', 'truncated'])).toBe(false);
    });

    it('shows the localized reasons and the hint under the verdict', () => {
        const de = resolveLabels({ compareReasonToolVersion: '{tool} hat die Version gewechselt.', compareReviewAgain: 'Erneut prüfen, um zu vergleichen.' });
        render(<ComparePanel before={{ graph, comparable: false, reasons: ['tool-version-changed:knip'] }} after={graph} labels={de} />);
        expect(screen.getByText(L.compareIncomparable)).toBeTruthy();
        expect(screen.getByText('knip hat die Version gewechselt.')).toBeTruthy();
        expect(screen.getByText('Erneut prüfen, um zu vergleichen.')).toBeTruthy();
    });

    it('a comparable baseline shows no reasons', () => {
        render(<ComparePanel before={{ graph, comparable: true, reasons: [] }} after={graph} labels={L} />);
        expect(screen.queryByText(L.compareIncomparable)).toBeNull();
        expect(screen.queryByText(L.compareReviewAgain)).toBeNull();
    });
});
