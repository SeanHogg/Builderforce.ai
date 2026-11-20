/**
 * W11: ingress evidence — whether the files show the one backend answering under
 * `BACKEND_INGRESS_PATH` (`/api`). `emitManifest` writes its `/api` → backend route only on
 * that evidence: the runtime's ingress passes a path through unchanged, so a route to a
 * backend that serves at `/` (or behind a dev proxy that strips `/api`) breaks the app.
 *
 * It reads what the detectors already receive (its `reads` join `blueprintSources`' list;
 * the VS Code extension hands it the workspace's files) — no I/O of its own — and adds no
 * blueprint field, only `ingressEvidence` (`IngressEvidence` in `types.ts`):
 * - a frontend dev proxy for `/api`: `vite.config.*` `server.proxy['/api']`, Angular
 *   `proxy.conf.json` / `proxy.conf.js` — `dev-proxy` when it forwards the path as is,
 *   `proxy-rewrite` when it has a `rewrite` / `pathRewrite`;
 * - backend source declaring routes under `/api`: express / koa / fastify / hono / NestJS,
 *   FastAPI / Flask / Django, Laravel `routes/api.php` and Slim, ASP.NET minimal APIs and
 *   `[Route("api…")]` controllers — `backend-routes`.
 *
 * Text scans, deliberately conservative: a frontend's own `axios.get('/api/…')` call is not
 * a route declaration, so the JS patterns only count route-declaring receivers (`app`,
 * `router`, `server` …).
 */

import { BACKEND_INGRESS_PATH } from '../manifest/manifestShape';
import { escapeRegExp, pathGlobRegExp } from '../pathGlob';
import type { AppDetector, IngressEvidence } from '../types';

/** `/api` and its bare segment `api` (NestJS `setGlobalPrefix('api')`, ASP.NET `[Route("api/[controller]")]`, Django `path('api/'`). */
const PREFIX = escapeRegExp(BACKEND_INGRESS_PATH);
const SEGMENT = escapeRegExp(BACKEND_INGRESS_PATH.replace(/^\//, ''));
/** The prefix ends there: `/api`, `/api/items`, never `/apis`. */
const END = '(?![\\w-])';

const VITE_CONFIGS = ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs'];
const PROXY_CONFS = ['proxy.conf.json', 'proxy.conf.js', 'src/proxy.conf.json'];
const BACKEND_SOURCES = [
  'server.js', 'server.ts', 'index.js', 'src/index.ts', 'src/server.ts', 'src/main.ts',
  'main.py', 'app.py', 'app/main.py', 'urls.py',
  'routes/api.php', 'public/index.php',
  'Program.cs', 'Startup.cs', 'Controllers/*.cs',
];

/** At the root and one folder down (`web/`, `api/`, `frontend/` …): exact paths at the root, globs below. */
const READS = [...VITE_CONFIGS, ...PROXY_CONFS, ...BACKEND_SOURCES].flatMap((file) => [file, `*/${file}`]);

const READ_PATTERNS = READS.map(pathGlobRegExp);

const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/**
 * A proxy entry for the prefix: the key `'/api'` (also `'^/api'`, `'/api/*'`, `'/api/**'`),
 * its value, and whether that value rewrites the path. `scope` limits the scan to the text
 * after the `proxy` key (Vite); a proxy file is all proxy.
 */
const PROXY_KEY = new RegExp(`(['"\`])\\^?${PREFIX}(?:/\\*{1,2})?\\1\\s*:\\s*`, 'g');
const REWRITES = /\b(?:rewrite|pathRewrite)\b/;

/** The balanced `{ … }` starting at `start` (strings are not parsed: a config's values rarely hold braces). */
function braced(text: string, start: number): string {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

/** `dev-proxy` / `proxy-rewrite` for the first proxy entry for the prefix in `text`, or null. */
function proxyEntry(text: string): IngressEvidence['kind'] | null {
  PROXY_KEY.lastIndex = 0;
  const match = PROXY_KEY.exec(text);
  if (!match) return null;
  const at = match.index + match[0].length;
  return text[at] === '{' && REWRITES.test(braced(text, at)) ? 'proxy-rewrite' : 'dev-proxy';
}

/** A Vite config: the `server.proxy` entry for the prefix. */
function viteProxy(text: string): IngressEvidence['kind'] | null {
  const proxy = /\bproxy\s*:/.exec(text);
  return proxy ? proxyEntry(text.slice(proxy.index)) : null;
}

/** An Angular proxy file: the object form (`{ "/api": {…} }`), or the array form (`[{ "context": ["/api"], … }]`). */
function angularProxy(text: string): IngressEvidence['kind'] | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) {
      const entry = parsed.find((item): item is Record<string, unknown> =>
        item !== null && typeof item === 'object'
        && Array.isArray((item as { context?: unknown }).context)
        && ((item as { context: unknown[] }).context).some((c) => typeof c === 'string' && new RegExp(`^${PREFIX}${END}`).test(c)));
      if (!entry) return null;
      return 'pathRewrite' in entry || 'rewrite' in entry ? 'proxy-rewrite' : 'dev-proxy';
    }
  } catch {
    // Not JSON (a `proxy.conf.js`): read it as text below.
  }
  return proxyEntry(text);
}

const quoted = (body: string): string => `(['"\`])${body}`;

/** Route declarations under the prefix, per backend language (by extension). */
const BACKEND_ROUTES: { extensions: RegExp; patterns: RegExp[] }[] = [
  {
    extensions: /\.(?:[cm]?js|ts)$/,
    patterns: [
      // app.use('/api', …), router.get('/api/items', …), server.route('/api'), fastify.register(…) below
      new RegExp(`\\b(?:app|router|server|fastify|routes?)\\s*\\.\\s*(?:use|get|post|put|patch|delete|all|route|mount)\\s*\\(\\s*${quoted(PREFIX)}${END}`),
      // fastify.register(routes, { prefix: '/api' }); new Hono().basePath('/api')
      new RegExp(`\\bprefix\\s*:\\s*${quoted(PREFIX)}${END}`),
      new RegExp(`\\.basePath\\s*\\(\\s*${quoted(PREFIX)}${END}`),
      // NestJS: app.setGlobalPrefix('api'); @Controller('api/items')
      new RegExp(`(?:\\bsetGlobalPrefix|@Controller)\\s*\\(\\s*${quoted(`/?${SEGMENT}`)}${END}`),
    ],
  },
  {
    extensions: /\.py$/,
    patterns: [
      // @app.get("/api/items"), @router.post("/api"), @bp.route("/api")
      new RegExp(`@\\w+\\.(?:get|post|put|patch|delete|route|api_route|websocket)\\s*\\(\\s*${quoted(PREFIX)}${END}`),
      // APIRouter(prefix="/api"), app.include_router(r, prefix="/api"), Blueprint(…, url_prefix="/api")
      new RegExp(`\\b(?:url_)?prefix\\s*=\\s*${quoted(PREFIX)}${END}`),
      // Django: path('api/', include(…)), re_path(r'^api/', …)
      new RegExp(`\\b(?:re_)?path\\s*\\(\\s*r?${quoted(`\\^?${SEGMENT}/`)}`),
    ],
  },
  {
    extensions: /\.php$/,
    // Slim: $app->group('/api', …), $app->get('/api/items', …)
    patterns: [new RegExp(`->\\s*(?:get|post|put|patch|delete|group|map|any)\\s*\\(\\s*${quoted(PREFIX)}${END}`)],
  },
  {
    extensions: /\.cs$/,
    patterns: [
      // app.MapGet("/api/items", …), app.MapGroup("/api")
      new RegExp(`\\.Map(?:Get|Post|Put|Patch|Delete|Group|Methods)?\\s*\\(\\s*"/?${SEGMENT}${END}`),
      // [Route("api/[controller]")]
      new RegExp(`\\[Route\\s*\\(\\s*"/?${SEGMENT}${END}`),
    ],
  },
];

/** Laravel serves `routes/api.php` under `/api` by default: the file is the evidence. */
const LARAVEL_API_ROUTES = /(?:^|\/)routes\/api\.php$/;

function backendRoutes(path: string, text: string): boolean {
  if (LARAVEL_API_ROUTES.test(path)) return true;
  return BACKEND_ROUTES.some(({ extensions, patterns }) => extensions.test(path) && patterns.some((pattern) => pattern.test(text)));
}

/** The evidence one file holds, or null. */
function evidenceOf(path: string, text: string): IngressEvidence['kind'] | null {
  const name = fileName(path);
  if (VITE_CONFIGS.includes(name)) return viteProxy(text);
  if (name.startsWith('proxy.conf.')) return angularProxy(text);
  return backendRoutes(path, text) ? 'backend-routes' : null;
}

/** Every file of `files` this detector reads, with what it shows about the prefix. Exported for tests. */
export function detectIngressEvidence(files: Map<string, string>): IngressEvidence[] {
  const evidence: IngressEvidence[] = [];
  for (const [path, text] of files) {
    if (!READ_PATTERNS.some((pattern) => pattern.test(path))) continue;
    const kind = evidenceOf(path, text);
    if (kind) evidence.push({ kind, file: path });
  }
  return evidence;
}

export const ingressEvidenceDetector: AppDetector = {
  id: 'ingress-evidence',
  name: 'Ingress evidence',
  reads: READS,
  detect: (files) => {
    const ingressEvidence = detectIngressEvidence(files);
    return ingressEvidence.length > 0 ? { ingressEvidence } : {};
  },
};
