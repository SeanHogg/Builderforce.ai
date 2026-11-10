/**
 * knowledge/jsonc.ts — THE JSONC reader of the knowledge package: comments and trailing commas are removed (string
 * contents untouched) before `JSON.parse`. tsconfig/jsconfig (`moduleAliases.ts`) and `wrangler.jsonc` / `vercel.json`
 * (`deploy/`) read through it. Pure.
 */

/** JSONC → JSON: comments and trailing commas removed, string contents untouched. */
function stripJsonc(text: string): string {
    let out = '';
    for (let i = 0; i < text.length; i += 1) {
        const c = text[i]!, n = text[i + 1];
        if (c === '"') {
            let j = i + 1;
            while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
            out += text.slice(i, j + 1);
            i = j;
        } else if (c === '/' && n === '/') {
            while (i < text.length && text[i] !== '\n') i += 1;
            out += '\n';
        } else if (c === '/' && n === '*') {
            const end = text.indexOf('*/', i + 2);
            i = end < 0 ? text.length : end + 1;
        } else out += c;
    }
    return out.replace(/,(\s*[}\]])/g, '$1');
}

/** The parsed value of a JSON or JSONC text (a leading BOM ignored); undefined when it does not parse. */
export function parseJsonc(text: string): unknown {
    try { return JSON.parse(stripJsonc(text.replace(/^﻿/, ''))); } catch { return undefined; }
}
