import { describe, expect, it } from 'vitest';
import { type Extracted, type KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { codeParser, createCodePack } from '../codePack.js';
import { buildCodeGraph } from '../codeGraph.js';
import { DEPLOY_BADGES, DEPLOY_TYPES, bindingRef, unitRef } from './deployNodes.js';
import { deployParser, DEPLOY_PARSER_ID } from './deployParser.js';

const ROOT = 'r';
const ref = (path: string) => `src:${ROOT}::${path}`;
const ctx = { rootId: ROOT, knownKeys: new Map(), resolvePath: () => undefined };
const doc = (path: string, text: string) => ({ id: path, tenantId: 't', content: { kind: 'text' as const, text, mediaType: 'text/plain' } });

/** A small hired.video-shaped root: a Worker API, a Pages SPA, a container image and a deploy workflow. */
const FILES: Record<string, string> = {
    'api/wrangler.toml': [
        'name = "hired-api"', 'main = "src/worker.ts"', '[triggers]', 'crons = ["*/5 * * * *"]',
        '[[kv_namespaces]]', 'binding = "KV_CACHE"', 'id = "0123"', '[ai]', 'binding = "AI"',
        '[[durable_objects.bindings]]', 'name = "CHAT_ROOM"', 'class_name = "ChatRoom"', '[vars]', 'APP_ENV = "production"', '',
    ].join('\n'),
    'api/src/worker.ts': "import { ChatRoom } from './durable/ChatRoom.js';\nexport { ChatRoom };\nexport default { async scheduled(event: unknown) { return event; } };\n",
    'api/src/durable/ChatRoom.ts': 'export class ChatRoom {\n  constructor(state: DurableObjectState) { void state; }\n}\n',
    'frontend/wrangler.toml': 'name = "hired"\npages_build_output_dir = "dist"\n',
    'frontend/src/main.tsx': 'export const app = 1;\n',
    'compose.yml': 'services:\n  api:\n    build: ./api\n    depends_on: [db]\n  db:\n    image: postgres:16\n',
    '.github/workflows/ci.yml': 'on: push\njobs:\n  deploy-api:\n    runs-on: ubuntu-latest\n    steps:\n      - run: cd api && npx wrangler deploy\n',
};

function extractedOf(): Extracted[] {
    const pack = createCodePack();
    return Object.entries(FILES).map(([path, text]) => {
        const parser = pack.parsers.find((p) => p.accepts(doc(path, text)))!;
        return parser.extract!(doc(path, text), parser.parse(doc(path, text)), ctx);
    });
}

function graph(): KnowledgeGraph {
    return buildCodeGraph({ rootId: ROOT, packs: [createCodePack()], facts: [], relations: [], extracted: extractedOf() }, { maxNodes: 2000 });
}

describe('deploy descriptors in the code pack', () => {
    it('the source parser stays first and the deploy parser claims descriptors only', () => {
        const pack = createCodePack();
        expect(pack.parsers.map((p) => p.id)).toEqual([codeParser().id, DEPLOY_PARSER_ID]);
        expect(deployParser().accepts(doc('api/wrangler.toml', 'x'))).toBe(true);
        expect(deployParser().accepts(doc('src/a.ts', 'x'))).toBe(false);
        expect(deployParser().accepts(doc('README.md', 'x'))).toBe(false);
    });

    it('puts every unit, binding and deploy edge on the built graph', () => {
        const g = graph();
        const node = (r: string) => g.nodes.find((n) => n.ref === r);
        const has = (from: string, to: string, kind: string) => g.edges.some((e) => e.from === from && e.to === to && e.kind === kind);
        const api = unitRef('api/wrangler.toml', 'hired-api');

        expect(node(api)).toMatchObject({ kind: 'entity', label: 'hired-api', pack: 'code' });
        expect(node(api)!.badges).toMatchObject({
            [DEPLOY_BADGES.type]: DEPLOY_TYPES.unit, [DEPLOY_BADGES.unitKind]: 'worker', [DEPLOY_BADGES.runtime]: 'cloudflare-workers',
            [DEPLOY_BADGES.cron]: '*/5 * * * *', [DEPLOY_BADGES.env]: 'APP_ENV', [DEPLOY_BADGES.externals]: 'kv,llm',
            [DEPLOY_BADGES.bindings]: 'kv:KV_CACHE,ai:AI,durable-object:CHAT_ROOM',
        });
        // Where it is declared, what it ships, what it binds.
        expect(has(ref('api/wrangler.toml'), api, 'mentions')).toBe(true);
        expect(has(api, ref('api/src/worker.ts'), 'contains')).toBe(true);
        // A KV binding names no resource: it is scoped to its descriptor. A Durable Object class is one node for every binder.
        expect(bindingRef('api/wrangler.toml', { kind: 'kv', name: 'KV_CACHE' })).toBe('ent:code:binding:kv:api/wrangler.toml#KV_CACHE');
        expect(has(api, bindingRef('api/wrangler.toml', { kind: 'kv', name: 'KV_CACHE' }), 'references')).toBe(true);
        expect(has(api, bindingRef('x', { kind: 'durable-object', name: 'CHAT_ROOM', resource: 'ChatRoom' }), 'references')).toBe(true);
        expect(node(bindingRef('x', { kind: 'durable-object', name: 'CHAT_ROOM', resource: 'ChatRoom' }))!.badges)
            .toMatchObject({ [DEPLOY_BADGES.type]: DEPLOY_TYPES.binding, [DEPLOY_BADGES.bindingKind]: 'durable-object' });

        // A folder target is re-pointed to its entry file: the Pages project, the compose build context, the workflow's `cd api`.
        expect(has(unitRef('frontend/wrangler.toml', 'hired'), ref('frontend/src/main.tsx'), 'contains')).toBe(true);
        expect(has(unitRef('compose.yml', 'api'), ref('api/src/worker.ts'), 'contains')).toBe(true);
        expect(has(unitRef('.github/workflows/ci.yml', 'deploy-api'), ref('api/src/worker.ts'), 'contains')).toBe(true);
        // Across descriptors: the CI job and the compose service that ship `api/` reach the Worker declared there.
        expect(has(unitRef('.github/workflows/ci.yml', 'deploy-api'), api, 'references')).toBe(true);
        expect(has(unitRef('compose.yml', 'api'), api, 'references')).toBe(true);
        // Unit → unit dependencies.
        expect(has(unitRef('compose.yml', 'api'), unitRef('compose.yml', 'db'), 'references')).toBe(true);
        expect(node(unitRef('compose.yml', 'db'))!.badges).toMatchObject({ [DEPLOY_BADGES.runtime]: 'postgres:16' });

        // No placeholder for a deploy target that names no file.
        expect(g.nodes.filter((n) => n.kind === 'missing').map((n) => n.ref)).toEqual([]);
        // The descriptor's own file node says what it is.
        expect(node(ref('api/wrangler.toml'))!.badges).toMatchObject({ [DEPLOY_BADGES.deploy]: 'wrangler', [DEPLOY_BADGES.units]: 1 });
    });

    it('records the concurrency the source files start', () => {
        const g = graph();
        const badge = (p: string) => g.nodes.find((n) => n.ref === ref(p))?.badges?.['concurrency'];
        expect(badge('api/src/worker.ts')).toBe('cron:scheduled');
        expect(badge('api/src/durable/ChatRoom.ts')).toBe('durable-object:ChatRoom');
    });
});
