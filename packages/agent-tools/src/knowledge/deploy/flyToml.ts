/**
 * knowledge/deploy/flyToml.ts — a Fly.io `fly.toml` as ONE service unit: the app, its image or Dockerfile build, the
 * internal ports of `[http_service]` / `[[services]]`, `[env]` NAMES, `[[mounts]]` as volume bindings and the
 * entry files the `[processes]` commands name (the commands themselves are not kept). Pure.
 */

import { baseOf, dirOf } from '../systemPaths.js';
import { commandEntries, emptyUnit, portOf, resolveFrom, uniq, type DeployUnit } from './deployModel.js';
import { arr, field, obj, str } from './safeRecord.js';
import { parseToml } from './tomlLite.js';

export function parseFlyToml(path: string, text: string): DeployUnit[] {
    const config = parseToml(text);
    const unit = emptyUnit(str(field(config, 'app')) ?? (baseOf(dirOf(path)) || 'app'), 'service');
    const build = field(config, 'build');
    const image = str(field(build, 'image'));
    const dockerfile = str(field(build, 'dockerfile'));
    unit.runtime = image ?? (dockerfile ? 'docker build' : 'fly-machines');
    const source = resolveFrom(path, dockerfile ? dirOf(dockerfile) || '.' : '.');
    if (source !== undefined) unit.sources.push(source);
    const ports = [field(field(config, 'http_service'), 'internal_port'), ...arr(field(config, 'services')).map((s) => field(s, 'internal_port'))];
    unit.ports = uniq(ports.map(portOf).filter((p): p is number => p !== undefined));
    unit.env = Object.keys(obj(field(config, 'env')));
    for (const m of arr(field(config, 'mounts'))) {
        const volume = str(field(m, 'source'));
        if (volume) unit.bindings.push({ kind: 'volume', name: volume });
    }
    const processes = Object.values(obj(field(config, 'processes'))).map(str).filter((c): c is string => !!c);
    for (const entry of processes.flatMap(commandEntries)) { const r = resolveFrom(path, entry); if (r) unit.sources.push(r); }
    unit.sources = uniq(unit.sources);
    return [unit];
}
