// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { CameraBar } from './CameraBar';
import type { CameraDef } from './registry';

const cameras = ['transit', 'heat'].map((id) => ({ id, labelKey: 'viewModesLabel', placement: {} })) as unknown as CameraDef[];
const group = () => screen.queryByRole('group', { name: L.surface.scene.flatToggle });
const dim = (id: '3d' | 'flat') => screen.getByTestId(`kg-dim-${id}`);

describe('the 3D | Flat pair in the camera bar (PRD 43 C4)', () => {
    it('is hidden without onFlat', () => {
        render(<CameraBar labels={L} cameras={cameras} mode="transit" onMode={vi.fn()} />);
        expect(group()).toBeNull();
    });

    it('is two labelled buttons, the state it is in pressed, each asking for itself', () => {
        const onFlat = vi.fn();
        const { rerender } = render(<CameraBar labels={L} cameras={cameras} mode="transit" onMode={vi.fn()} flat={false} onFlat={onFlat} />);
        expect(dim('3d').getAttribute('aria-pressed')).toBe('true');
        expect(dim('flat').getAttribute('aria-pressed')).toBe('false');
        expect(dim('3d').textContent).toBe(L.surface.scene.view3d);
        expect(dim('flat').textContent).toBe(L.surface.scene.viewFlat);
        fireEvent.click(dim('flat'));
        expect(onFlat).toHaveBeenLastCalledWith(true);
        rerender(<CameraBar labels={L} cameras={cameras} mode="heat" onMode={vi.fn()} flat onFlat={onFlat} />);
        expect(dim('flat').getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(dim('3d'));
        expect(onFlat).toHaveBeenLastCalledWith(false);
    });

    it('is hidden on a DOM camera (the List), where it does nothing', () => {
        const dom = [...cameras, { id: 'list', labelKey: 'viewModesLabel', component: () => null }] as unknown as CameraDef[];
        render(<CameraBar labels={L} cameras={dom} mode={'list' as never} onMode={vi.fn()} flat onFlat={vi.fn()} />);
        expect(group()).toBeNull();
    });
});
