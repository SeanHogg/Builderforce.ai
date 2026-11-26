// @vitest-environment jsdom
/** The cameras' error boundary. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { SurfaceErrorBoundary } from './SurfaceErrorBoundary';

afterEach(() => { vi.restoreAllMocks(); });

function Boom({ when }: { when: boolean }): null {
    if (when) throw new Error('station lookup failed');
    return null;
}

describe('SurfaceErrorBoundary', () => {
    it('shows the localized line, the message and Try again, and logs the error', () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(<SurfaceErrorBoundary labels={L} resetKey="transit"><Boom when /></SurfaceErrorBoundary>);
        const alert = screen.getByRole('alert');
        expect(alert.textContent).toContain(L.surface.scene.errorTitle);
        expect(alert.textContent).toContain('station lookup failed');
        expect(screen.getByRole('button', { name: L.surface.scene.errorRetry })).toBeTruthy();
        expect(log.mock.calls.some((c) => String(c[0]).includes('knowledge-graph-view'))).toBe(true);
    });

    it('inside a drilled level offers Back, which leaves the level and draws again', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const onBack = vi.fn();
        let crash = true;
        function Child() { return <Boom when={crash} />; }
        render(<SurfaceErrorBoundary labels={L} resetKey="transit" onBack={() => { crash = false; onBack(); }}><Child /></SurfaceErrorBoundary>);
        fireEvent.click(screen.getByRole('button', { name: L.surface.scene.errorBack }));
        expect(onBack).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('resets when the camera, root or level changes', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { rerender } = render(<SurfaceErrorBoundary labels={L} resetKey="a"><Boom when /></SurfaceErrorBoundary>);
        expect(screen.getByRole('alert')).toBeTruthy();
        rerender(<SurfaceErrorBoundary labels={L} resetKey="b"><Boom when={false} /></SurfaceErrorBoundary>);
        expect(screen.queryByRole('alert')).toBeNull();
    });
});
