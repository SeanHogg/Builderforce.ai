/**
 * W11: ingress evidence — whether the files show the one backend answering under
 * `BACKEND_INGRESS_PATH` (`/api`). `emitManifest` writes its `/api` → backend route only on
 * that evidence: the runtime's ingress passes a path through unchanged, so a route to a
 * backend that serves at `/` (or behind a dev proxy that strips `/api`) breaks the app.
 *
 * It reads what the detectors already receive — no I/O of its own — and adds no blueprint
 * field, only `ingressEvidence` (`IngressEvidence` in `types.ts`):
 * - a frontend dev proxy for `/api` to a LOCAL backend: `vite.config.*` `server.proxy['/api']`
 *   (also `'^/api'`, `'^/api/.*'`), Angular `proxy.conf.json` / `proxy.conf.js` (object and
 *   `context` array forms) — `dev-proxy` when it forwards the path as is, `proxy-rewrite`
 *   when it has a `rewrite` / `pathRewrite`. A proxy to another host
 *   (`https://api.example.com`) says nothing about this app's backend, so it is no evidence;
 * - backend source declaring routes under `/api`: express / koa / fastify / hono / NestJS,
 *   FastAPI / Flask / Django, Laravel `routes/api.php` and Slim, ASP.NET minimal APIs and
 *   `[Route("api…")]` in `Program.cs` / `Startup.cs` — `backend-routes`.
 *
 * READ BUDGET (`blueprintSources`, every read a subrequest): its own `reads` are only the
 * dev-proxy configs and the Node backend folders' `package.json` — at most 16 entries. The
 * backend sources are asked for in the second pass (`followReads`), only under the service
 * roots the first pass shows a backend at (a Python / PHP manifest, a `.csproj`, a backend
 * folder's `package.json`, a root one naming a Node server), so a repo pays only for the
 * entry files its backends actually have.
 *
 * Text scans, deliberately conservative: a frontend's own `axios.get('/api/…')` call is not
 * a route declaration, so the JS patterns only count route-declaring receivers (`app`,
 * `router`, `server` …). Which service a file belongs to is `emitManifest`'s call: it
 * counts routes only under the backend's root and a proxy only under the frontend's.
 */

import { BACKEND_INGRESS_PATH } from '../manifest/manifestShape';
import { escapeRegExp, pathGlobRegExp } from '../pathGlob';
import type { AppDetector, IngressEvidence } from '../types';
import { pathUnder, SERVICE_ROOTS } from './serviceRoots';

/** `/api` and its bare segment `api` (NestJS `setGlobalPrefix('api')`, ASP.NET `[Route("api/[controller]")]`, Django `path('api/'`). */
const PREFIX = escapeRegExp(BACKEND_INGRESS_PATH);
const SEGMENT = escapeRegExp(BACKEND_INGRESS_PATH.replace(/^\//, ''));
/** The prefix ends there: `/api`, `/api/items`, never `/apis`. */
const END = '(?![\\w-])';

const VITE_CONFIGS = ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs'];
const PROXY_CONFS = ['proxy.conf.json', 'proxy.conf.js', 'src/proxy.conf.json'];
/** Backend entry files, relative to a service root. */
const BACKEND_SOURCES = [
  'server.js', 'server.ts', 'index.js', 'src/server.ts', 'src/main.ts',
  'main.py', 'app.py', 'app/main.py', 'urls.py',
  'routes/api.php', 'public/index.php',
  'Program.cs', 'Startup.cs',
];

/** Backend entries read only one folder down: at the root, `src/index.ts` is as often a frontend's or a library's entry. */
const NESTED_BACKEND_SOURCES = ['src/index.ts'];

/**
 * Its own first-pass reads: the dev-proxy configs at the root and one folder down (the
 * root Vite configs are the Vite detector's reads too — fetched once), and the `package.json`
 * of the backend folders, so a Node backend there is a root `followReads` looks under.
 */
const READS = [
  ...VITE_CONFIGS,
  '*/vite.config.ts', '*/vite.config.js',
  ...PROXY_CONFS,
  '*/proxy.conf.json', '*/proxy.conf.js', '*/src/proxy.conf.json',
  ...SERVICE_ROOTS.filter((root) => root !== '').map((root) => pathUnder(root, 'package.json')),
];

/**
 * The files it scans when a host hands it more than it asked for (the VS Code extension
 * hands it the workspace): the configs and backend entries at the root and one folder down,
 * plus whatever `followReads` names.
 */
const SCAN_PATTERNS = [
  ...[...VITE_CONFIGS, ...PROXY_CONFS, ...BACKEND_SOURCES].flatMap((file) => [file, `*/${file}`]),
  ...NESTED_BACKEND_SOURCES.map((file) => `*/${file}`),
].map(pathGlobRegExp);

const dirOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** `os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mysite.settings')` → `mysite/urls.py`. */
function djangoUrls(managePy: string | undefined): string[] {
  const project = /DJANGO_SETTINGS_MODULE['"]\s*,\s*['"]([\w.]+)\.settings['"]/.exec(managePy ?? '')?.[1];
  return project ? [`${project.replace(/\./g, '/')}/urls.py`] : [];
}

/** The manifests that make a service root a backend's (Python, PHP; a `.csproj` too, below). */
const BACKEND_MANIFESTS = ['requirements.txt', 'pyproject.toml', 'Pipfile', 'manage.py', 'composer.json'];
/** Node server frameworks: a ROOT `package.json` naming one is a backend (a root one without is a frontend's). */
const NODE_SERVERS = ['express', 'fastify', 'koa', 'hono', '@nestjs/core', '@hapi/hapi'];

function nodeServer(packageJson: string | undefined): boolean {
  if (packageJson === undefined) return false;
  try {
    const pkg = JSON.parse(packageJson) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
    return NODE_SERVERS.some((name) => name in (pkg.dependencies ?? {}) || name in (pkg.devDependencies ?? {}));
  } catch {
    return false; // the package.json detector reports an unreadable one
  }
}

/** Does the first pass show a backend at this service root? */
function backendAt(files: Map<string, string>, keys: readonly string[], root: string): boolean {
  if (BACKEND_MANIFESTS.some((file) => files.has(pathUnder(root, file)))) return true;
  if (keys.some((key) => dirOf(key) === root && key.endsWith('.csproj'))) return true;
  const packageJson = files.get(pathUnder(root, 'package.json'));
  return root ? packageJson !== undefined : nodeServer(packageJson);
}

/**
 * The backend sources to read in the second pass: the entry files under every service
 * root the first pass shows a backend at (`SERVICE_ROOTS`: the root and the conventional
 * backend folders). Exported for tests.
 */
export function ingressFollowReads(files: Map<string, string>): string[] {
  const keys = [...files.keys()];
  const roots = SERVICE_ROOTS.filter((root) => backendAt(files, keys, root));
  const paths = roots.flatMap((root) => [
    ...BACKEND_SOURCES,
    ...(root ? NESTED_BACKEND_SOURCES : []),
    ...djangoUrls(files.get(pathUnder(root, 'manage.py'))),
  ].map((file) => pathUnder(root, file)));
  return [...new Set(paths)];
}

/**
 * A proxy entry for the prefix: the key `'/api'` (also `'^/api'`, `'^/api/.*'`, `'/api/*'`,
 * `'/api/**'`), then its value. `scope` limits the scan to the text after the `proxy` key
 * (Vite); a proxy file is all proxy.
 */
const PROXY_KEY = new RegExp(`(['"\`])\\^?${PREFIX}(?:/\\.\\*|/\\*{1,2})?\\1\\s*:\\s*`, 'g');
const REWRITES = /\b(?:rewrite|pathRewrite)\b/;
/** `context: ['/api', …]` (Angular's array form, in a `proxy.conf.js`). */
const CONTEXT_ARRAY = /(?:^|[^\w$])['"]?context['"]?\s*:\s*\[([^\]]*)\]/g;
const CONTEXT_PREFIX = new RegExp(`(['"\`])${PREFIX}${END}`);

/** The balanced `{ … }` starting at `start` (strings are not parsed: a config's values rarely hold braces). */
function braced(text: string, start: number): string {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

/** The proxy target a value names: a string literal, or an object's `target`; null when it is not a literal. */
function targetOf(value: string): string | null {
  const literal = /^(['"`])(.*?)\1/s.exec(value);
  if (literal) return literal[2]!;
  if (!value.startsWith('{')) return null;
  const target = /(?:^|[^\w$])['"]?target['"]?\s*:\s*(?:(['"`])(.*?)\1|(\d+))/s.exec(value);
  return target ? (target[2] ?? target[3] ?? null) : null;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);

/**
 * Whether a proxy target is this machine: a bare port, a URL on a loopback host — or not
 * an absolute URL at all (a variable, a template), which says nothing either way. A
 * non-local absolute URL (`https://api.example.com`) is another app's backend.
 */
function isLocalTarget(target: string | null): boolean {
  if (target === null) return true;
  const trimmed = target.trim();
  if (/^:?\d{1,5}$/.test(trimmed)) return true;
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) return true;
  try {
    return LOCAL_HOSTS.has(new URL(trimmed).hostname);
  } catch {
    return true; // `http://localhost:${port}`: unparsable, not a non-local URL
  }
}

/**
 * The evidence one proxy entry gives: a rewrite is counter-evidence wherever it points; an
 * unrewritten forward is evidence only to a local target.
 */
function entryKind(target: string | null, rewrites: boolean): IngressEvidence['kind'] | null {
  if (rewrites) return 'proxy-rewrite';
  return isLocalTarget(target) ? 'dev-proxy' : null;
}

/** The first keyed proxy entry for the prefix in `text` (`'/api': …`), or null. */
function proxyEntry(text: string): IngressEvidence['kind'] | null {
  PROXY_KEY.lastIndex = 0;
  const match = PROXY_KEY.exec(text);
  if (!match) return null;
  const at = match.index + match[0].length;
  const value = text[at] === '{' ? braced(text, at) : text.slice(at);
  return entryKind(targetOf(value), text[at] === '{' && REWRITES.test(value));
}

/** The first `context: [ …'/api'… ]` entry in `text` (a `proxy.conf.js` array), or null. */
function contextEntry(text: string): IngressEvidence['kind'] | null {
  CONTEXT_ARRAY.lastIndex = 0;
  for (let match = CONTEXT_ARRAY.exec(text); match; match = CONTEXT_ARRAY.exec(text)) {
    if (!CONTEXT_PREFIX.test(match[1]!)) continue;
    const start = text.lastIndexOf('{', match.index);
    const entry = start === -1 ? text : braced(text, start);
    return entryKind(start === -1 ? null : targetOf(entry), REWRITES.test(entry));
  }
  return null;
}

/** A Vite config: the `server.proxy` entry for the prefix. */
function viteProxy(text: string): IngressEvidence['kind'] | null {
  const proxy = /\bproxy\s*:/.exec(text);
  return proxy ? proxyEntry(text.slice(proxy.index)) : null;
}

/** An Angular proxy file: the object form (`{ "/api": {…} }`), or the array form (`[{ "context": ["/api"], … }]`, JSON or JS). */
function angularProxy(text: string): IngressEvidence['kind'] | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) {
      const entry = parsed.find((item): item is Record<string, unknown> =>
        item !== null && typeof item === 'object'
        && Array.isArray((item as { context?: unknown }).context)
        && ((item as { context: unknown[] }).context).some((c) => typeof c === 'string' && new RegExp(`^${PREFIX}${END}`).test(c)));
      if (!entry) return null;
      return entryKind(typeof entry.target === 'string' ? entry.target : null, 'pathRewrite' in entry || 'rewrite' in entry);
    }
  } catch {
    // Not JSON (a `proxy.conf.js`): read it as text below.
  }
  return contextEntry(text) ?? proxyEntry(text);
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

/** Every file of `files` this detector scans, with what it shows about the prefix. Exported for tests. */
export function detectIngressEvidence(files: Map<string, string>): IngressEvidence[] {
  const followed = new Set(ingressFollowReads(files));
  const evidence: IngressEvidence[] = [];
  for (const [path, text] of files) {
    if (!followed.has(path) && !SCAN_PATTERNS.some((pattern) => pattern.test(path))) continue;
    const kind = evidenceOf(path, text);
    if (kind) evidence.push({ kind, file: path });
  }
  return evidence;
}

export const ingressEvidenceDetector: AppDetector = {
  id: 'ingress-evidence',
  name: 'Ingress evidence',
  reads: READS,
  followReads: ingressFollowReads,
  detect: (files) => {
    const ingressEvidence = detectIngressEvidence(files);
    return ingressEvidence.length > 0 ? { ingressEvidence } : {};
  },
};
