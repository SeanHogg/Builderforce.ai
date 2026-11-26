// @vitest-environment jsdom
/** The left rail and the legend glyphs. */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { LegendGlyph, type GlyphChannel } from './LegendGlyph';
import { LinesPanel } from './LinesPanel';
import { makeOverlay, PRESETS } from './overlays';
import { buildStations } from './stations';
import { graph, lines, model, overlay } from './testFixtures';

const base = { lines, stations: model, overlay, labels: L, lineId: lines.lines[0]!.id, selectedStation: null, onSelectLine: vi.fn(), onSelectStation: vi.fn() };

describe('LinesPanel rail', () => {
    it('is the 250px rail with the heading, and anchors the legend to the bottom', () => {
        render(<LinesPanel {...base} rail />);
        expect(screen.getByTestId('kg-lines-rail').style.width).toBe('250px');
        expect(screen.getByText(L.surface.rail.heading)).toBeTruthy();
        expect(screen.getByTestId('kg-surface-legend').style.marginTop).toBe('auto');
        expect(screen.getByText(L.surface.rail.legendHeading)).toBeTruthy();
    });

    it('has no rail chrome unless asked (a sheet or a stacked list wraps it)', () => {
        render(<LinesPanel {...base} />);
        expect(screen.getByTestId('kg-lines-rail').style.width).toBe('');
    });

    it('draws a glyph per bound channel plus the issue pins, and a not-set-up channel says so', () => {
        render(<LinesPanel {...base} stations={buildStations(graph)} overlay={makeOverlay(PRESETS.ownership, model.stations.map((s) => ({ ...s, owner: undefined })))} />);
        const legend = screen.getByTestId('kg-surface-legend');
        expect(legend.querySelectorAll('svg[data-glyph]').length).toBeGreaterThanOrEqual(5);
        expect(legend.querySelector('[data-channel="pins"]')).toBeTruthy();
        expect(legend.querySelector('[data-channel="colour"][data-status="not-set-up"]')!.textContent).toContain(L.surface.notSetUp);
    });

    it('shows a row for every line and the stops of the selected one', () => {
        render(<LinesPanel {...base} />);
        expect(document.querySelectorAll('[data-line]')).toHaveLength(lines.lines.length);
        expect(document.querySelectorAll('[data-station-row]')).toHaveLength(lines.lines[0]!.stops.length);
    });
});

describe('LegendGlyph', () => {
    const glyph = (channel: GlyphChannel, metric: Parameters<typeof LegendGlyph>[0]['metric'], status: Parameters<typeof LegendGlyph>[0]['status'] = 'ready') => {
        const { container } = render(<LegendGlyph channel={channel} metric={metric} status={status} />);
        return container.querySelector('svg')!;
    };

    it.each(['colour', 'size', 'ring', 'width', 'pulse', 'outline', 'pins'] as const)('draws a decorative %s glyph', (channel) => {
        const svg = glyph(channel, 'anti');
        expect(svg.getAttribute('data-glyph')).toBe(channel);
        expect(svg.getAttribute('aria-hidden')).toBe('true');
        expect(svg.childElementCount).toBeGreaterThan(0);
    });

    it('draws a five-step ramp for a severity metric and a swatch per owner for the owner metric', () => {
        expect(glyph('colour', 'anti').querySelectorAll('[data-swatch="ramp"]')).toHaveLength(5);
        document.body.innerHTML = '';
        expect(glyph('colour', 'owner').querySelectorAll('[data-swatch="owner"]')).toHaveLength(4);
    });

    it('draws the growing circles of the size channel and the thickening lines of the width channel', () => {
        expect([...glyph('size', 'cx').querySelectorAll('circle')].map((c) => Number(c.getAttribute('r')))).toEqual([3, 5, 7]);
        document.body.innerHTML = '';
        expect([...glyph('width', 'use').querySelectorAll('line')].map((l) => Number(l.getAttribute('stroke-width')))).toEqual([2, 4, 7]);
    });

    it('draws neutral where the data is not set up', () => {
        const colours = [...glyph('colour', 'anti', 'not-set-up').querySelectorAll('rect')].map((r) => r.getAttribute('fill'));
        expect(new Set(colours).size).toBe(1);
    });
});
