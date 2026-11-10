/**
 * knowledge/deploy/procfile.ts — a `Procfile` (Heroku, Dokku, foreman): one service unit per process type
 * (`web: node server.js`): the program it runs as its runtime, the files the command names as its entry, and the port
 * a `--port N` / `-p N` states. The command line itself is not kept, and no `KEY=value` token is ever read as the
 * program (`web: TOKEN=s3cret node app.js` runs `node`). A process type repeated further down keys as
 * `<name>@L<line>`, so the first one keeps its key. Pure.
 */

import { commandEntries, emptyUnit, portOf, resolveFrom, type DeployUnit } from './deployModel.js';

export function parseProcfile(path: string, text: string): DeployUnit[] {
    const units: DeployUnit[] = [];
    const seen = new Set<string>();
    text.replace(/\r\n?/g, '\n').split('\n').forEach((line, i) => {
        const m = /^([A-Za-z0-9_-]+)\s*:\s*(.+)$/.exec(line.trim());
        if (!m) return;
        const name = m[1]!;
        const unit = emptyUnit(name, 'service', seen.has(name) ? `${name}@L${i + 1}` : name);
        seen.add(name);
        const command = m[2]!.trim();
        const program = command.split(/\s+/).find((w) => w !== '' && !w.includes('=') && !w.startsWith('-'));
        if (program) unit.runtime = program;
        for (const e of commandEntries(command)) { const r = resolveFrom(path, e); if (r) unit.sources.push(r); }
        const port = portOf(/(?:--port|-p)[=\s]+(\d{1,5})\b/.exec(command)?.[1]);
        if (port) unit.ports.push(port);
        units.push(unit);
    });
    return units;
}
