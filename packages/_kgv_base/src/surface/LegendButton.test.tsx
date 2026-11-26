// @vitest-environment jsdom
/** The Legend button: an accessible icon that opens the full key — every mark type, its name and meaning — and closes on Escape. */
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { MARK_TYPE_ORDER, typeLegendKey } from '../shapes';
import { LegendButton } from './LegendButton';

describe('LegendButton', () => {
    it('has an accessible name, opens a dialog listing every mark type, and closes on Escape', () => {
        const { getByRole, queryByRole } = render(<LegendButton labels={L} present={['test', 'class']} preset="risk" />);
        const button = getByRole('button', { name: L.legend.keyButton });
        expect(button.getAttribute('aria-expanded')).toBe('false');

        fireEvent.click(button);
        const dialog = getByRole('dialog', { name: L.legendLabel });
        expect(button.getAttribute('aria-expanded')).toBe('true');
        const rows = [...dialog.querySelectorAll('[data-type]')];
        expect(rows).toHaveLength(MARK_TYPE_ORDER.length);
        // The types on screen come first, in legend order, and are tagged.
        expect(rows.slice(0, 2).map((r) => r.getAttribute('data-type'))).toEqual(['class', 'test']);
        expect(rows.filter((r) => r.getAttribute('data-present') === 'true')).toHaveLength(2);
        for (const t of MARK_TYPE_ORDER) {
            const row = dialog.querySelector(`[data-type="${t}"]`)!;
            expect(row.textContent).toContain(L.legend[typeLegendKey(t)]);
            expect(row.textContent).toContain(L.legend[`${typeLegendKey(t)}Meaning`]);
        }
        expect(dialog.textContent).toContain(L.legend.lineUntested);
        expect(dialog.textContent).toContain(L.surface.presets.risk);
        expect(dialog.contains(document.activeElement)).toBe(true);

        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(button);
    });
});
