/**
 * knowledge/deploy/redactDescriptor.ts — a deploy descriptor's text as it may be INDEXED: keys, table headers,
 * instructions and structure kept, every value blanked to {@link REDACTED} unless its key is one that names structure
 * (an image, a binding, a port, a path, a schedule …: {@link SAFE_KEYS}). Env / vars / `ARG` defaults / `env[].value`
 * / compose `environment`, command lines and anything else that could carry a credential is therefore never indexed —
 * an allow-list, so a secret under a key nobody anticipated is blanked too. Pure.
 */

import type { DescriptorKind } from './deployModel.js';
import { isSafeKey } from './safeRecord.js';

export const REDACTED = '***';

/** Keys whose values name structure, never a secret. Compared lower-cased. */
const SAFE_KEYS = new Set([
    'name', 'image', 'kind', 'apiversion', 'main', 'module', 'compatibility_date', 'binding', 'class_name', 'bucket_name',
    'database_name', 'queue', 'service', 'index_name', 'dataset', 'runtime', 'handler', 'uses', 'runs-on', 'needs',
    'depends_on', 'links', 'context', 'dockerfile', 'build', 'app', 'primary_region', 'internal_port', 'port', 'ports',
    'containerport', 'targetport', 'protocol', 'schedule', 'cron', 'crons', 'path', 'pages_build_output_dir',
    'working-directory', 'workingdirectory', 'source', 'destination', 'target', 'published', 'restart', 'replicas',
    'namespace', 'type', 'rate', 'use', 'src', 'script_name', 'tag', 'new_sqlite_classes', 'new_classes', 'routes',
    'pattern', 'zone_name', 'branches', 'tags', 'expose', 'volumes', 'claimname', 'mountpath', 'version', 'bin',
    'workspaces', 'packages', 'engines', 'node', 'framework', 'outputdirectory', 'functions', 'selector', 'app.kubernetes.io/name',
    'dependencies', 'devdependencies', 'peerdependencies', 'optionaldependencies', 'exports', 'types', 'private', 'license',
]);
/** JSON objects whose every entry is structure (package names → versions, command names → files). */
const SAFE_MAPS = new Set(['dependencies', 'devdependencies', 'peerdependencies', 'optionaldependencies', 'engines', 'bin', 'exports']);
/** Dockerfile instructions whose arguments are structure. */
const SAFE_INSTRUCTIONS = new Set(['FROM', 'COPY', 'ADD', 'EXPOSE', 'WORKDIR', 'VOLUME', 'USER', 'STOPSIGNAL', 'SHELL', 'ONBUILD']);

const safeKey = (key: string): boolean => SAFE_KEYS.has(key.trim().replace(/^["']|["']$/g, '').toLowerCase());
const indentOf = (line: string): number => line.length - line.trimStart().length;

/** `KEY=value` → `KEY=***` for every assignment in a space-separated run; other words kept. */
const blankAssignments = (text: string): string => text.replace(/\b([A-Za-z_][\w.-]{0,127})=(?:"[^"\n]*"|'[^'\n]*'|\S*)/g, `$1=${REDACTED}`);

/** YAML: values under unsafe keys (and every line of an unsafe block) blanked; `- KEY=value` items keep only the key. */
function redactYaml(text: string): string {
    const stack: Array<{ indent: number; safe: boolean }> = [];
    let blockUnder = -1; // indent of the key whose block scalar is being blanked
    return text.split('\n').map((line) => {
        const t = line.trim();
        const indent = indentOf(line);
        if (blockUnder >= 0) { if (t === '' || indent > blockUnder) return t === '' ? line : `${' '.repeat(indent)}${REDACTED}`; blockUnder = -1; }
        if (t === '' || t.startsWith('#') || t === '---') return line;
        const isItem = t === '-' || t.startsWith('- ');
        for (let top = stack[stack.length - 1]; top && (top.indent > indent || (top.indent === indent && !isItem)); top = stack[stack.length - 1]) stack.pop();
        const parentSafe = stack.length > 0 ? stack[stack.length - 1]!.safe : true;
        const item = isItem ? t.slice(1).trimStart() : t;
        const prefix = line.slice(0, line.length - item.length);
        const colon = item.indexOf(': ');
        const bareKey = item.endsWith(':') ? item.slice(0, -1) : undefined;
        if (bareKey !== undefined && !bareKey.includes(' ')) { stack.push({ indent, safe: safeKey(bareKey) }); return line; }
        if (colon > 0 && !item.slice(0, colon).includes(' ')) {
            const key = item.slice(0, colon);
            const value = item.slice(colon + 2).trim();
            const safe = safeKey(key);
            if (/^[|>][+-]?\d*$/.test(value)) { if (!safe) blockUnder = indent; return line; }
            return safe ? line : `${prefix}${key}: ${REDACTED}`;
        }
        // A scalar list item: kept under a safe parent; an assignment keeps only its key.
        if (isItem) return parentSafe ? prefix + blankAssignments(item) : `${prefix}${item.includes('=') ? blankAssignments(item) : REDACTED}`;
        return parentSafe ? line : `${' '.repeat(indent)}${REDACTED}`;
    }).join('\n');
}

/** TOML: `key = value` blanked unless the key is safe; a multi-line value of an unsafe key blanked line by line. */
function redactToml(text: string): string {
    let blanking = 0; // open brackets of an unsafe multi-line value
    return text.split('\n').map((line) => {
        const t = line.trim();
        if (blanking > 0) {
            blanking += (t.match(/[[{]/g)?.length ?? 0) - (t.match(/[\]}]/g)?.length ?? 0);
            return t === '' ? line : `${' '.repeat(indentOf(line))}${REDACTED}`;
        }
        if (t === '' || t.startsWith('#') || t.startsWith('[')) return line;
        const eq = line.indexOf('=');
        if (eq < 0) return line;
        const key = line.slice(0, eq).trim();
        const lastSeg = key.split('.').pop() ?? key;
        if (safeKey(lastSeg)) return line;
        const value = line.slice(eq + 1);
        const open = (value.match(/[[{]/g)?.length ?? 0) - (value.match(/[\]}]/g)?.length ?? 0);
        if (open > 0) blanking = open;
        return `${line.slice(0, eq)}= ${open > 0 ? `${value.trim()[0]}${REDACTED}` : `"${REDACTED}"`}`;
    }).join('\n');
}

/** Dockerfile: structural instructions kept; ENV / ARG keep names; everything else (RUN, CMD, LABEL …) blanked. */
function redactDockerfile(text: string): string {
    let continuing = false;
    let safeRun = false;
    return text.split('\n').map((line) => {
        const t = line.trim();
        if (!continuing && (t === '' || t.startsWith('#'))) return line;
        if (!continuing) {
            const op = /^(\w+)/.exec(t)?.[1]?.toUpperCase() ?? '';
            safeRun = SAFE_INSTRUCTIONS.has(op);
            continuing = t.endsWith('\\');
            if (safeRun) return line;
            if (op === 'ENV' || op === 'ARG') {
                const args = t.slice(op.length).trim();
                return `${op} ${args.includes('=') ? blankAssignments(args) : `${args.split(/\s+/)[0] ?? ''}${args.includes(' ') ? ` ${REDACTED}` : ''}`}`;
            }
            return `${op} ${REDACTED}`;
        }
        continuing = t.endsWith('\\');
        return safeRun ? line : `${' '.repeat(indentOf(line))}${REDACTED}`;
    }).join('\n');
}

/** JSON(C): parsed and re-written with every value under an unsafe key blanked; unparseable text is blanked whole. */
function redactJson(text: string, parse: (t: string) => unknown): string {
    /** `keep`: this value's key is safe; `safeMap`: every entry of this object keeps its value (dependency maps, `bin`). */
    const walk = (v: unknown, keep: boolean, safeMap: boolean, depth: number): unknown => {
        if (depth > 64) return REDACTED;
        if (Array.isArray(v)) return v.map((x) => walk(x, keep, false, depth + 1));
        if (v && typeof v === 'object') {
            const out: Record<string, unknown> = {};
            for (const [k, x] of Object.entries(v)) {
                if (isSafeKey(k)) out[k] = walk(x, safeMap || safeKey(k), SAFE_MAPS.has(k.toLowerCase()), depth + 1);
            }
            return out;
        }
        return keep || typeof v === 'boolean' || v === null ? v : REDACTED;
    };
    const parsed = parse(text);
    return parsed === undefined ? REDACTED : JSON.stringify(walk(parsed, false, false, 0), null, 2);
}

/** Procfile: each process keeps its type and program; the rest of its command is blanked. */
const redactProcfile = (text: string): string => text.split('\n').map((line) => {
    const m = /^(\s*[A-Za-z0-9_-]+\s*:\s*)(.*)$/.exec(line);
    if (!m) return line;
    const program = m[2]!.split(/\s+/).find((w) => w !== '' && !w.includes('=') && !w.startsWith('-')) ?? '';
    return `${m[1]}${program} ${REDACTED}`.trimEnd();
}).join('\n');

/** The descriptor's text with its values redacted (see the file comment). `parseJson` is the JSONC reader. */
export function redactDescriptorText(kind: DescriptorKind, path: string, text: string, parseJson: (t: string) => unknown): string {
    const normal = text.replace(/\r\n?/g, '\n');
    switch (kind) {
        case 'dockerfile': return redactDockerfile(normal);
        case 'procfile': return redactProcfile(normal);
        case 'package': case 'vercel': return redactJson(normal, parseJson);
        case 'wrangler': case 'fly': return /\.jsonc?$/i.test(path) ? redactJson(normal, parseJson) : redactToml(normal);
        case 'compose': case 'kubernetes': case 'serverless': case 'workflow': return redactYaml(normal);
    }
}
