import { describe, expect, it } from 'vitest';
import { encodeCoChange, type CoChangePartner, type KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS } from '../labels';
import { codeFixture, surfaceFixture } from '../testing';
import { hiddenPartners } from './coupling';
import { dataCoverage, gapOf } from './dataCoverage';
import { notSetUpText } from './notSetUpText';
import { CHANNELS, frac, level5, makeOverlay, METRICS, metricStatus, PRESETS, RELATIVE_METRICS, setChannel } from './overlays';
import { buildStations } from './stations';

const partner = (ref: string, together: number, ofSelf: number): CoChangePartner =>
    ({ ref: ref as CoChangePartner['ref'], together, ofSelf, confidence: together / ofSelf, lift: 3, low: 0.2, high: 0.9 });

/** The surface fixture with memory's co-change badges: routes changes with repo (no reference: hidden) and useCase (referenced). */
function coupled(): KnowledgeGraph {
    const g = surfaceFixture();
    const ref = (path: string) => g.nodes.find((n) => n.ref.endsWith(path))!.ref;
    const nodes = g.nodes.map((n) => {
        if (n.ref === ref('api/routes.ts')) {
            return { ...n, badges: { ...n.badges, coChange: encodeCoChange([partner(ref('db/repo.ts'), 4, 6), partner(ref('api/useCase.ts'), 3, 6)]), coChangeHidden: 1 } };
        }
        if (n.ref === ref('db/repo.ts')) return { ...n, badges: { ...n.badges, coChange: encodeCoChange([partner(ref('api/routes.ts'), 4, 5)]), coChangeHidden: 1 } };
        if (n.ref === ref('api/useCase.ts')) return { ...n, badges: { ...n.badges, coChange: encodeCoChange([partner(ref('api/routes.ts'), 3, 7)]) } };
        return n;
    });
    return { ...g, nodes };
}

describe('hidden coupling channel', () => {
    it('is a registry metric every channel but none may show, with its own name', () => {
        expect(METRICS).toContain('coupling');
        expect(RELATIVE_METRICS.coupling).toBeTypeOf('function');
        expect(CHANNELS.every((c) => c.allows('coupling'))).toBe(true);
        expect(DEFAULT_KNOWLEDGE_GRAPH_LABELS.surface.metricNames.coupling).toBe('Hidden coupling');
    });

    it('reads "Not set up" when no file carries the co-change badges', () => {
        for (const g of [codeFixture(), surfaceFixture()]) {
            const stations = buildStations(g).stations;
            expect(stations.every((s) => s.coupling === undefined)).toBe(true);
            expect(metricStatus('coupling', stations)).toBe('not-set-up');
            const coverage = dataCoverage(g);
            expect(gapOf(coverage, 'coupling')).not.toBeNull();
            expect(notSetUpText(DEFAULT_KNOWLEDGE_GRAPH_LABELS, coverage, 'coupling')).toContain(DEFAULT_KNOWLEDGE_GRAPH_LABELS.surface.notSetUp);
            const overlay = makeOverlay(setChannel(PRESETS.risk, 'colour', 'coupling'), stations);
            expect(overlay.status.colour).toBe('not-set-up');
            expect(stations.every((s) => overlay.style(s).tone === 'edge')).toBe(true);
        }
    });

    it('maps coChangeHidden to a station value relative to the most coupled, 0 where history shows none', () => {
        const g = coupled();
        expect(gapOf(dataCoverage(g), 'coupling')).toBeNull();
        const stations = buildStations(g).stations;
        const get = (name: string) => stations.find((s) => s.name === name)!;
        expect(metricStatus('coupling', stations)).toBe('ready');
        // API holds routes (1), repositories holds repo (1): both are the maximum.
        expect(get('API').coupling).toBe(1);
        expect(get('repositories').coupling).toBe(1);
        expect(get('Web app').coupling).toBe(0);
        expect(frac('coupling', get('API'))).toBe(1);
        expect(level5('coupling', get('API'))).toBe(5);
        expect(level5('coupling', get('Web app'))).toBe(1);
        const overlay = makeOverlay(setChannel(PRESETS.risk, 'colour', 'coupling'), stations);
        expect(overlay.status.colour).toBe('ready');
        expect(overlay.style(get('API')).tone).toBe('sev5');
        expect(overlay.style(get('Web app')).tone).toBe('sev1');
    });

    it('lists only the partners no reference explains, decoded by memory', () => {
        const g = coupled();
        const ref = (path: string) => g.nodes.find((n) => n.ref.endsWith(path))!.ref;
        expect(hiddenPartners(g, ref('api/routes.ts')).map((p) => p.ref)).toEqual([ref('db/repo.ts')]);
        expect(hiddenPartners(g, ref('api/routes.ts'))[0]).toMatchObject({ together: 4, ofSelf: 6, low: 0.2, high: 0.9 });
        expect(hiddenPartners(g, ref('api/useCase.ts'))).toEqual([]);
        expect(hiddenPartners(g, ref('web/main.tsx'))).toEqual([]);
    });
});
