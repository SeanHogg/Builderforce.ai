import { describe, expect, it } from 'vitest';
import { nodeIndex } from '../../graphModel';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import { surfaceFixture } from '../../testing';
import { buildStations } from '../stations';
import { antiWord, buildCard, importanceRank, MAX_ISSUES, NO_DATA } from './cardModel';
import { CARD_HEIGHT, CARD_WIDTH, placeCard } from './cardPlacement';

const graph = surfaceFixture();
const model = buildStations(graph);
const findings = new Map(graph.findings.map((f) => [f.id, f] as const));
const index = nodeIndex(graph);
const card = (name: string, over = {}) => buildCard({
    station: model.stations.find((s) => s.name === name)!, labels: L, layerName: 'Layer', findings, index,
    enter: { can: true, level: 'package' }, satellites: 2, unfolded: false, leaf: false, ...over,
});

describe('buildCard', () => {
    it('gives four stats, and "—" where the data was never collected', () => {
        const api = card('API');
        expect(api.stats.map((s) => s.key)).toEqual(['issues', 'complexity', 'coverage', 'usage']);
        expect(api.stats[2]!.value).toBe('80%');
        const web = card('Web app');
        expect(web.stats[1]!.value).toBe(NO_DATA);
        expect(web.stats[2]!.value).toBe(NO_DATA);
        expect(web.stats[2]!.tone).toBeNull();
    });
    it('reads usage as an importance rank and anti-patterns as a word, each with a tooltip', () => {
        const api = model.stations.find((s) => s.name === 'API')!;
        const c = card('API', { stations: model.stations });
        const { rank, total } = importanceRank(api, model.stations);
        expect(total).toBe(model.stations.length);
        const usage = c.stats.find((s) => s.key === 'usage')!;
        expect(usage.value).toBe(`#${rank} of ${total}`);
        expect(usage.title).toBe(L.surface.map.statWords.importanceTip);
        const anti = c.stats.find((s) => s.key === 'issues')!;
        expect(anti.label).toBe(L.surface.map.stats.issues);
        expect(Object.values(L.surface.map.statWords.anti)).toContain(anti.value);
        expect(anti.title).toBe(`from ${api.findingIds.length} warnings`);
        // The busiest station is #1; a station tied with it shares the rank.
        const busiest = [...model.stations].sort((a, b) => b.use - a.use)[0]!;
        expect(importanceRank(busiest, model.stations).rank).toBe(1);
    });
    it('maps the 1 to 5 level to none, low, medium, high, severe', () => {
        expect([1, 2, 3, 4, 5].map(antiWord)).toEqual(['none', 'low', 'medium', 'high', 'severe']);
        expect(antiWord(0)).toBe('none');
        expect(antiWord(9)).toBe('severe');
    });
    it('names the station\'s issues, capped, and offers only the actions that apply', () => {
        const api = card('API');
        expect(api.issues.length).toBeGreaterThan(0);
        expect(api.issues.length).toBeLessThanOrEqual(MAX_ISSUES);
        expect(api.hasApi).toBe(true);
        expect(api.hasPatterns).toBe(true);
        expect(api.meta).toBe('2 files · Layer');
        // Singular: "1 file", never "1 files".
        const one = buildCard({ station: { ...model.stations.find((s) => s.name === 'API')!, files: 1 }, labels: L, layerName: 'Layer', findings, index, enter: { can: true, level: 'package' }, satellites: 2, unfolded: false, leaf: false });
        expect(one.meta).toBe('1 file · Layer');
        const repo = card('repositories');
        expect(repo.hasApi).toBe(false);
        expect(repo.hasPatterns).toBe(false);
    });
});

describe('placeCard', () => {
    const box = { width: 800, height: 600 };
    it('sits right of the station, flips left when it would leave, and stays inside', () => {
        expect(placeCard({ left: 100, top: 100, width: 40, height: 40 }, box).left).toBe(150);
        expect(placeCard({ left: 700, top: 100, width: 40, height: 40 }, box).left).toBe(700 - 10 - CARD_WIDTH);
        const low = placeCard({ left: 100, top: 590, width: 40, height: 40 }, box);
        expect(low.top + CARD_HEIGHT).toBeLessThanOrEqual(600);
        expect(placeCard({ left: 0, top: 0, width: 10, height: 10 }, { width: 200, height: 100 }, { width: 270, height: 230 })).toEqual({ left: 0, top: 0 });
    });
});
