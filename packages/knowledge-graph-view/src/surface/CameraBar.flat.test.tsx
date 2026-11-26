// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { CameraBar } from './CameraBar';
import type { CameraDef } from './registry';

const cameras = ['transit', 'heat'].map((id) => ({ id, labelKey: 'viewModesLabel', placement: {} })) as unknown as CameraDef[];
const toggle = () => screen.queryByRole('button', { name: L.surface.scene.flatToggle });

describe('the 3D / Flat switch in the camera bar (PRD 43 C4)', () => {
    it('is hidden without onFlat', () => {
        render(<CameraBar labels={L} cameras={cameras} mode="transit" onMode={vi.fn()} />);
        expect(toggle()).toBeNull();
    });

    it('shows the state it is in and asks for the other one', () => {
        const onFlat = vi.fn();
        const { rerender } = render(<CameraBar labels={L} cameras={cameras} mode="transit" onMode={vi.fn()} flat={false} onFlat={onFlat} />);
        expect(toggle()!.getAttribute('aria-pressed')).toBe('false');
        expect(toggle()!.textContent).toContain(L.surface.scene.view3d);
        fireEvent.click(toggle()!);
        expect(onFlat).toHaveBeenLastCalledWith(true);
        rerender(<CameraBar labels={L} cameras={cameras} mode="heat" onMode={vi.fn()} flat onFlat={onFlat} />);
        expect(toggle()!.getAttribute('aria-pressed')).toBe('true');
        expect(toggle()!.textContent).toContain(L.surface.scene.viewFlat);
        fireEvent.click(toggle()!);
        expect(onFlat).toHaveBeenLastCalledWith(false);
    });

    it('is hidden on a DOM camera (the List), where it does nothing', () => {
        const dom = [...cameras, { id: 'list', labelKey: 'viewModesLabel', component: () => null }] as unknown as CameraDef[];
        render(<CameraBar labels={L} cameras={dom} mode={'list' as never} onMode={vi.fn()} flat onFlat={vi.fn()} />);
        expect(toggle()).toBeNull();
    });

    it('is icon-only on a phone', () => {
        render(<CameraBar labels={L} cameras={cameras} mode="transit" onMode={vi.fn()} stacked flat onFlat={vi.fn()} />);
        expect(toggle()!.textContent).toBe('');
        expect(toggle()!.querySelector('svg')).toBeTruthy();
    });
});
