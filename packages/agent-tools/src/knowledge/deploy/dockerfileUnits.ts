/**
 * knowledge/deploy/dockerfileUnits.ts — a Dockerfile as ONE container unit: the final stage's base image (a stage
 * alias followed to its image), `EXPOSE`d ports, `ENV` / `ARG` names (never values or defaults), what `COPY` / `ADD`
 * bring in from the build context (taken as the Dockerfile's folder). `RUN` / `CMD` lines are never kept (one can carry
 * a credential). Pure.
 */

import { baseOf, dirOf } from '../systemPaths.js';
import { emptyUnit, portOf, resolveFrom, uniq, type DeployUnit } from './deployModel.js';

/** Instructions with their `\`-continued lines joined, comments and blank lines dropped. */
function instructions(text: string): Array<{ op: string; args: string }> {
    const out: Array<{ op: string; args: string }> = [];
    let pending = '';
    for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
        const line = raw.trim();
        if (!pending && (line === '' || line.startsWith('#'))) continue;
        if (line.startsWith('#')) continue;
        pending += pending ? ` ${line}` : line;
        if (pending.endsWith('\\')) { pending = pending.slice(0, -1).trimEnd(); continue; }
        const m = /^(\w+)\s*(.*)$/.exec(pending);
        if (m) out.push({ op: m[1]!.toUpperCase(), args: m[2]!.trim() });
        pending = '';
    }
    return out;
}

/** The words of an instruction: the exec form `["a", "b"]` or the shell form. */
function words(args: string): string[] {
    if (args.startsWith('[')) {
        try { const v: unknown = JSON.parse(args); if (Array.isArray(v)) return v.map(String); } catch { /* shell form */ }
    }
    return args.split(/\s+/).filter(Boolean);
}

/** `KEY=v KEY2=v` or the legacy `KEY value`: the names. */
function envKeys(args: string): string[] {
    if (!args.includes('=')) return [args.split(/\s+/)[0]!];
    return [...args.matchAll(/(?:^|\s)([A-Za-z_][\w.-]*)=/g)].map((m) => m[1]!);
}

/** The unit's name: the folder (or the root's `app`), or the suffix of `Dockerfile.api` / `api.Dockerfile`. */
function unitName(path: string): string {
    const name = baseOf(path);
    const suffix = /^Dockerfile[.-](.+)$/i.exec(name)?.[1] ?? /^(.+)\.dockerfile$/i.exec(name)?.[1];
    return suffix ?? (baseOf(dirOf(path)) || 'app');
}

export function parseDockerfile(path: string, text: string): DeployUnit[] {
    const steps = instructions(text);
    if (!steps.some((s) => s.op === 'FROM')) return [];
    const unit = emptyUnit(unitName(path), 'container');
    const stages = new Map<string, string>(); // alias → image
    let image: string | undefined;
    for (const { op, args } of steps) {
        if (op === 'FROM') {
            const parts = args.split(/\s+/).filter((w) => !w.startsWith('--'));
            const from = parts[0] ?? '';
            image = stages.get(from.toLowerCase()) ?? from;
            const as = parts.findIndex((w) => w.toUpperCase() === 'AS');
            if (as >= 0 && parts[as + 1]) stages.set(parts[as + 1]!.toLowerCase(), image);
            // Ports and env are the FINAL stage's; sources are every stage's (they all build it).
            unit.ports = []; unit.env = [];
        } else if (op === 'EXPOSE') {
            for (const w of args.split(/\s+/)) { const p = portOf(w); if (p) unit.ports.push(p); }
        } else if (op === 'ENV' || op === 'ARG') {
            unit.env.push(...envKeys(args).filter((k) => /^[A-Za-z_]/.test(k)));
        } else if (op === 'COPY' || op === 'ADD') {
            const ws = words(args);
            if (ws.some((w) => /^--from=/i.test(w))) continue;
            const srcs = ws.filter((w) => !w.startsWith('--')).slice(0, -1);
            for (const s of srcs) { const r = resolveFrom(path, s); if (r !== undefined) unit.sources.push(r); }
        }
    }
    if (image) unit.runtime = image;
    unit.ports = uniq(unit.ports);
    unit.env = uniq(unit.env);
    // `COPY package*.json ./x/` names a manifest glob of a folder already listed: keep the folders, files only when alone.
    unit.sources = uniq(unit.sources).filter((s, _, all) => !all.some((o) => o !== s && s.startsWith(`${o}/`)));
    return [unit];
}
