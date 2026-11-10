import { describe, expect, it } from 'vitest';
import { buildGraph, type Extracted } from '@seanhogg/builderforce-memory/knowledge';
import { PLACEMENTS } from './compute/tasks/placement';
import { concurrencyOf, deployBindingsOf, deployUnitsOf } from './deployFacts';
import { FOUR_PLUS_ONE_ASPECTS, FOUR_PLUS_ONE_COVERAGE } from './fourPlusOne';

const ROOT = 'r';
const src = (p: string) => `src:${ROOT}::${p}` as const;

/**
 * hired.video's `api/` as agent-tools' code pack extracts it (knowledge/deploy/deployParser + codeConcurrency): the
 * `wrangler.toml` file node, its Worker unit with a KV and a Durable Object binding, and the source files whose
 * `concurrency` badge names the cron handler and the Durable Object.
 */
const UNIT = 'ent:code:unit:api/wrangler.toml#hired-api' as const;
const KV = 'ent:code:binding:kv:KV_CACHE' as const;
const DO = 'ent:code:binding:durable-object:ChatRoom' as const;
const EXTRACTED: Extracted[] = [
    {
        sourceRef: src('api/wrangler.toml'), sourceHash: 'a1',
        nodes: [
            { ref: src('api/wrangler.toml'), kind: 'file', label: 'wrangler.toml', pack: 'code', importance: 0, origin: 'extracted', badges: { deploy: 'wrangler', units: 1 } },
            {
                ref: UNIT, kind: 'entity', label: 'hired-api', pack: 'code', importance: 0, origin: 'extracted',
                badges: { type: 'deployable-unit', unitKind: 'worker', runtime: 'cloudflare-workers', source: 'api/src/worker.ts', cron: '*/5 * * * *', bindings: 'kv:KV_CACHE,durable-object:CHAT_ROOM', externals: 'kv' },
            },
            { ref: KV, kind: 'entity', label: 'KV_CACHE', pack: 'code', importance: 0, origin: 'extracted', badges: { type: 'deploy-binding', bindingKind: 'kv', externals: 'kv' } },
            { ref: DO, kind: 'entity', label: 'ChatRoom', pack: 'code', importance: 0, origin: 'extracted', badges: { type: 'deploy-binding', bindingKind: 'durable-object' } },
        ],
        edges: [
            { from: src('api/wrangler.toml'), to: UNIT, kind: 'mentions', weight: 1, origin: 'extracted' },
            { from: UNIT, to: src('api/src/worker.ts'), kind: 'contains', weight: 1, origin: 'extracted' },
            { from: UNIT, to: KV, kind: 'references', weight: 1, origin: 'extracted' },
            { from: UNIT, to: DO, kind: 'references', weight: 1, origin: 'extracted' },
        ],
        keys: [],
    },
    {
        sourceRef: src('api/src/worker.ts'), sourceHash: 'b2', keys: [], edges: [],
        nodes: [{ ref: src('api/src/worker.ts'), kind: 'file', label: 'worker.ts', pack: 'code', importance: 0, origin: 'extracted', badges: { language: 'js', concurrency: 'cron:scheduled' } }],
    },
    {
        sourceRef: src('api/src/durable/ChatRoom.ts'), sourceHash: 'c3', keys: [], edges: [],
        nodes: [{ ref: src('api/src/durable/ChatRoom.ts'), kind: 'file', label: 'ChatRoom.ts', pack: 'code', importance: 0, origin: 'extracted', badges: { language: 'js', concurrency: 'durable-object:ChatRoom' } }],
    },
];

const graph = buildGraph({ rootId: ROOT, packs: [{ id: 'code', parsers: [] }], facts: [], relations: [], extracted: EXTRACTED }, { maxNodes: 100 });

describe('4+1 coverage (no 4+1 camera: each aspect is read by an existing one)', () => {
    it('covers every aspect with cameras that are registered placements', () => {
        for (const aspect of FOUR_PLUS_ONE_ASPECTS) {
            const entry = FOUR_PLUS_ONE_COVERAGE[aspect];
            expect(entry.coverage.length, aspect).toBeGreaterThan(0);
            for (const c of entry.coverage) expect(c.camera in PLACEMENTS, `${aspect} → ${c.camera}`).toBe(true);
        }
    });

    it('reads the deployable units and their bindings off a built graph (Physical)', () => {
        expect(deployUnitsOf(graph)).toEqual([{ ref: UNIT, name: 'hired-api', kind: 'worker', runtime: 'cloudflare-workers', ports: [], sources: ['api/src/worker.ts'] }]);
        expect(deployBindingsOf(graph).map((n) => n.ref).sort()).toEqual([DO, KV]);
        // The unit stays connected: declared by its descriptor, shipping its entry file.
        expect(graph.edges.some((e) => e.from === UNIT && e.to === src('api/src/worker.ts') && e.kind === 'contains')).toBe(true);
        const physical = FOUR_PLUS_ONE_COVERAGE.physical.coverage.filter((c) => c.probe);
        expect(physical.map((c) => c.camera)).toEqual(['system', 'system']);
        for (const c of physical) expect(c.probe!(graph), c.reads).toBeGreaterThan(0);
    });

    it('reads concurrency off a built graph (Process)', () => {
        expect(concurrencyOf(graph)).toEqual([
            { ref: src('api/src/durable/ChatRoom.ts'), entries: ['durable-object:ChatRoom'] },
            { ref: src('api/src/worker.ts'), entries: ['cron:scheduled'] },
        ]);
        const probes = FOUR_PLUS_ONE_COVERAGE.process.coverage.filter((c) => c.probe);
        expect(probes.length).toBe(1);
        expect(probes[0]!.probe!(graph)).toBe(2);
    });

    it('a graph without descriptors gives the probes nothing, so no row claims data that is not there', () => {
        const empty = { nodes: graph.nodes.filter((n) => n.kind === 'file').map((n) => ({ ...n, badges: {} })) };
        for (const aspect of FOUR_PLUS_ONE_ASPECTS) for (const c of FOUR_PLUS_ONE_COVERAGE[aspect].coverage) if (c.probe) expect(c.probe(empty), c.reads).toBe(0);
    });

    it('still names the Physical gap: units have no MarkSet slot yet', () => {
        expect(FOUR_PLUS_ONE_COVERAGE.physical.gap).toMatch(/MarkSet/);
    });
});
