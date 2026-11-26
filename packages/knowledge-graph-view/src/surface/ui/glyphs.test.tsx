// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import { CameraBar } from '../CameraBar';
import type { CameraDef } from '../registry';
import { ACTION_GLYPHS, actionGlyph, cameraGlyph } from './glyphs';

describe('glyphs', () => {
    it.each(ACTION_GLYPHS)('draws the %s action glyph as a decorative currentColor svg', (name) => {
        const { container } = render(<>{actionGlyph(name)}</>);
        const svg = container.querySelector('svg')!;
        expect(svg.getAttribute('aria-hidden')).toBe('true');
        expect(svg.style.stroke).toBe('currentColor');
        expect(svg.querySelectorAll('path, rect, circle').length).toBeGreaterThan(0);
    });

    it('has a camera glyph per switcher camera and none for an unknown id', () => {
        for (const id of ['transit', 'system', 'graph', 'map', '3d', 'heat', 'style', 'features', 'list']) expect(cameraGlyph(id)).toBeTruthy();
        expect(cameraGlyph('nope')).toBeUndefined();
    });

    it('still draws the camera glyphs in the camera bar', () => {
        const cameras = ['transit', 'heat'].map((id) => ({ id, labelKey: 'viewModesLabel', placement: {} })) as unknown as CameraDef[];
        const { container } = render(<CameraBar labels={L} cameras={cameras} mode="transit" onMode={vi.fn()} />);
        expect(container.querySelectorAll('svg')).toHaveLength(2);
    });
});
