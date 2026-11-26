import { describe, expect, it } from 'vitest';
import { codeFixture, surfaceFixture } from '../testing';
import { CHANNELS, frac, level5, makeOverlay, metricStatus, PRESETS, presetOf, segmentUntested, setChannel } from './overlays';
import { buildStations } from './stations';

const stations = buildStations(surfaceFixture()).stations;
const get = (name: string) => stations.find((s) => s.name === name)!;

describe('metrics', () => {
    it('reports a metric with no data as not set up', () => {
        const bare = buildStations(codeFixture()).stations;
        for (const m of ['cx', 'cov', 'churn', 'owner'] as const) expect(metricStatus(m, bare)).toBe('not-set-up');
        for (const m of ['anti', 'use', 'changed', 'none'] as const) expect(metricStatus(m, bare)).toBe('ready');
        for (const m of ['cx', 'cov', 'churn', 'owner'] as const) expect(metricStatus(m, stations)).toBe('ready');
    });

    it('reads levels and fractions as the design does, undefined without data', () => {
        const api = get('API'), web = get('Web app');
        expect(level5('anti', api)).toBe(4);
        expect(level5('cov', api)).toBe(2);
        expect(level5('cov', web)).toBeUndefined();
        expect(level5('use', api)).toBe(5);
        expect(level5('changed', api)).toBe(1);
        expect(frac('cov', api)).toBe(0.8);
        expect(frac('cov', web)).toBeUndefined();
        expect(frac('anti', api)).toBe(0.75);
        expect(frac('owner', api)).toBeUndefined();
    });
});

describe('presets and bindings', () => {
    it('has the four presets and recognises them, else custom', () => {
        expect(Object.keys(PRESETS)).toEqual(['risk', 'quality', 'activity', 'ownership']);
        expect(presetOf(PRESETS.quality)).toBe('quality');
        expect(presetOf(setChannel(PRESETS.risk, 'colour', 'cov'))).toBe('custom');
    });

    it('limits what each channel may show', () => {
        const allows = (id: string, m: Parameters<(typeof CHANNELS)[number]['allows']>[0]) => CHANNELS.find((c) => c.id === id)!.allows(m);
        expect(allows('colour', 'owner')).toBe(true);
        expect(allows('size', 'owner')).toBe(false);
        expect(allows('width', 'changed')).toBe(false);
        expect(allows('width', 'use')).toBe(true);
    });
});

describe('makeOverlay', () => {
    it('resolves the risk preset to colour, size and ring', () => {
        const overlay = makeOverlay(PRESETS.risk, stations);
        const api = overlay.style(get('API'));
        expect(api.tone).toBe('sev4');
        expect(api.size).toBe(5 + 4 * 2);
        expect(api.ring).toEqual({ frac: 0.8, tone: 'agrees' });
        expect(api.pulse).toBe(false);
        expect(overlay.style(get('repositories')).ring).toEqual({ frac: 0.2, tone: 'cycle' });
    });

    it('draws neutral where a station has no data, and says which channels are not set up', () => {
        const bare = buildStations(codeFixture()).stations;
        const overlay = makeOverlay(PRESETS.risk, bare);
        expect(overlay.status).toMatchObject({ colour: 'ready', size: 'not-set-up', ring: 'not-set-up', width: 'ready', pulse: 'ready', outline: 'off' });
        const style = overlay.style(bare[0]!);
        expect(style.size).toBe(8);
        expect(style.ring).toBeNull();
        const noCov = makeOverlay(PRESETS.risk, stations).style(get('Web app'));
        expect(noCov.ring).toBeNull();
    });

    it('colours by owner from the line palette, and pulses what changed', () => {
        const changed = buildStations(surfaceFixture(), { changed: new Set(['src:sys::db/repo.ts']) }).stations;
        const owner = makeOverlay(PRESETS.ownership, changed);
        expect(owner.style(changed.find((s) => s.name === 'API')!).tone).toBe('line1');
        expect(owner.style(changed.find((s) => s.name === 'Web app')!).tone).toBe('edge');
        const risk = makeOverlay(PRESETS.risk, changed);
        expect(risk.style(changed.find((s) => s.name === 'repositories')!).pulse).toBe(true);
    });

    it('widens a line with usage and falls back when width is off', () => {
        const overlay = makeOverlay(PRESETS.risk, stations);
        expect(overlay.lineWidth([get('API')])).toBe(12);
        // No stop, so no reading: the neutral width, not an invented mid value.
        expect(overlay.lineWidth([])).toBe(6);
        expect(overlay.lineWidth([get('API'), get('cron')])).toBeGreaterThan(6); // a reading on any stop is used
        expect(makeOverlay(setChannel(PRESETS.risk, 'width', 'none'), stations).lineWidth([get('API')])).toBe(6);
    });
});

describe('segmentUntested', () => {
    it('is undefined without coverage and true below half', () => {
        expect(segmentUntested(get('Web app'), get('cron'))).toBeUndefined();
        expect(segmentUntested(get('API'), get('repositories'))).toBe(true);
        expect(segmentUntested(get('API'), get('Web app'))).toBe(false);
    });
});
