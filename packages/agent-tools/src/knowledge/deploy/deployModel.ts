/**
 * knowledge/deploy/deployModel.ts — what a deploy descriptor says, as data (the 4+1 Physical view, PRD 43 B1a rule 8):
 * the descriptor families this package reads, recognised by PATH alone (the parser registry picks a pack without a
 * read), and the deployable unit each parser returns.
 *
 * A unit holds NAMES only: env var names, never their values; binding names and the resource they name, never an id
 * or a secret; no command line (one can carry a literal credential). Paths are root-relative (the parser resolves them
 * against the descriptor's folder). Pure.
 */

import { baseOf, dirOf, joinRootPath } from '../systemPaths.js';
import { field, str } from './safeRecord.js';

export type DescriptorKind =
    | 'dockerfile' | 'compose' | 'wrangler' | 'kubernetes' | 'procfile' | 'fly' | 'vercel' | 'serverless' | 'package' | 'workflow';

export type UnitKind = 'container' | 'worker' | 'function' | 'service' | 'cli' | 'workflow';

/** What a binding names: a platform store, a queue, an object class, another service or a mounted volume. */
export type BindingKind =
    | 'kv' | 'd1' | 'r2' | 'queue' | 'durable-object' | 'ai' | 'vectorize' | 'hyperdrive' | 'analytics'
    | 'images' | 'browser' | 'service' | 'volume' | 'database' | 'topic';

export interface DeployBinding {
    kind: BindingKind;
    /** The name the code reads it by (the env binding, the volume name). */
    name: string;
    /** The resource it names (bucket, database, queue, object class, service); absent = it has no identity beyond its descriptor. */
    resource?: string;
    /** Queues only: whether the unit sends to it or consumes it. */
    direction?: 'produces' | 'consumes';
}

export interface DeployUnit {
    /**
     * The unit's identity within its descriptor, stable when other units are added: the service / job / function key,
     * `<namespace>/<Kind>/<name>` for a k8s object, `<name>@L<line>` for a repeated Procfile process.
     */
    key: string;
    name: string;
    kind: UnitKind;
    /** Base image, runtime or platform (`node:22-alpine`, `cloudflare-workers`, `nodejs20.x`). */
    runtime?: string;
    ports: number[];
    /** Environment variable NAMES the descriptor declares (values are never read). */
    env: string[];
    bindings: DeployBinding[];
    /** Schedules (cron expressions or `rate(…)`). */
    cron: string[];
    /** Root-relative files or folders the unit builds from or runs (its entry). */
    sources: string[];
    /** Keys of other units of the SAME descriptor it depends on or links to. */
    dependsOn: string[];
}

/** A unit with every list empty: what each parser starts from. Its key is its name unless stated. */
export function emptyUnit(name: string, kind: UnitKind, key: string = name): DeployUnit {
    return { key, name, kind, ports: [], env: [], bindings: [], cron: [], sources: [], dependsOn: [] };
}

/** Folders whose YAML is read as Kubernetes manifests (the content still has to say `apiVersion` + `kind`). */
const K8S_DIRS = /(^|\/)(k8s|kube|kubernetes|manifests|deploy|deployment|deployments|charts?)(\/|$)/i;
const K8S_NAME = /(^|[-_.])(deployment|deploy|service|svc|statefulset|daemonset|cronjob|job|ingress|pod)([-_.]|$)/i;
const YAML = /\.ya?ml$/i;
/** A source or doc file is never a descriptor, whatever its name (`dockerfile.ts`, `procfile.md`). */
const SOURCE_EXT = /\.(m?[jt]sx?|c[jt]s|py|go|rs|rb|java|kt|cs|php|swift|scala|sh|md|mdx|txt|json5?|lock)$/i;

/** The descriptor family a root-relative path is, by its name and folder; undefined for any other file. */
export function descriptorKindOf(path: string): DescriptorKind | undefined {
    const p = path.replace(/\\/g, '/');
    const name = baseOf(p);
    if (name === 'package.json') return 'package';
    if (name === 'vercel.json') return 'vercel';
    if (/^wrangler\.jsonc?$/i.test(name)) return 'wrangler';
    if (SOURCE_EXT.test(name)) return undefined;
    if (/^Dockerfile([.-][\w.-]+)?$/i.test(name) || /\.dockerfile$/i.test(name)) return 'dockerfile';
    if (/^(docker-)?compose([.-][\w.-]+)?\.ya?ml$/i.test(name)) return 'compose';
    if (/^wrangler\.toml$/i.test(name)) return 'wrangler';
    if (name === 'Procfile' || /^Procfile\.[\w-]+$/.test(name)) return 'procfile';
    if (name === 'fly.toml') return 'fly';
    if (/^serverless\.ya?ml$/i.test(name)) return 'serverless';
    if (/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i.test(p)) return 'workflow';
    if (YAML.test(name) && (K8S_DIRS.test(dirOf(p)) || K8S_NAME.test(name.replace(YAML, '')))) return 'kubernetes';
    return undefined;
}

/**
 * `target` as written in the descriptor at `descriptorPath`, as a root-relative path: `./` and `..` resolved, a
 * trailing `/` and any glob tail dropped (`api/*.js` → `api`). Undefined when it leaves the root or is a URL/absolute.
 */
export function resolveFrom(descriptorPath: string, target: string): string | undefined {
    const t = target.trim().replace(/\\/g, '/');
    if (!t || /^[a-z][\w+.-]*:\/\//i.test(t) || t.startsWith('/') || t.startsWith('$') || t.startsWith('~')) return undefined;
    const glob = t.search(/[*?{[]/);
    // A glob keeps only its folder part: `api/*.js` → `api`, `src/handler*.ts` → `src`.
    const literal = glob < 0 ? t : t.slice(0, glob).slice(0, Math.max(0, t.slice(0, glob).lastIndexOf('/')));
    return joinRootPath(dirOf(descriptorPath), literal);
}

/** Distinct values, input order. */
export const uniq = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

/** A port number from `3000`, `"8080/tcp"`, `"127.0.0.1:80:8080"` (the container side: the last part). */
export function portOf(v: unknown): number | undefined {
    const text = typeof v === 'number' ? String(v) : typeof v === 'string' ? v : '';
    const last = text.split(':').pop()?.replace(/\/\w+$/, '').split('-')[0] ?? '';
    const n = Number(last);
    return Number.isInteger(n) && n > 0 && n < 65536 ? n : undefined;
}

/** Env var names from a `KEY=value` list, a `{ KEY: value }` map, or a k8s `[{ name, value }]` list. Values are never read. */
export function envNames(v: unknown): string[] {
    const names: string[] = [];
    if (Array.isArray(v)) {
        for (const item of v) {
            if (typeof item === 'string') names.push(item.split('=')[0]!.trim());
            else { const name = str(field(item, 'name')); if (name) names.push(name); }
        }
    } else if (v && typeof v === 'object') names.push(...Object.keys(v));
    return uniq(names.filter((n) => /^[A-Za-z_][\w.-]{0,127}$/.test(n)));
}

const PATH_TOKEN = /^[\w@./-]+$/;
const SCRIPT_EXT = /\.(m?[jt]s|cjs|py|rb|go|sh)$/;
/** Files a shell command line names as its entry (`node dist/server.js`, `python app.py`, `./bin/run`). Never a `KEY=value`. */
export function commandEntries(command: string): string[] {
    return uniq(command.split(/\s+/).filter((tok) =>
        !tok.includes('=') && PATH_TOKEN.test(tok) && !tok.startsWith('-') && (SCRIPT_EXT.test(tok) || tok.startsWith('./'))));
}
