/**
 * knowledge/deploy/compose.ts — a Compose file (`docker-compose*.yml`, `compose*.yml`): one container unit per
 * service — its image or build context, container ports, environment NAMES, named volumes as bindings, and
 * `depends_on` / `links` as unit → unit dependencies. Pure.
 */

import { emptyUnit, envNames, portOf, resolveFrom, uniq, type DeployUnit } from './deployModel.js';
import { arr, field, str } from './safeRecord.js';
import { isYamlMap, parseYaml, yamlMap, type YamlMap } from './yamlLite.js';

/** `depends_on` as a list or as a map of conditions; `links` as `service[:alias]`. */
function dependencies(service: YamlMap): string[] {
    const dep = service['depends_on'];
    const names = Array.isArray(dep) ? dep.map(str).filter((x): x is string => !!x) : isYamlMap(dep) ? Object.keys(dep) : [];
    for (const link of arr(service['links'])) { const s = str(link); if (s) names.push(s.split(':')[0]!); }
    return uniq(names);
}

export function parseCompose(path: string, text: string): DeployUnit[] {
    const doc = yamlMap(parseYaml(text));
    const services = yamlMap(doc['services']);
    const namedVolumes = new Set(Object.keys(yamlMap(doc['volumes'])));
    const units: DeployUnit[] = [];
    for (const [name, raw] of Object.entries(services)) {
        const s = yamlMap(raw);
        const unit = emptyUnit(name, 'container');
        const image = str(s['image']);
        const build = s['build'];
        const context = str(build) ?? str(field(build, 'context'));
        if (image) unit.runtime = image;
        if (context !== undefined) {
            const dir = resolveFrom(path, context);
            if (dir !== undefined) unit.sources.push(dir);
            if (!image) unit.runtime = 'docker build';
        }
        for (const p of arr(s['ports'])) { const port = portOf(isYamlMap(p) ? p['target'] : p); if (port) unit.ports.push(port); }
        for (const p of arr(s['expose'])) { const port = portOf(p); if (port) unit.ports.push(port); }
        unit.ports = uniq(unit.ports);
        unit.env = envNames(s['environment']);
        for (const v of arr(s['volumes'])) {
            const source = isYamlMap(v) ? str(v['source']) : str(v)?.split(':')[0];
            if (source && namedVolumes.has(source)) unit.bindings.push({ kind: 'volume', name: source });
        }
        unit.dependsOn = dependencies(s).filter((d) => d !== name && Object.hasOwn(services, d));
        units.push(unit);
    }
    return units;
}
