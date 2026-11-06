// @vitest-environment jsdom
/** The shared drawer primitives: Unavailable, StateLabel, and the ProvenanceBadge that moved to surface/ui. */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../labels';
import { ProvenanceBadge } from '../ui';
import { StateLabel, Unavailable } from './ui';

describe('Unavailable', () => {
    it('says "not available here" with no label, and fills one template with a label', () => {
        const { rerender } = render(<Unavailable labels={L} testId="u" />);
        expect(screen.getByTestId('u').textContent).toBe(L.surface.unavailable.notHere);
        rerender(<Unavailable labels={L} label="Resend" testId="u" />);
        expect(screen.getByTestId('u').textContent).toBe(fillTemplate(L.surface.unavailable.labelled, { label: 'Resend' }));
    });
});

describe('StateLabel', () => {
    it('is the state in words, coloured by its tone, with the caller\'s data attributes', () => {
        render(<StateLabel tone="agrees" data-tested="true">Tested</StateLabel>);
        const el = screen.getByText('Tested');
        expect(el.getAttribute('data-tested')).toBe('true');
        expect(el.style.color).toContain('--kg-agrees');
    });
});

describe('ProvenanceBadge', () => {
    it('names the provenance in words', () => {
        render(<ProvenanceBadge provenance="runtime" labels={L} />);
        expect(screen.getByText(L.surface.provenance.runtime).getAttribute('data-provenance')).toBe('runtime');
    });
});
