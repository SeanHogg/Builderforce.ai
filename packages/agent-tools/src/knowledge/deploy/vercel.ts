/**
 * knowledge/deploy/vercel.ts — a `vercel.json` as ONE function unit (a Vercel project): the function sources
 * (`functions` keys, legacy `builds[].src`), their runtime (`functions.*.runtime`, `builds[].use`) and `crons`.
 * `env` / `build.env` contribute NAMES only. Pure.
 */

import { parseJsonc } from '../jsonc.js';
import { baseOf, dirOf } from '../systemPaths.js';
import { emptyUnit, resolveFrom, uniq, type DeployUnit } from './deployModel.js';
import { arr, field, obj, str } from './safeRecord.js';

export function parseVercel(path: string, text: string): DeployUnit[] {
    const config = parseJsonc(text);
    if (!config || typeof config !== 'object' || Array.isArray(config)) return [];
    const unit = emptyUnit(str(field(config, 'name')) ?? (baseOf(dirOf(path)) || 'vercel'), 'function');
    const runtimes: string[] = [];
    for (const [glob, fn] of Object.entries(obj(field(config, 'functions')))) {
        const r = resolveFrom(path, glob);
        if (r !== undefined) unit.sources.push(r);
        const runtime = str(field(fn, 'runtime'));
        if (runtime) runtimes.push(runtime);
    }
    for (const b of arr(field(config, 'builds'))) {
        const src = str(field(b, 'src'));
        const r = src === undefined ? undefined : resolveFrom(path, src);
        if (r) unit.sources.push(r);
        const use = str(field(b, 'use'));
        if (use) runtimes.push(use);
    }
    if (unit.sources.length === 0) { const here = resolveFrom(path, '.'); if (here !== undefined) unit.sources.push(here); }
    unit.sources = uniq(unit.sources);
    unit.runtime = uniq(runtimes).join(',') || 'vercel';
    unit.cron = arr(field(config, 'crons')).map((x) => str(field(x, 'schedule'))).filter((s): s is string => !!s);
    unit.env = uniq([...Object.keys(obj(field(config, 'env'))), ...Object.keys(obj(field(field(config, 'build'), 'env')))]);
    return [unit];
}
