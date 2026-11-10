import { describe, expect, it } from 'vitest';
import type { DeltaFinding, RunDelta } from '../contract.js';
import { computeRunDelta } from '../engine/computeRunDelta.js';
import { DEFAULT_REGISTRIES } from '../registry/defaults.js';
import { defaultDimensionRegistry } from '../registry/dimensions.js';
import { withOverrides } from '../registry/overrides.js';
import { unsafeRegex } from '../registry/safeRegex.js';
import { STRIDE_CATEGORIES } from '../registry/stride.js';
import { fixture, type Files, type FixtureOptions } from '../testing/fixturePorts.js';

async function run(before: Files, after: Files, opts?: FixtureOptions): Promise<RunDelta> {
    const { input, ports } = fixture(before, after, opts);
    return computeRunDelta(input, defaultDimensionRegistry(), ports);
}
const security = (d: RunDelta): DeltaFinding[] => d.dimensions.find((x) => x.id === 'security')!.findings;
const of = (d: RunDelta, ruleId: string, lineage = 'introduced'): DeltaFinding[] =>
    security(d).filter((f) => f.ruleId === ruleId && f.lineage === lineage);

describe('taint-path (C5.2)', () => {
    const handler = (body: string) => `app.post('/api/run', requireAuth, async (c) => {\n${body}\n});\n`;

    it('a request body reaching exec through two variables is an introduced heuristic error with the hop chain', async () => {
        const d = await run(
            { 'api/run.ts': handler("  const body = await c.req.json();\n  return c.json(1);") },
            { 'api/run.ts': handler("  const body = await c.req.json();\n  const cmd = body.cmd;\n  exec(`sh -c ${cmd}`);\n  return c.json(1);") },
        );
        const [path] = of(d, 'taint-path');
        expect(path).toMatchObject({
            severity: 'error', confidence: 'heuristic',
            params: { sink: 'command-exec', source: 'http-request', call: 'exec(', hops: 4, stride: 'elevation-of-privilege' },
        });
        // The engine orders evidence by location; the chain reads top to bottom.
        expect(path!.evidence.map((e) => [e.line, e.note])).toEqual([[2, 'body'], [2, 'c.req.json('], [3, 'cmd'], [4, 'exec(']]);
    });

    it('a sanitizer on the path resolves it; the identity is anchored at the sink', async () => {
        const before = handler("  const { url } = await c.req.json();\n  await fetch(url);");
        const after = handler("  const { url } = Schema.parse(await c.req.json());\n  await fetch(url);");
        const d = await run({ 'api/f.ts': before }, { 'api/f.ts': after });
        expect(of(d, 'taint-path', 'resolved')).toHaveLength(1);
        expect(of(d, 'taint-path', 'resolved')[0]!.params).toMatchObject({ sink: 'ssrf', source: 'http-request' });
        expect(of(d, 'taint-path')).toEqual([]);
    });

    it('no path: a parameterized query, a name inside a string, RegExp#exec, a Number() sanitizer', async () => {
        const d = await run(
            { 'api/q.ts': 'export const x = 1;\n' },
            {
                'api/q.ts': handler([
                    "  const id = c.req.param('id');",
                    "  await db.query('SELECT * FROM t WHERE id = $1', [id]);",
                    "  exec('echo id');",
                    '  /x/.exec(id);',
                    '  const n = Number(id);',
                    '  await fetch(`https://api.example.com/${n}`);',
                ].join('\n')),
            },
        );
        expect(of(d, 'taint-path')).toEqual([]);
    });

    it('raw SQL from a query param through a template is sql-raw; a tainted name in another function does not leak', async () => {
        const d = await run(
            { 'api/s.ts': 'export const s = 1;\n' },
            {
                'api/s.ts': [
                    "function a(req) { const name = req.query.name; return name; }",
                    "function b(name) { return db.query('SELECT 1', [name]); }",
                    "function c(req) { const q = req.query.q; return db.prepare(`SELECT * FROM t WHERE q = '${q}'`); }",
                ].join('\n') + '\n',
            },
        );
        expect(of(d, 'taint-path').map((f) => [f.params['sink'], f.params['source'], f.evidence[0]!.line])).toEqual([['sql-raw', 'http-request', 3]]);
    });

    it('innerHTML assignment from webview message data is a warn (tampering)', async () => {
        const d = await run(
            { 'webview/v.ts': 'export {};\n' },
            { 'webview/v.ts': "window.addEventListener('message', (event) => {\n  const html = event.data.html;\n  el.innerHTML = html;\n});\n" },
        );
        expect(of(d, 'taint-path')[0]).toMatchObject({ severity: 'warn', params: { sink: 'html', source: 'webview-message', stride: 'tampering' } });
    });
});

describe('attack surface (C5.1)', () => {
    it('method-widened instead of entry-added when a served path gains a method', async () => {
        const d = await run(
            { 'api/w.ts': "app.get('/api/w', requireAuth, list);\n" },
            { 'api/w.ts': "app.get('/api/w', requireAuth, list);\napp.all('/api/w', requireAuth, any);\n" },
        );
        expect(of(d, 'method-widened')[0]).toMatchObject({ severity: 'warn', params: { route: 'ALL /api/w', from: 'GET', stride: 'tampering' } });
        expect(of(d, 'entry-added')).toEqual([]);
    });

    it('new-untrusted-input when an existing route starts reading a header', async () => {
        const d = await run(
            { 'api/h.ts': "app.get('/api/h', requireAuth, async (c) => c.json(await c.req.json()));\n" },
            { 'api/h.ts': "app.get('/api/h', requireAuth, async (c) => c.json({ ...(await c.req.json()), ua: c.req.header('user-agent') }));\n" },
        );
        expect(of(d, 'new-untrusted-input').map((f) => f.params)).toEqual([
            { route: 'GET /api/h', source: 'http-request', call: 'c.req.header(', file: 'api/h.ts', stride: 'tampering' },
        ]);
    });

    it('entry-added carries the STRIDE checklist: covered by the guard on its chain, otherwise uncovered', async () => {
        const d = await run(
            { 'api/e.ts': 'export {};\n' },
            { 'api/e.ts': "app.post('/api/e', requireAuth, rateLimit({ max: 5 }), async (c) => c.json(1));\n" },
        );
        expect(of(d, 'entry-added')[0]!.params).toMatchObject({
            stride: 'spoofing',
            'stride-spoofing': 'requireAuth',
            'stride-tampering': 'uncovered',
            'stride-repudiation': 'uncovered',
            'stride-information-disclosure': 'requireAuth',
            'stride-denial-of-service': 'rateLimit',
            'stride-elevation-of-privilege': 'uncovered',
        });
    });
});

describe('config and infra surface (C5.6)', () => {
    it('TLS verification disabled is an error; a comment is ignored', async () => {
        const d = await run(
            { 'src/t.ts': 'export const agent = new Agent({});\n' },
            { 'src/t.ts': "// rejectUnauthorized: false\nexport const agent = new Agent({ rejectUnauthorized: false });\n" },
        );
        expect(of(d, 'tls-verify-disabled').map((f) => [f.severity, f.evidence[0]!.line])).toEqual([['error', 2]]);
    });

    it('CORS any-origin is a warn alone and an error with credentials', async () => {
        const d = await run(
            { 'src/a.ts': 'export {};\n', 'src/b.ts': 'export {};\n' },
            { 'src/a.ts': "app.use(cors({ origin: '*' }));\n", 'src/b.ts': "app.use(cors({ origin: '*', credentials: true }));\n" },
        );
        expect(of(d, 'cors-permissive').map((f) => [f.params['file'], f.severity]).sort()).toEqual([['src/a.ts', 'warn'], ['src/b.ts', 'error']]);
    });

    it('cookie-insecure lists the missing flags; adding every flag resolves it', async () => {
        const insecure = "setCookie(c, 'sid', token, { path: '/' });\n";
        const d1 = await run({ 'src/c.ts': 'export {};\n' }, { 'src/c.ts': insecure });
        expect(of(d1, 'cookie-insecure')[0]!.params).toMatchObject({ missing: 'httpOnly, secure, sameSite', stride: 'spoofing' });
        const d2 = await run({ 'src/c.ts': insecure }, { 'src/c.ts': "setCookie(c, 'sid', token, { path: '/', httpOnly: true, secure: true, sameSite: 'Lax' });\n" });
        expect(of(d2, 'cookie-insecure', 'resolved')).toHaveLength(1);
        expect(of(d2, 'cookie-insecure')).toEqual([]);
    });

    it('csp-permissive, workflow-permissive, container-root, infra-surface-added', async () => {
        const d = await run(
            { 'Dockerfile': 'FROM node:22\nUSER node\nEXPOSE 3000\n', 'wrangler.toml': 'name = "w"\n[[kv_namespaces]]\nbinding = "KV"\n' },
            {
                'Dockerfile': 'FROM node:22\nEXPOSE 3000 9229\n',
                'wrangler.toml': 'name = "w"\n[[kv_namespaces]]\nbinding = "KV"\n[[d1_databases]]\nbinding = "DB"\n',
                '.github/workflows/ci.yml': 'on:\n  pull_request_target:\n',
                'src/h.ts': "export const csp = \"script-src 'self' 'unsafe-inline'\";\n",
            },
        );
        expect(of(d, 'csp-permissive')).toHaveLength(1);
        expect(of(d, 'workflow-permissive')[0]!.params).toMatchObject({ stride: 'elevation-of-privilege' });
        expect(of(d, 'container-root')).toHaveLength(1);
        expect(of(d, 'infra-surface-added').map((f) => [f.params['kind'], f.params['key']]).sort()).toEqual([['binding', 'binding:DB'], ['port', 'port:9229']]);
    });

    it('install-script-added for a new postinstall; editing its command keeps the identity', async () => {
        const d1 = await run({ 'package.json': '{ "scripts": { "build": "tsc" } }\n' }, { 'package.json': '{ "scripts": { "build": "tsc", "postinstall": "node x.js" } }\n' });
        expect(of(d1, 'install-script-added')[0]!.params).toMatchObject({ script: 'postinstall', stride: 'elevation-of-privilege' });
        const d2 = await run({ 'package.json': '{ "scripts": { "postinstall": "node x.js" } }\n' }, { 'package.json': '{ "scripts": { "postinstall": "node y.js" } }\n' });
        expect(of(d2, 'install-script-added')).toEqual([]);
    });

    it('debug-enabled only in a production config', async () => {
        const d = await run(
            { 'config/production.json': '{}\n', 'config/dev.json': '{}\n' },
            { 'config/production.json': '{\n  "debug": true\n}\n', 'config/dev.json': '{\n  "debug": true\n}\n' },
        );
        expect(of(d, 'debug-enabled').map((f) => f.params['file'])).toEqual(['config/production.json']);
    });
});

describe('security registries (C5) and STRIDE (C5.7)', () => {
    it('every security finding carries a STRIDE category', async () => {
        const d = await run(
            { 'api/r.ts': "app.get('/api/r', requireAuth, h);\n" },
            { 'api/r.ts': "import { exec } from 'node:child_process';\napp.get('/api/r', h);\napp.post('/api/n', h);\nexec(process.argv[2]);\n" },
        );
        expect(security(d).length).toBeGreaterThanOrEqual(4);
        for (const f of security(d)) expect(STRIDE_CATEGORIES, f.ruleId).toContain(f.params['stride']);
    });

    it('guard-removed is in the blocking registry (§12.5)', () => {
        expect(DEFAULT_REGISTRIES.blocking).toContain('guard-removed');
    });

    it('every built-in insecureConfig regex passes the override safety gate', () => {
        for (const src of Object.values(DEFAULT_REGISTRIES.insecureConfig).flat()) expect([src, unsafeRegex(src)]).toEqual([src, undefined]);
    });

    it('overrides merge taint and STRIDE groups and drop invalid ones', () => {
        const { registries, dropped } = withOverrides(DEFAULT_REGISTRIES, {
            taintSinks: { 'command-exec': ['runShell('] },
            taintSanitizers: ['allowlisted('],
            strideCoverage: { repudiation: ['auditTrail'], bogus: ['x'], spoofing: ['not an ident'] },
            insecureConfig: { 'tls-verify-disabled': ['(a+)+'] },
        });
        expect(registries.taintSinks['command-exec']).toEqual([...DEFAULT_REGISTRIES.taintSinks['command-exec']!, 'runShell(']);
        expect(registries.taintSanitizers).toContain('allowlisted(');
        expect(registries.strideCoverage['repudiation']).toContain('auditTrail');
        expect(dropped).toEqual(['invalid:strideCoverage.bogus', 'invalid:strideCoverage.spoofing', 'unsafe-regex:insecureConfig.nested-quantifier']);
    });

    it('a repo sink from the BEFORE side registry is honoured', async () => {
        const { registries } = withOverrides(DEFAULT_REGISTRIES, { taintSinks: { 'command-exec': ['runShell('] } });
        const { input, ports } = fixture({ 'cli/x.ts': 'export {};\n' }, { 'cli/x.ts': 'const arg = process.argv[2];\nrunShell(arg);\n' });
        const d = await computeRunDelta(input, defaultDimensionRegistry(registries), ports);
        expect(of(d, 'taint-path')[0]).toMatchObject({ params: { sink: 'command-exec', source: 'process-argv' } });
    });
});
