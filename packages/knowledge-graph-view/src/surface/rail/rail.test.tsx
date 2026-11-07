// @vitest-environment jsdom
/** The left rail's rows: the line row's second line and dead-end count, and the stop row's dot and right-hand tag. */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { findingTitle } from '../../findingText';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../labels';
import { LinesPanel } from '../LinesPanel';
import type { Station, StationModel } from '../stations';
import { graph, lines, model, overlay } from '../testFixtures';
import { firstFindings, stopTag } from './stopTag';

const base = { lines, stations: model, overlay, labels: L, lineId: lines.lines[0]!.id, selectedStation: null, onSelectLine: vi.fn(), onSelectStation: vi.fn() };
const station = (name: string) => model.stations.find((s) => s.name === name)!;
const row = (name: string) => document.querySelector(`[data-station-row="${station(name).id}"]`) as HTMLElement;
const withStations = (change: (s: Station) => Station): StationModel => {
    const stations = model.stations.map(change);
    return { ...model, stations, byId: new Map(stations.map((s) => [s.id, s] as const)) };
};

describe('rail line row', () => {
    it('names the line, then "{stations} · {files} · where it ends", with plurals', () => {
        render(<LinesPanel {...base} />);
        const [main, cron] = [...document.querySelectorAll('[data-line]')] as HTMLElement[];
        expect(within(main!).getByText('4 stations · 5 files · Data store')).toBeTruthy();
        expect(within(cron!).getByText('3 stations · 4 files · Data store')).toBeTruthy();
        expect(main!.textContent).not.toMatch(/\b1 (files|stations)\b/);
    });

    it('counts a dead end in red, and says 0 dead ends (muted) for a line that ends in a store', () => {
        const [first, second] = lines.lines;
        const ends = { ...lines, lines: [{ ...first!, terminus: { kind: 'end' as const, stationId: first!.stops[1]!, provenance: 'heuristic' as const } }, second!] };
        render(<LinesPanel {...base} lines={ends} />);
        const dead = [...document.querySelectorAll('[data-dead-ends]')] as HTMLElement[];
        expect(dead.map((d) => d.textContent)).toEqual(['1 dead end', '0 dead ends']);
        expect(dead[0]!.style.color).toContain('--kg-violation');
        expect(dead[1]!.style.color).not.toContain('--kg-violation');
    });
});

describe('rail stop row', () => {
    it('fills the dot from the colour channel and borders it in the line colour', () => {
        render(<LinesPanel {...base} />);
        const dot = row('API').querySelector('[data-dot]') as HTMLElement;
        expect(dot.style.background).toContain(`--kg-sev-${overlay.style(station('API')).tone.slice(-1)}`);
        expect(dot.style.border).toContain('--kg-line-1');
    });

    it('tags a stop with its first finding by place in the list, else its coverage, else nothing, and never a file count', () => {
        render(<LinesPanel {...base} findings={graph.findings} />);
        const tag = (name: string) => row(name).querySelector('[data-tag]')?.textContent;
        expect(tag('API')).toBe(fillTemplate(L.surface.rail.pinTag, { n: 1, title: findingTitle({ kind: 'partition-violation' }, L) }));
        expect(tag('repositories')).toBe(fillTemplate(L.surface.rail.pinTag, { n: 2, title: findingTitle({ kind: 'clone-group' }, L) }));
        expect(tag('Web app')).toBeUndefined();
        expect(row('Web app').textContent).toBe('Web app');
    });

    it('shows the measured coverage as a percentage without the findings list', () => {
        render(<LinesPanel {...base} />);
        expect(row('API').querySelector('[data-tag]')!.textContent).toBe('80%');
        expect(row('repositories').querySelector('[data-tag]')!.textContent).toBe('20%');
    });

    it('says "reached", not "covered", when the number is a static reach', () => {
        render(<LinesPanel {...base} stations={withStations((s) => ({ ...s, covProvenance: 'heuristic' }))} />);
        expect(row('API').querySelector('[data-tag="reached"]')!.textContent).toBe(fillTemplate(L.surface.rail.reachedTag, { percent: 80 }));
    });
});

describe('stopTag', () => {
    it('is null for a station with neither a finding nor coverage', () => {
        expect(stopTag(station('cron'), undefined, L)).toBeNull();
    });

    it('numbers the first finding of a station by its place in the list given', () => {
        const first = firstFindings([station('API')], [...graph.findings].reverse()).get(station('API').id)!;
        expect(first.n).toBe(1);
        expect(first.finding.kind).toBe('clone-group');
    });
});
