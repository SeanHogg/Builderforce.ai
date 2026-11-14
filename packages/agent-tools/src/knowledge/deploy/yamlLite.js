/**
 * knowledge/deploy/yamlLite.ts — the YAML subset deploy descriptors are written in (compose, k8s manifests,
 * serverless.yml, GitHub workflows): block mappings and sequences by indentation, `- key: v` items, flow `[…]` /
 * `{…}` collections, quoted and plain scalars, `|` / `>` block scalars, `#` comments and `---` documents. Anchors
 * are dropped and an alias reads as null: no descriptor field this package reads needs either.
 *
 * Not a YAML implementation (no tags, no complex keys, no multi-line plain scalars). Hardened for untrusted text:
 * mappings are prototype-free and never take `__proto__` / `constructor` / `prototype` keys (`safeRecord.ts`), nesting
 * stops at {@link MAX_DEPTH} (deeper content reads as null), keys are found by a linear scan, and it never throws —
 * a document it cannot finish gives what it read so far. Pure: no I/O, no dependency.
 */
import { record, setKey } from './safeRecord.js';
/** Deepest nesting read; anything below reads as null. */
const MAX_DEPTH = 64;
const indentOf = (line) => line.length - line.trimStart().length;
/** The line without its comment: a `#` at the start or after whitespace, outside quotes. */
function stripComment(line) {
    let quote = '';
    for (let i = 0; i < line.length; i += 1) {
        const c = line[i];
        if (quote) {
            if (c === quote && !(quote === '"' && line[i - 1] === '\\'))
                quote = '';
        }
        else if (c === '"' || c === "'") {
            if (i === 0 || /[\s:[{,-]/.test(line[i - 1]))
                quote = c;
        }
        else if (c === '#' && (i === 0 || /\s/.test(line[i - 1])))
            return line.slice(0, i).trimEnd();
    }
    return line.trimEnd();
}
const KEY_START_REFUSED = new Set([' ', '\t', '[', '{', '#', '&', '*', '!', '|', '>', '%', '@', '`', ',']);
/** `key: rest` — the key (unquoted) and what follows the colon; undefined when the text is no mapping entry. One linear scan. */
function splitKey(text) {
    const first = text[0];
    if (first === undefined)
        return undefined;
    if (first === '"' || first === "'") {
        const close = text.indexOf(first, 1);
        if (close < 0)
            return undefined;
        let i = close + 1;
        while (text[i] === ' ' || text[i] === '\t')
            i += 1;
        if (text[i] !== ':' || (i + 1 < text.length && text[i + 1] !== ' ' && text[i + 1] !== '\t'))
            return undefined;
        return { key: text.slice(1, close), rest: text.slice(i + 1).trim() };
    }
    if (KEY_START_REFUSED.has(first) && !text.startsWith('<<'))
        return undefined;
    for (let i = 0; i < text.length; i += 1) {
        const c = text[i];
        if (c === '#')
            return undefined;
        if (c === ':' && (i + 1 === text.length || text[i + 1] === ' ' || text[i + 1] === '\t')) {
            const key = text.slice(0, i).trim();
            return key ? { key, rest: text.slice(i + 1).trim() } : undefined;
        }
    }
    return undefined;
}
/** Splits flow content at its top-level commas. */
function splitFlow(body) {
    const parts = [];
    let depth = 0, quote = '', start = 0;
    for (let i = 0; i < body.length; i += 1) {
        const c = body[i];
        if (quote) {
            if (c === quote)
                quote = '';
            continue;
        }
        if (c === '"' || c === "'")
            quote = c;
        else if (c === '[' || c === '{')
            depth += 1;
        else if (c === ']' || c === '}')
            depth -= 1;
        else if (c === ',' && depth === 0) {
            parts.push(body.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(body.slice(start));
    return parts.map((p) => p.trim()).filter((p) => p !== '');
}
/** One inline value: a scalar or a flow collection. */
function parseScalar(raw, depth) {
    const text = raw.replace(/^&\S+\s*/, '').trim();
    if (text === '' || text === '~' || text === 'null' || text.startsWith('*'))
        return null;
    if (depth > MAX_DEPTH)
        return null;
    if (text.startsWith('[') && text.endsWith(']'))
        return splitFlow(text.slice(1, -1)).map((p) => parseScalar(p, depth + 1));
    if (text.startsWith('{') && text.endsWith('}')) {
        const out = record();
        for (const part of splitFlow(text.slice(1, -1))) {
            const colon = part.indexOf(':');
            const kv = splitKey(part) ?? (colon > 0 ? { key: part.slice(0, colon).trim().replace(/^["']|["']$/g, ''), rest: part.slice(colon + 1).trim() } : undefined);
            if (kv)
                setKey(out, kv.key, parseScalar(kv.rest, depth + 1));
        }
        return out;
    }
    if (text.startsWith('"') && text.endsWith('"') && text.length >= 2)
        return text.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n');
    if (text.startsWith("'") && text.endsWith("'") && text.length >= 2)
        return text.slice(1, -1).replace(/''/g, "'");
    if (text === 'true' || text === 'True')
        return true;
    if (text === 'false' || text === 'False')
        return false;
    if (/^-?\d{1,15}(\.\d{1,15})?$/.test(text))
        return Number(text);
    return text;
}
class Reader {
    lines;
    i = 0;
    constructor(lines) {
        this.lines = lines;
    }
    /** The next line with content (comments and blank lines skipped), or undefined at the end. */
    peek() {
        while (this.i < this.lines.length) {
            const text = stripComment(this.lines[this.i]);
            if (text.trim() !== '')
                return { indent: indentOf(text), text: text.trim() };
            this.i += 1;
        }
        return undefined;
    }
    /** Skips every line indented deeper than `indent` (content past {@link MAX_DEPTH}). */
    skipDeeper(indent) {
        for (let line = this.peek(); line && line.indent > indent; line = this.peek())
            this.i += 1;
    }
}
const isItem = (text) => text === '-' || text.startsWith('- ');
/** A `|` / `>` block scalar: every following line indented deeper than `parent`. */
function blockScalar(r, parent, folded) {
    const out = [];
    let indent = -1;
    while (r.i < r.lines.length) {
        const line = r.lines[r.i];
        if (line.trim() !== '') {
            const ind = indentOf(line);
            if (ind <= parent)
                break;
            if (indent < 0)
                indent = ind;
        }
        out.push(line.slice(Math.max(indent, 0)));
        r.i += 1;
    }
    while (out.length > 0 && out[out.length - 1].trim() === '')
        out.pop();
    return folded ? out.join(' ') : out.join('\n');
}
/** The value of `key:` with nothing after it: a nested block, a same-indent sequence, or null. */
function nestedValue(r, indent, depth) {
    const next = r.peek();
    if (!next)
        return null;
    if (next.indent > indent)
        return parseBlock(r, next.indent, depth + 1);
    if (next.indent === indent && isItem(next.text))
        return parseSeq(r, indent, depth + 1);
    return null;
}
/** The value after `key:` / `- `: a block scalar, or an inline value. */
function inlineValue(r, rest, indent, depth) {
    const bare = rest.replace(/^&\S+\s*/, '');
    if (/^[|>][+-]?\d*$/.test(bare))
        return blockScalar(r, indent, bare.startsWith('>'));
    if (bare === '')
        return nestedValue(r, indent, depth);
    return parseScalar(bare, depth);
}
function parseMap(r, indent, depth) {
    const out = record();
    for (let line = r.peek(); line && line.indent === indent; line = r.peek()) {
        const kv = isItem(line.text) ? undefined : splitKey(line.text);
        if (!kv)
            break;
        r.i += 1;
        const value = inlineValue(r, kv.rest, indent, depth);
        if (kv.key === '<<') {
            if (value && typeof value === 'object' && !Array.isArray(value))
                for (const [k, v] of Object.entries(value))
                    setKey(out, k, v);
            continue;
        }
        setKey(out, kv.key, value);
    }
    return out;
}
function parseSeq(r, indent, depth) {
    const out = [];
    for (let line = r.peek(); line && line.indent === indent && isItem(line.text); line = r.peek()) {
        const content = line.text === '-' ? '' : line.text.slice(2).trimStart();
        if (content === '') {
            r.i += 1;
            out.push(nestedValue(r, indent, depth));
            continue;
        }
        if (!content.startsWith('{') && splitKey(content)) {
            // `- key: v`: a mapping whose first entry sits on the dash line, at the column after the dash.
            const column = indent + (line.text.length - content.length);
            r.lines[r.i] = ' '.repeat(column) + content;
            out.push(parseMap(r, column, depth + 1));
            continue;
        }
        r.i += 1;
        out.push(inlineValue(r, content, indent, depth));
    }
    return out;
}
function parseBlock(r, indent, depth) {
    if (depth > MAX_DEPTH) {
        r.skipDeeper(indent - 1);
        return null;
    }
    const line = r.peek();
    if (!line)
        return null;
    if (isItem(line.text))
        return parseSeq(r, indent, depth);
    if (splitKey(line.text))
        return parseMap(r, indent, depth);
    r.i += 1;
    return inlineValue(r, line.text, indent, depth);
}
/** Every document of a YAML stream (`---` separates them); an empty document is skipped. Never throws. */
export function parseYamlDocuments(text) {
    const docs = [];
    for (const chunk of text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/^---[^\n]*$/m)) {
        const lines = chunk.split('\n').filter((l) => !/^\.\.\.\s*$/.test(l) && !l.startsWith('%'));
        const r = new Reader(lines);
        const first = r.peek();
        if (!first)
            continue;
        try {
            docs.push(parseBlock(r, first.indent, 0));
        }
        catch { /* a document this subset cannot read is skipped */ }
    }
    return docs;
}
/** The first document, or null. */
export const parseYaml = (text) => parseYamlDocuments(text)[0] ?? null;
/** Typed readers the YAML descriptor parsers share. */
export const isYamlMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
export const yamlMap = (v) => (isYamlMap(v) ? v : record());
//# sourceMappingURL=yamlLite.js.map