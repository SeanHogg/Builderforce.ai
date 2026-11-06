import { describe, expect, it } from 'vitest';
import { nodeIndex } from '../../graphModel';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import { surfaceFixture } from '../../testing';
import { buildStations } from '../stations';
import { buildCard, MAX_ISSUES, NO_DATA } from './cardModel';
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
    it('names the station\'s issues, capped, and offers only the actions that apply', () => {
        const api = card('API');
        expect(api.issues.length).toBeGreaterThan(0);
        expect(api.issues.length).toBeLessThanOrEqual(MAX_ISSUES);
        expect(api.hasApi).toBe(true);
        expect(api.hasPatterns).toBe(true);
        expect(api.meta).toBe('2 files · Layer');
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
