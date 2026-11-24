/**
 * The Code button on a selected mark: it shows for a mark on the stage, not for no mark or a mark that left the
 * stage, and a press opens the code.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../labels';
import { StageBus, StageBusContext } from '../anchor/stageBus';
import type { Placement } from '../types';
import { MarkCodeButton } from './MarkCodeButton';

function busWith(keys: string[]): StageBus {
    const bus = new StageBus();
    const placement = { position: new Float32Array(keys.length * 3), scale: new Float32Array(keys.map(() => 1)), links: [] } as unknown as Placement;
    bus.setPlacement(placement, keys);
    return bus;
}

function mount(slotKey: string | null, onCode = vi.fn()) {
    render(
        <StageBusContext.Provider value={busWith(['node:a', 'st:b'])}>
            <MarkCodeButton slotKey={slotKey} name="parse" labels={L} onCode={onCode} />
        </StageBusContext.Provider>,
    );
    return onCode;
}

describe('MarkCodeButton', () => {
    it('shows for a selected mark on the stage and opens the code', () => {
        const onCode = mount('node:a');
        const button = screen.getByRole('button', { name: fillTemplate(L.surface.code.buttonAria, { name: 'parse' }) });
        expect(button.textContent).toBe(L.surface.code.button);
        fireEvent.click(button);
        expect(onCode).toHaveBeenCalledTimes(1);
    });

    it('shows nothing with no mark', () => {
        mount(null);
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('shows nothing for a mark that is not on the stage', () => {
        mount('node:gone');
        expect(screen.queryByRole('button')).toBeNull();
    });
});
