/**
 * knowledge/deploy/wrangler.ts — a Cloudflare `wrangler.toml` / `wrangler.json[c]` as ONE unit: a Worker (its `main`)
 * or a Pages project (`pages_build_output_dir`), with every binding the code reads — KV, D1, R2, queues (producer and
 * consumer), Durable Objects, service bindings, AI, Vectorize, Hyperdrive, Analytics Engine, Images, Browser — its cron
 * triggers and its `[vars]` NAMES. Named environments (`[env.*]`) are folded in: one deployable, its bindings in any
 * environment. Ids and var values are never read. Pure.
 */

import { parseJsonc } from '../jsonc.js';
import { baseOf, dirOf } from '../systemPaths.js';
import { emptyUnit, resolveFrom, uniq, type BindingKind, type DeployBinding, type DeployUnit } from './deployModel.js';
import { arr, field, obj, str } from './safeRecord.js';
import { parseToml } from './tomlLite.js';

/** Per list-valued binding key: the kind, the field naming the binding, and the field naming the resource. */
const LIST_BINDINGS: ReadonlyArray<[key: string, kind: BindingKind, name: string, resource?: string]> = [
    ['kv_namespaces', 'kv', 'binding'],
    ['d1_databases', 'd1', 'binding', 'database_name'],
    ['r2_buckets', 'r2', 'binding', 'bucket_name'],
    ['services', 'service', 'binding', 'service'],
    ['vectorize', 'vectorize', 'binding', 'index_name'],
    ['hyperdrive', 'hyperdrive', 'binding'],
    ['analytics_engine_datasets', 'analytics', 'binding', 'dataset'],
];
/** Single-table bindings (`[ai] binding = "AI"`). */
const ONE_BINDINGS: ReadonlyArray<[key: string, kind: BindingKind]> = [['ai', 'ai'], ['images', 'images'], ['browser', 'browser']];

/** The bindings one config level (the top or one `env.<name>`) declares. */
function bindingsOf(level: unknown): { bindings: DeployBinding[]; cron: string[]; vars: string[] } {
    const bindings: DeployBinding[] = [];
    const named = (kind: BindingKind, name: string | undefined, resource?: string, direction?: DeployBinding['direction']): void => {
        if (!name) return;
        bindings.push({ kind, name, ...(resource ? { resource } : {}), ...(direction ? { direction } : {}) });
    };
    for (const [key, kind, nameKey, resourceKey] of LIST_BINDINGS) {
        for (const b of arr(field(level, key))) named(kind, str(field(b, nameKey)), resourceKey ? str(field(b, resourceKey)) : undefined);
    }
    for (const [key, kind] of ONE_BINDINGS) named(kind, str(field(field(level, key), 'binding')));
    for (const d of arr(field(field(level, 'durable_objects'), 'bindings'))) named('durable-object', str(field(d, 'name')), str(field(d, 'class_name')));
    const queues = field(level, 'queues');
    for (const p of arr(field(queues, 'producers'))) named('queue', str(field(p, 'binding')) ?? str(field(p, 'queue')), str(field(p, 'queue')), 'produces');
    for (const c of arr(field(queues, 'consumers'))) named('queue', str(field(c, 'queue')), str(field(c, 'queue')), 'consumes');
    const cron = arr(field(field(level, 'triggers'), 'crons')).map(str).filter((c): c is string => !!c);
    return { bindings, cron, vars: Object.keys(obj(field(level, 'vars'))) };
}

/** The config as records, from TOML or JSON(C); undefined when it is neither. */
function configOf(path: string, text: string): object | undefined {
    if (/\.toml$/i.test(path)) return parseToml(text);
    const v = parseJsonc(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
}

const sameBinding = (a: DeployBinding, b: DeployBinding): boolean =>
    a.kind === b.kind && a.name === b.name && a.resource === b.resource && a.direction === b.direction;

export function parseWrangler(path: string, text: string): DeployUnit[] {
    const config = configOf(path, text);
    if (!config) return [];
    const main = str(field(config, 'main'));
    const pages = str(field(config, 'pages_build_output_dir'));
    const name = str(field(config, 'name')) ?? (baseOf(dirOf(path)) || 'worker');
    const isPages = !!pages && !main;
    const unit = emptyUnit(name, isPages ? 'service' : 'worker');
    unit.runtime = isPages ? 'cloudflare-pages' : 'cloudflare-workers';
    const entry = resolveFrom(path, main ?? '.');
    if (entry !== undefined) unit.sources.push(entry);
    const levels = [config, ...Object.values(obj(field(config, 'env')))];
    for (const level of levels) {
        const found = bindingsOf(level);
        for (const b of found.bindings) if (!unit.bindings.some((x) => sameBinding(x, b))) unit.bindings.push(b);
        unit.cron.push(...found.cron);
        unit.env.push(...found.vars);
    }
    unit.cron = uniq(unit.cron);
    unit.env = uniq(unit.env);
    return [unit];
}
