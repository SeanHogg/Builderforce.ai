import type { Diagram, DiagramNode } from './model';

const id = '(?:"([^"]+)"|`([^`]+)`|([a-zA-Z_][\\w.]*))';
const sqlTable = new RegExp('\\bCREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?' + id, 'gi');
const sqlRef = new RegExp('\\bREFERENCES\\s+' + id, 'gi');
const drizzleTable = /\b(?:const|let)\s+(\w+)\s*=\s*(?:[\w.]+\.)?(?:pgTable|sqliteTable|mysqlTable|table)\s*\(\s*(['"`])([^\r\n]+?)\2/g;
const prismaModel = /^\s*model\s+(\w+)\s*\{/gm;

export interface SchemaSource { ref: string; path: string; text: string }

function nameOf(match: RegExpMatchArray): string {
    return (match[1] ?? match[2] ?? match[3] ?? '').toLowerCase();
}

/** Indexes explicit schema declarations and foreign-key references. Dynamic declarations stay in source. */
export function schemaDiagram(sources: readonly SchemaSource[], scopePath?: string): Diagram {
    const nodes = new Map<string, DiagramNode>(), aliases = new Map<string, Set<string>>();
    const links: { from: string; target: string; unique: boolean }[] = [];
    const declare = (source: SchemaSource, label: string, alias: string, members: string[]) => {
        const key = JSON.stringify([source.path, label]);
        nodes.set(key, { id: key, ref: source.ref, kind: 'entity', label, members: [...new Set(members)].slice(0, 40).map((text) => ({ text })) });
        for (const name of new Set([label, alias])) {
            const set = aliases.get(name) ?? new Set<string>();
            set.add(key);
            aliases.set(name, set);
        }
        return key;
    };
    for (const source of sources) {
        const text = source.text;
        if (/\.sql$/i.test(source.path)) {
            [...text.matchAll(sqlTable)].forEach((match, i, declarations) => {
                const label = nameOf(match), body = text.slice(match.index! + match[0].length, declarations[i + 1]?.index).split(/;\s*(?:\r?\n|$)/, 1)[0] ?? '';
                const members = body.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^[\w"`]+\s+\w/.test(line));
                const key = declare(source, label, label, members);
                for (const fk of body.matchAll(sqlRef)) links.push({ from: key, target: nameOf(fk), unique: false });
            });
        } else if (/\.prisma$/i.test(source.path)) {
            [...text.matchAll(prismaModel)].forEach((match, i, declarations) => {
                const label = match[1]!, body = text.slice(match.index! + match[0].length, declarations[i + 1]?.index);
                const fields = body.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^\w+\s+\w/.test(line));
                const key = declare(source, label, label, fields);
                for (const field of fields) {
                    const relationship = /^\w+\s+(\w+)\??\s+.*@relation\s*\(.*fields\s*:/.exec(field);
                    if (relationship) links.push({ from: key, target: relationship[1]!, unique: /\b@unique\b/.test(field) });
                }
            });
        } else {
            [...text.matchAll(drizzleTable)].forEach((match, i, declarations) => {
                const label = match[3]!, alias = match[1]!, body = text.slice(match.index! + match[0].length, declarations[i + 1]?.index);
                const members = body.split(/\r?\n/).map((line) => /^\s*(\w+):\s*(\w+)\s*\(/.exec(line))
                    .flatMap((field) => field ? [`${field[1]} · ${field[2]}`] : []);
                const key = declare(source, label, alias, members);
                for (const fk of body.matchAll(/\.references\s*\(\s*\(\s*\)\s*=>\s*(\w+)\.\w+/g))
                    links.push({ from: key, target: fk[1]!, unique: false });
            });
        }
    }
    const foreignKeys = links.flatMap(({ from, target, unique }) => {
        const matches = aliases.get(target);
        if (!matches || matches.size !== 1) return [];
        const to = matches.values().next().value!;
        return [{ from: to, to: from, kind: unique ? 'oneToOne' : 'oneToMany' }];
    });
    const selected = scopePath ? new Set([...nodes].filter(([key]) => (JSON.parse(key) as [string])[0] === scopePath).map(([key]) => key)) : null;
    const related = selected?.size ? new Set(foreignKeys.filter(({ from, to }) => selected.has(from) || selected.has(to)).flatMap(({ from, to }) => [from, to])) : null;
    const visible = new Set([...nodes.keys()].filter((key) => !related || selected?.has(key) || related.has(key)).slice(0, 500));
    return { nodes: [...nodes.values()].filter(({ id }) => visible.has(id)), edges: foreignKeys.filter(({ from, to }) => visible.has(from) && visible.has(to)).slice(0, 800) };
}
