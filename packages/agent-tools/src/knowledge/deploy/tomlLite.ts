/**
 * knowledge/deploy/tomlLite.ts — the TOML subset `wrangler.toml` and `fly.toml` are written in: `[table]` and
 * `[[array.of.tables]]` headers (dotted, quoted segments), `key = value` with dotted keys, basic / literal / multi-line
 * strings, numbers, booleans, arrays (multi-line too) and inline tables. Dates read as strings.
 *
 * Not a TOML implementation: a document that breaks a rule TOML enforces (a redefined table) is read leniently.
 * Hardened for untrusted text: tables are prototype-free and never take `__proto__` / `constructor` / `prototype`
 * segments (`safeRecord.ts`); a value continued over lines is scanned once, incrementally (an unclosed `[` costs
 * linear time); nesting stops at {@link MAX_DEPTH}; it never throws. Pure: no I/O, no dependency.
 */

import { isSafeKey, own, record, setKey } from './safeRecord.js';

export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
export type TomlTable = { [key: string]: TomlValue };

/** Deepest nesting of arrays / inline tables read; deeper content reads as its raw text. */
const MAX_DEPTH = 64;

/** Incremental scan state over a value's text: bracket depth and whether a string is open. */
class ScanState {
    depth = 0;
    quote = '';
    triple = '';
    /** Feeds `text` (one line, no newline) and returns this state. */
    feed(text: string): this {
        for (let i = 0; i < text.length; i += 1) {
            const c = text[i]!;
            if (this.triple) {
                if (text.startsWith(this.triple, i)) { i += 2; this.triple = ''; }
                continue;
            }
            if (this.quote) {
                if (c === '\\' && this.quote === '"') { i += 1; continue; }
                if (c === this.quote) this.quote = '';
                continue;
            }
            if ((c === '"' || c === "'") && text.startsWith(c.repeat(3), i)) { this.triple = c.repeat(3); i += 2; continue; }
            if (c === '"' || c === "'") this.quote = c;
            else if (c === '#') return this;
            else if (c === '[' || c === '{') this.depth += 1;
            else if (c === ']' || c === '}') this.depth -= 1;
        }
        // A single-line string never spans lines.
        this.quote = '';
        return this;
    }
    get open(): boolean { return this.depth > 0 || this.triple !== ''; }
}

/** The line without its `#` comment (outside strings). */
function stripComment(line: string): string {
    let quote = '';
    for (let i = 0; i < line.length; i += 1) {
        const c = line[i]!;
        if (quote) { if (c === '\\' && quote === '"') i += 1; else if (c === quote) quote = ''; continue; }
        if (c === '"' || c === "'") quote = c;
        else if (c === '#') return line.slice(0, i);
    }
    return line;
}

/** Splits at top-level `sep` (outside strings and brackets). */
function splitTop(body: string, sep: string): string[] {
    const parts: string[] = [];
    let depth = 0, quote = '', start = 0;
    for (let i = 0; i < body.length; i += 1) {
        const c = body[i]!;
        if (quote) { if (c === '\\' && quote === '"') i += 1; else if (c === quote) quote = ''; continue; }
        if (c === '"' || c === "'") quote = c;
        else if (c === '[' || c === '{') depth += 1;
        else if (c === ']' || c === '}') depth -= 1;
        else if (c === sep && depth === 0) { parts.push(body.slice(start, i)); start = i + 1; }
    }
    parts.push(body.slice(start));
    return parts.map((p) => p.trim()).filter((p) => p !== '');
}

/** A dotted key's segments, quotes removed (one scan: a `.` inside quotes is part of the segment). */
function keyPath(raw: string): string[] {
    return splitTop(raw, '.').map((s) => s.replace(/^(["'])(.*)\1$/, '$2'));
}

function parseValue(raw: string, depth: number): TomlValue {
    const v = raw.trim();
    if (v.startsWith('"""') || v.startsWith("'''")) return v.slice(3, Math.max(3, v.length - 3)).replace(/^\n/, '');
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
    if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
    if (depth > MAX_DEPTH && (v.startsWith('[') || v.startsWith('{'))) return v;
    if (v.startsWith('[')) return splitTop(v.slice(1, v.lastIndexOf(']') < 0 ? v.length : v.lastIndexOf(']')), ',').map((p) => parseValue(p, depth + 1));
    if (v.startsWith('{')) {
        const table = record<TomlValue>();
        for (const pair of splitTop(v.slice(1, v.lastIndexOf('}') < 0 ? v.length : v.lastIndexOf('}')), ',')) assign(table, pair, depth + 1);
        return table;
    }
    if (v === 'true') return true;
    if (v === 'false') return false;
    const n = v.replace(/_/g, '');
    if (/^[+-]?(\d{1,20}(\.\d{1,20})?([eE][+-]?\d{1,4})?|0x[0-9a-fA-F]{1,16})$/.test(n)) return Number(n);
    return v;
}

const isTable = (v: unknown): v is TomlTable => !!v && typeof v === 'object' && !Array.isArray(v);

/** The table at `path` under `root`, created as needed; the LAST element of an array of tables is entered. Undefined on a forbidden segment. */
function tableAt(root: TomlTable, path: readonly string[]): TomlTable | undefined {
    let at = root;
    for (const seg of path) {
        if (!isSafeKey(seg)) return undefined;
        let next = own(at, seg);
        if (Array.isArray(next)) next = next[next.length - 1];
        if (!isTable(next)) { const created = record<TomlValue>(); setKey(at, seg, created); next = created; }
        at = next as TomlTable;
    }
    return at;
}

/** `a.b = value` into `table`. */
function assign(table: TomlTable, pair: string, depth: number): void {
    const eq = pair.indexOf('=');
    if (eq <= 0) return;
    const path = keyPath(pair.slice(0, eq));
    const last = path[path.length - 1];
    if (last === undefined) return;
    const target = tableAt(table, path.slice(0, -1));
    if (target) setKey(target, last, parseValue(pair.slice(eq + 1), depth));
}

function parseInto(root: TomlTable, text: string): void {
    let current: TomlTable | undefined = root;
    const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
        const line = stripComment(lines[i]!).trim();
        if (line === '') continue;
        if (line.startsWith('[[') && line.endsWith(']]')) {
            const path = keyPath(line.slice(2, -2));
            const last = path[path.length - 1];
            const parent = last !== undefined && isSafeKey(last) ? tableAt(root, path.slice(0, -1)) : undefined;
            current = undefined;
            if (!parent) continue;
            const prior = own(parent, last!);
            const list: TomlValue[] = Array.isArray(prior) ? prior : [];
            setKey<TomlValue>(parent, last!, list);
            current = record<TomlValue>();
            list.push(current);
            continue;
        }
        if (line.startsWith('[') && line.endsWith(']') && !line.includes('=')) { current = tableAt(root, keyPath(line.slice(1, -1))); continue; }
        // A value that opens a bracket or a multi-line string continues until it closes: each line is scanned once.
        const parts = [lines[i]!];
        const state = new ScanState().feed(lines[i]!);
        while (state.open && i + 1 < lines.length) {
            i += 1;
            parts.push(lines[i]!);
            state.feed(lines[i]!);
        }
        if (current) assign(current, parts.map(stripComment).join('\n'), 0);
    }
}

/** The document as nested tables; what could be read before a failure, never a throw. */
export function parseToml(text: string): TomlTable {
    const root = record<TomlValue>();
    try { parseInto(root, text); } catch { /* partial result */ }
    return root;
}
