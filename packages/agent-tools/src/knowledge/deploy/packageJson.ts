/**
 * knowledge/deploy/packageJson.ts — what a `package.json` deploys: one CLI unit per `bin` command (key `bin:<name>`,
 * its script file), and a service unit (key `start`) when `scripts.start` runs something (its entry: the files the
 * command names, else `main`, else the package folder; a `--port` / `-p` / `-l` / `PORT=` in it is its port;
 * `engines.node` is its runtime). A `workspaces` root deploys nothing itself: its workspace globs are returned so the
 * file node can say so. Pure.
 */

import { parseJsonc } from '../jsonc.js';
import { baseOf, dirOf } from '../systemPaths.js';
import { commandEntries, emptyUnit, portOf, resolveFrom, uniq, type DeployUnit } from './deployModel.js';
import { arr, field, obj, str } from './safeRecord.js';

/** The port a start command states (`serve -l 3000`, `next start -p 8080`, `PORT=4000 node …`). */
const START_PORT = /(?:--port|-p|-l|--listen|PORT=)[=\s]*(\d{2,5})\b/;

export interface PackageDeploy {
    units: DeployUnit[];
    /** The `workspaces` globs (array or `{ packages }`), as written. */
    workspaces: string[];
}

export function parsePackageJson(path: string, text: string): PackageDeploy {
    const pkg = parseJsonc(text);
    const units: DeployUnit[] = [];
    const pkgName = str(field(pkg, 'name')) ?? (baseOf(dirOf(path)) || 'package');
    const node = str(field(field(pkg, 'engines'), 'node'));
    const runtime = node ? `node ${node}` : 'node';
    const bin = field(pkg, 'bin');
    const bins: Array<[string, string]> = typeof bin === 'string'
        ? [[pkgName.replace(/^@[^/]+\//, ''), bin]]
        : Object.entries(obj(bin)).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v] as [string, string]] : []));
    for (const [name, file] of bins) {
        const unit = emptyUnit(name, 'cli', `bin:${name}`);
        unit.runtime = runtime;
        const source = resolveFrom(path, file);
        if (source) unit.sources.push(source);
        units.push(unit);
    }
    const start = str(field(field(pkg, 'scripts'), 'start'));
    if (start) {
        const unit = emptyUnit(pkgName, 'service', 'start');
        unit.runtime = runtime;
        const entries = commandEntries(start).map((e) => resolveFrom(path, e)).filter((e): e is string => !!e);
        const main = str(field(pkg, 'main'));
        const fallback = resolveFrom(path, main ?? '.');
        unit.sources = uniq(entries.length > 0 ? entries : fallback !== undefined ? [fallback] : []);
        const port = portOf(START_PORT.exec(start)?.[1]);
        if (port) unit.ports.push(port);
        units.push(unit);
    }
    const ws = field(pkg, 'workspaces');
    const workspaces = (Array.isArray(ws) ? ws : arr(field(ws, 'packages'))).filter((w): w is string => typeof w === 'string');
    return { units, workspaces };
}
