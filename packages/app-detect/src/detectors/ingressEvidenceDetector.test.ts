/**
 * PRD 31 §W11: the `/api` ingress is written only on evidence the backend answers there —
 * the runtime's ingress does not strip the prefix. Each evidence kind, the rewrite that
 * counts against it, a frontend's own `/api` calls (not evidence), and the wiring from the
 * files through `detectApp` into `emitManifest`.
 */
import { describe, expect, it } from 'vitest';
import { detectApp } from '../detectApp';
import { emitManifest } from '../manifest/emitManifest';
import { detectIngressEvidence, ingressEvidenceDetector } from './ingressEvidenceDetector';

const repo = (entries: Record<string, string>) => new Map(Object.entries(entries));
const kinds = (entries: Record<string, string>) => detectIngressEvidence(repo(entries)).map((e) => `${e.kind} ${e.file}`);

const VITE = (proxy: string) => `import { defineConfig } from 'vite';\nexport default defineConfig({\n  server: {\n    port: 5173,\n    proxy: ${proxy},\n  },\n});\n`;

describe('detectIngressEvidence — frontend dev proxies', () => {
  it('a Vite proxy that forwards /api as is', () => {
    expect(kinds({ 'web/vite.config.js': VITE("{ '/api': 'http://localhost:8000' }") })).toEqual(['dev-proxy web/vite.config.js']);
    expect(kinds({ 'vite.config.ts': VITE("{ '/api': { target: 'http://localhost:8000', changeOrigin: true } }") })).toEqual(['dev-proxy vite.config.ts']);
  });

  it('a Vite proxy that rewrites /api away is counter-evidence', () => {
    const config = VITE("{ '/api': { target: 'http://localhost:8000', rewrite: (path) => path.replace(/^\\/api/, '') } }");
    expect(kinds({ 'frontend/vite.config.ts': config })).toEqual(['proxy-rewrite frontend/vite.config.ts']);
  });

  it('an Angular proxy.conf.json, object and array forms, with and without pathRewrite', () => {
    expect(kinds({ 'web/proxy.conf.json': JSON.stringify({ '/api': { target: 'http://localhost:8000', secure: false } }) }))
      .toEqual(['dev-proxy web/proxy.conf.json']);
    expect(kinds({ 'proxy.conf.json': JSON.stringify({ '/api/*': { target: 'http://localhost:8000', pathRewrite: { '^/api': '' } } }) }))
      .toEqual(['proxy-rewrite proxy.conf.json']);
    expect(kinds({ 'src/proxy.conf.json': JSON.stringify([{ context: ['/api', '/auth'], target: 'http://localhost:8000' }]) }))
      .toEqual(['dev-proxy src/proxy.conf.json']);
    expect(kinds({ 'proxy.conf.json': JSON.stringify([{ context: ['/api'], target: 'http://x', pathRewrite: { '^/api': '' } }]) }))
      .toEqual(['proxy-rewrite proxy.conf.json']);
  });

  it('an Angular proxy.conf.js', () => {
    expect(kinds({ 'proxy.conf.js': "module.exports = { '/api': { target: 'http://localhost:8000', secure: false } };" }))
      .toEqual(['dev-proxy proxy.conf.js']);
  });

  it('Vite regex keys for /api, and the proxy.conf.js array form', () => {
    expect(kinds({ 'vite.config.ts': VITE("{ '^/api': 'http://localhost:8000' }") })).toEqual(['dev-proxy vite.config.ts']);
    expect(kinds({ 'vite.config.ts': VITE("{ '^/api/.*': { target: 'http://127.0.0.1:8000' } }") })).toEqual(['dev-proxy vite.config.ts']);
    expect(kinds({ 'web/proxy.conf.js': "module.exports = [{ context: ['/api', '/auth'], target: 'http://localhost:3000', secure: false }];" }))
      .toEqual(['dev-proxy web/proxy.conf.js']);
    expect(kinds({ 'proxy.conf.js': "module.exports = [{ context: ['/api'], target: 'http://localhost:3000', pathRewrite: { '^/api': '' } }];" }))
      .toEqual(['proxy-rewrite proxy.conf.js']);
    expect(kinds({ 'proxy.conf.js': "module.exports = [{ context: ['/auth'], target: 'http://localhost:3000' }];" })).toEqual([]);
  });

  it('a proxy to another host is no evidence; a local one (or a bare port, or a variable) is', () => {
    expect(kinds({ 'vite.config.ts': VITE("{ '/api': 'https://api.example.com' }") })).toEqual([]);
    expect(kinds({ 'vite.config.ts': VITE("{ '/api': { target: 'https://api.example.com', changeOrigin: true } }") })).toEqual([]);
    expect(kinds({ 'proxy.conf.json': JSON.stringify({ '/api': { target: 'https://api.example.com' } }) })).toEqual([]);
    expect(kinds({ 'proxy.conf.json': JSON.stringify([{ context: ['/api'], target: 'https://api.example.com' }]) })).toEqual([]);
    expect(kinds({ 'vite.config.ts': VITE("{ '/api': { target: 'http://0.0.0.0:8000' } }") })).toEqual(['dev-proxy vite.config.ts']);
    expect(kinds({ 'vite.config.ts': VITE("{ '/api': { target: API_TARGET } }") })).toEqual(['dev-proxy vite.config.ts']);
    expect(kinds({ 'vite.config.ts': VITE("{ '/api': `http://localhost:${port}` }") })).toEqual(['dev-proxy vite.config.ts']);
  });

  it('a Vite config with no /api proxy says nothing', () => {
    expect(kinds({ 'vite.config.ts': VITE("{ '/auth': 'http://localhost:8000' }") })).toEqual([]);
    expect(kinds({ 'vite.config.ts': "export default { server: { port: 5173 } };\n// fetch('/api')" })).toEqual([]);
  });
});

describe('detectIngressEvidence — backend routes', () => {
  it('express, fastify, hono and NestJS', () => {
    expect(kinds({ 'api/server.js': "const app = express();\napp.use('/api', items);\n" })).toEqual(['backend-routes api/server.js']);
    expect(kinds({ 'server/server.ts': "router.get('/api/items', list);" })).toEqual(['backend-routes server/server.ts']);
    expect(kinds({ 'backend/src/index.ts': "fastify.register(routes, { prefix: '/api' });" })).toEqual(['backend-routes backend/src/index.ts']);
    expect(kinds({ 'api/src/index.ts': "const app = new Hono().basePath('/api');" })).toEqual(['backend-routes api/src/index.ts']);
    expect(kinds({ 'src/main.ts': "app.setGlobalPrefix('api');" })).toEqual(['backend-routes src/main.ts']);
  });

  it('FastAPI, Flask and Django', () => {
    expect(kinds({ 'main.py': '@app.get("/api/items")\ndef items(): ...' })).toEqual(['backend-routes main.py']);
    expect(kinds({ 'api/app/main.py': 'app.include_router(items.router, prefix="/api")' })).toEqual(['backend-routes api/app/main.py']);
    expect(kinds({ 'app.py': "bp = Blueprint('api', __name__, url_prefix='/api')" })).toEqual(['backend-routes app.py']);
    expect(kinds({ 'shop/urls.py': "urlpatterns = [path('api/', include(router.urls))]" })).toEqual(['backend-routes shop/urls.py']);
  });

  it('Laravel routes/api.php and Slim', () => {
    expect(kinds({ 'api/routes/api.php': '<?php\nRoute::get(\'/items\', fn () => []);' })).toEqual(['backend-routes api/routes/api.php']);
    expect(kinds({ 'public/index.php': "<?php\n$app->group('/api', function ($group) {});" })).toEqual(['backend-routes public/index.php']);
  });

  it('ASP.NET minimal APIs, and [Route("api…")] in Program.cs', () => {
    expect(kinds({ 'api/Program.cs': 'app.MapGet("/api/items", () => items);' })).toEqual(['backend-routes api/Program.cs']);
    expect(kinds({ 'Program.cs': 'var api = app.MapGroup("/api");' })).toEqual(['backend-routes Program.cs']);
    expect(kinds({ 'Program.cs': '[ApiController]\n[Route("api/[controller]")]\npublic class ItemsController {}' })).toEqual(['backend-routes Program.cs']);
  });

  it('a backend serving at / is no evidence; nor is a frontend calling /api, nor /apis', () => {
    expect(kinds({ 'api/server.js': "app.get('/items', list);\napp.get('/health', ok);" })).toEqual([]);
    expect(kinds({ 'web/index.js': "axios.get('/api/items'); fetch('/api/items'); http.get('/api/x');" })).toEqual([]);
    expect(kinds({ 'server.js': "app.use('/apis', x);" })).toEqual([]);
    expect(kinds({ 'Program.cs': 'app.MapGet("/items", () => items);' })).toEqual([]);
  });

  it('reads only its own files', () => {
    expect(kinds({ 'scripts/deploy.js': "app.use('/api', x);" })).toEqual([]);
    expect(ingressEvidenceDetector.reads).toEqual(expect.arrayContaining(['vite.config.mjs', '*/vite.config.ts', '*/proxy.conf.json', 'api/package.json']));
  });

  it('keeps its own reads within budget: proxy configs first, backend sources only under found service roots', () => {
    expect(ingressEvidenceDetector.reads.length).toBeLessThanOrEqual(16);
    expect(ingressEvidenceDetector.reads.some((entry) => /\.(?:cs|py|php)$|server\.[jt]s$|index\.js$/.test(entry))).toBe(false);
    const follow = ingressEvidenceDetector.followReads!(repo({
      'package.json': JSON.stringify({ dependencies: { express: '4' } }),
      'api/requirements.txt': 'fastapi',
      'api/manage.py': "os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'shop.settings')",
      'server/Server.csproj': '<Project />',
      'docs/package.json': '{}',
    }));
    expect(follow).toEqual(expect.arrayContaining(['server.js', 'api/main.py', 'api/src/index.ts', 'api/shop/urls.py', 'server/Program.cs']));
    expect(follow).not.toContain('src/index.ts');
    expect(follow.some((path) => path.startsWith('backend/') || path.startsWith('docs/'))).toBe(false);
    // A root package.json with no server framework is a frontend's: nothing to follow at the root.
    expect(ingressEvidenceDetector.followReads!(repo({ 'package.json': JSON.stringify({ dependencies: { react: '19' } }) }))).toEqual([]);
  });
});

describe('detectApp → emitManifest — ingress from the files', () => {
  // The common shape: a Vite app at the root (package.json + vite.config.js), a FastAPI backend in api/.
  const FULL_STACK = {
    'package.json': JSON.stringify({ name: 'web', scripts: { dev: 'vite' }, dependencies: { react: '19' }, devDependencies: { vite: '6' } }),
    'vite.config.js': VITE("{ '/api': 'http://localhost:8000' }"),
    'api/requirements.txt': 'fastapi\nuvicorn\n',
    'api/main.py': 'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/items")\ndef items(): ...\n',
  };

  it('carries the evidence through detection', () => {
    expect(detectApp(repo(FULL_STACK)).ingressEvidence).toEqual([{ kind: 'dev-proxy', file: 'vite.config.js' }]);
    expect(detectApp(repo({ 'package.json': '{"name":"x"}' })).ingressEvidence).toEqual([]);
  });

  it('folds the root Vite config into the root package.json frontend: one frontend, not two', () => {
    const frontends = detectApp(repo(FULL_STACK)).blueprint.services.filter((s) => s.rootDir === '.');
    expect(frontends.map((s) => s.id)).toEqual(['web']);
    expect(frontends[0]!.devCommand).toBe('vite');
  });

  it('counts routes only under the backend root, and no proxy to another host', () => {
    const emit = (files: Record<string, string>) => {
      const detection = detectApp(repo(files));
      return emitManifest(detection.blueprint, { ingressEvidence: detection.ingressEvidence });
    };
    const noProxy = Object.fromEntries(Object.entries(FULL_STACK).filter(([file]) => file !== 'vite.config.js'));
    // A mock server outside api/ declares /api routes: not the backend's.
    const mocked = emit({ ...noProxy, 'mock/server.js': "const app = express();\napp.use('/api', items);\n" });
    expect(mocked.manifest.ingress).toBeUndefined();
    expect(mocked.notes.some((note) => note.code === 'ingress-not-inferred')).toBe(true);
    // A proxy to a deployed API says nothing about api/.
    const remote = emit({ ...FULL_STACK, 'vite.config.js': VITE("{ '/api': 'https://api.example.com' }") });
    expect(remote.manifest.ingress).toBeUndefined();
    // The backend's own routes, under api/, do count.
    const routed = emit({ ...noProxy, 'api/main.py': 'from fastapi import FastAPI\napp = FastAPI()\napp.include_router(r, prefix="/api")\n' });
    expect(routed.manifest.ingress?.routes[0]).toEqual({ path: '/api', service: 'api' });
  });

  it('emits the route only with the evidence detection found', () => {
    const detection = detectApp(repo(FULL_STACK));
    const served = (manifest: ReturnType<typeof emitManifest>['manifest']) =>
      Object.values(manifest.services).filter((s) => s.port !== undefined).map((s) => s.role ?? 'backend').sort();
    const withEvidence = emitManifest(detection.blueprint, { composeResources: detection.composeResources, ingressEvidence: detection.ingressEvidence });
    expect(served(withEvidence.manifest)).toEqual(['backend', 'frontend']);
    expect(withEvidence.manifest.ingress?.routes[0]).toEqual({ path: '/api', service: expect.any(String) });
    const without = emitManifest(detection.blueprint, { composeResources: detection.composeResources });
    expect(without.manifest.ingress).toBeUndefined();
    expect(without.notes.some((note) => note.code === 'ingress-not-inferred')).toBe(true);
  });
});
