import { describe, expect, it } from 'vitest';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import {
    MAX_PINPOINT_MATCHES, checkPinpointDataUrl, checkPinpointImage, cleanTexts, isCatalogPath, keysOfValue, matchAnchors, parseVisionReply, pinpointVisionRequest,
    type PinpointHit, type PinpointPorts,
} from './pinpointMatch.js';

const ROOT = 'r';
const ref = (p: string): string => `src:${ROOT}::${p}`;
const node = (p: string) => ({ ref: ref(p), kind: 'file', label: p, pack: 'code', importance: 0, origin: 'extracted' as const });
const graphOf = (paths: string[], edges: Array<[string, string]> = [], truncated = false): KnowledgeGraph => ({
    scope: { rootId: ROOT, packs: ['code'], digest: 'd' },
    nodes: paths.map(node),
    edges: edges.map(([from, to]) => ({ from: ref(from), to: ref(to), kind: 'references', weight: 1, origin: 'extracted' as const })),
    findings: [],
    stats: { sources: paths.length, nodes: paths.length, edges: edges.length, stale: 0, truncated },
} as unknown as KnowledgeGraph);

const GRAPH = graphOf(['src/Judging.tsx', 'src/Panel.tsx', 'src/Plain.tsx'], [['src/Panel.tsx', 'src/Judging.tsx']]);
const SEEN = { description: 'stuck on Judging', texts: ['Judging', '  ', 'Judging', 'Plain label'] };

function ports(hits: Record<string, PinpointHit[]>, extra: Partial<PinpointPorts> = {}): PinpointPorts {
    return { rootId: ROOT, search: async (literal) => hits[literal] ?? [], graph: async () => GRAPH, ...extra };
}

describe('matchAnchors', () => {
    it('matches an exact literal, follows a catalog key to its usages, and hops one import', async () => {
        const out = await matchAnchors(ports({
            Judging: [{ path: 'frontend/src/i18n/messages/en.json', line: 4, text: '"judging": "Judging"' }],
            'knowledge.judging': [
                { path: 'src/Judging.tsx', line: 9, text: "t('knowledge.judging')" },
                { path: 'frontend/src/i18n/messages/en.json', line: 4, text: 'knowledge.judging' },
            ],
            'Plain label': [{ path: 'src/Plain.tsx', line: 2, text: '<b>Plain label</b>' }],
        }, { readText: async () => JSON.stringify({ knowledge: { judging: 'Judging' } }) }), SEEN);
        expect(out.anchors.map((a) => a.text)).toEqual(['Judging', 'Plain label']);
        // Every text's exact hits come before any catalog follow-up.
        expect(out.matches).toEqual([
            { ref: ref('src/Plain.tsx'), why: '"Plain label" (line 2)', provenance: 'exact' },
            { ref: ref('src/Judging.tsx'), why: 'key knowledge.judging for "Judging"', provenance: 'catalog' },
            { ref: ref('src/Panel.tsx'), why: 'imports Judging.tsx', provenance: 'import' },
        ]);
    });

    it('trusts an unverified server hit for a key only when its tier is lexical/exact or the file holds the key', async () => {
        const unverified = (path: string, tier: string): PinpointHit => ({ path, line: 0, text: '', verified: false, tier });
        const out = await matchAnchors(ports({
            Judging: [unverified('src/Plain.tsx', 'lexical')],
            'knowledge.judging': [unverified('src/Judging.tsx', 'lexical'), unverified('src/Plain.tsx', 'dense'), unverified('src/Panel.tsx', 'dense')],
        }, {
            catalogKeys: async (text) => (text === 'Judging' ? ['knowledge.judging'] : []),
            readText: async (path) => (path === 'src/Plain.tsx' ? "t('knowledge.judging')" : 'nothing'),
        }), SEEN);
        expect(out.matches.map((m) => [m.ref, m.provenance])).toEqual([
            [ref('src/Judging.tsx'), 'catalog'],
            [ref('src/Plain.tsx'), 'catalog'],
            [ref('src/Panel.tsx'), 'import'],
        ]);
    });

    it('does not filter by the graph when the graph is truncated', async () => {
        const out = await matchAnchors(ports(
            { Judging: [{ path: 'gone/File.ts', line: 1, text: 'Judging' }] },
            { graph: async () => graphOf(['src/Panel.tsx'], [], true) },
        ), SEEN);
        expect(out.matches.map((m) => m.ref)).toEqual([ref('gone/File.ts')]);
        const full = await matchAnchors(ports({ Judging: [{ path: 'gone/File.ts', line: 1, text: 'Judging' }] }), SEEN);
        expect(full.matches).toEqual([]);
    });

    it('bounds the matches at the cap without letting direct matches crowd out the imports', async () => {
        const paths = Array.from({ length: 60 }, (_, i) => `src/f${i}.ts`);
        const importer = 'src/importer.ts';
        const out = await matchAnchors(ports(
            { Judging: paths.map((p) => ({ path: p, line: 1, text: 'Judging' })) },
            { graph: async () => graphOf([...paths, importer], [[importer, paths[0]!]]) },
        ), { description: '', texts: ['Judging', 'Plain label'] });
        expect(out.matches.length).toBeLessThanOrEqual(MAX_PINPOINT_MATCHES);
        expect(out.matches.filter((m) => m.provenance === 'exact').length).toBe(8); // FILES_PER_TEXT
        expect(out.matches.at(-1)).toMatchObject({ provenance: 'import' });
    });

    it('caps direct matches below the cap so imports keep a reserve', async () => {
        const texts = Array.from({ length: 12 }, (_, i) => `label number ${i}`);
        const hits: Record<string, PinpointHit[]> = {};
        const paths: string[] = [];
        texts.forEach((t, i) => {
            hits[t] = Array.from({ length: 8 }, (_, j) => ({ path: `src/t${i}_${j}.ts`, line: 1, text: t }));
            paths.push(...hits[t]!.map((h) => h.path));
        });
        const out = await matchAnchors(ports(hits, { graph: async () => graphOf([...paths, 'src/imp.ts'], [['src/imp.ts', paths[0]!]]) }), { description: '', texts });
        expect(out.matches.filter((m) => m.provenance !== 'import').length).toBe(MAX_PINPOINT_MATCHES - 8);
        expect(out.matches.some((m) => m.provenance === 'import')).toBe(true);
    });
});

describe('helpers', () => {
    it('bounds the strings and recognises catalogs', () => {
        expect(cleanTexts(Array.from({ length: 30 }, (_, i) => `label ${i}`))).toHaveLength(12);
        expect(isCatalogPath('frontend/src/i18n/messages/en.json')).toBe(true);
        expect(isCatalogPath('packages/x/src/labels.ts')).toBe(true);
        expect(isCatalogPath('src/app.ts')).toBe(false);
    });

    it('finds up to a limit of dotted keys for a value', () => {
        const catalog = { a: { ok: 'Save' }, b: { ok: 'Save' }, c: 'Save', d: { ok: 'Save' } };
        expect(keysOfValue(catalog, 'Save')).toEqual(['a.ok', 'b.ok', 'c']);
        expect(keysOfValue(catalog, 'Nope')).toEqual([]);
    });

    it('reads a vision reply wrapped in prose', () => {
        expect(parseVisionReply('Here: {"description":"d","texts":["a",1]} ok')).toEqual({ description: 'd', texts: ['a'] });
        expect(() => parseVisionReply('no json')).toThrow();
    });

    it('builds the one vision request: no pinned model, the image as a content part', () => {
        const request = pinpointVisionRequest('data:image/png;base64,AA==');
        expect(request).not.toHaveProperty('model');
        expect(request.messages[1]!.content).toEqual([{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }]);
        expect(request.temperature).toBe(0);
    });

    it('validates a data URL by length first, then by shape', () => {
        expect(() => checkPinpointDataUrl('data:image/png;base64,AA==')).not.toThrow();
        expect(() => checkPinpointDataUrl('data:text/html;base64,AA==')).toThrow(/PNG/);
        expect(() => checkPinpointDataUrl(42)).toThrow(/PNG/);
        expect(() => checkPinpointDataUrl(`data:image/png;base64,${'A'.repeat(12 * 1024 * 1024)}`)).toThrow(/8 MB/);
    });

    it('checks the screenshot type and size', () => {
        expect(() => checkPinpointImage({ type: 'image/png', size: 10 })).not.toThrow();
        expect(() => checkPinpointImage({ type: 'text/plain', size: 10 })).toThrow(/PNG/);
        expect(() => checkPinpointImage({ type: 'image/png', size: 9 * 1024 * 1024 })).toThrow(/8 MB/);
    });
});
