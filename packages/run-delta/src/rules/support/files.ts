/**
 * rules/support/files.ts — how text rules walk a {@link RuleInput}: one {@link FilePair} per changed
 * file (logical path, both sides' text), the path classes the rules filter on, and the
 * comment/string masking they share. Masking REUSES agent-tools `maskSource` (`code` = comments
 * blanked, strings intact; `bare` = comments and strings blanked; length and line breaks kept).
 */

import { codeLanguageOf, maskSource, type MaskedSource } from '@builderforce/agent-tools/code-mask';
import type { RuleInput, SideText } from '../../contract.js';

export interface FilePair {
    /** Logical (after-side) path: the anchor path. */
    path: string;
    before?: SideText & { text: string };
    after?: SideText & { text: string };
}

const withText = (s: SideText | undefined): (SideText & { text: string }) | undefined =>
    s && s.text !== undefined ? (s as SideText & { text: string }) : undefined;

/** Every changed file with at least one side, in path order. */
export function filePairs(input: RuleInput): FilePair[] {
    const out: FilePair[] = [];
    for (const f of input.changed) {
        const before = withText(input.before.get(f.path)), after = withText(input.after.get(f.path));
        if (before || after) out.push({ path: f.path, ...(before ? { before } : {}), ...(after ? { after } : {}) });
    }
    return out;
}

export const isTestPath = (path: string): boolean => /(^|\/)__tests__\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
export const isSnapshotPath = (path: string): boolean => /\.snap$/.test(path) || /(^|\/)__snapshots__\//.test(path);
export const languageOf = (path: string): string | undefined => codeLanguageOf(path);
/** A source file (any language the symbol extractor or the shell masker knows), not docs. */
export const isCodePath = (path: string): boolean => { const l = codeLanguageOf(path); return l !== undefined && l !== 'markdown'; };
/** JS/TS family. */
export const isJsPath = (path: string): boolean => codeLanguageOf(path) === 'js';

/** A file the run changed that is code and not a test or snapshot: "the implementation". */
export function implChanged(input: RuleInput): boolean {
    return filePairs(input).some((p) => isCodePath(p.path) && !isTestPath(p.path) && !isSnapshotPath(p.path) && p.before?.text !== p.after?.text);
}

const cache = new Map<string, MaskedSource>();
const CACHE_LIMIT = 256;

/** `maskSource` of a text in its path's language, memoized per (language, text). */
export function masked(text: string, path: string): MaskedSource {
    const language = codeLanguageOf(path);
    const key = `${language ?? ''}\u0000${text}`;
    const hit = cache.get(key);
    if (hit) return hit;
    if (cache.size >= CACHE_LIMIT) cache.clear();
    const value = maskSource(text, language);
    cache.set(key, value);
    return value;
}

/** The offset of the bracket matching the opener at `open` (`(`, `[`, `{`) in masked `bare` text; -1 if unclosed. */
export function matchClose(bare: string, open: number): number {
    const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
    const stack: string[] = [];
    for (let i = open; i < bare.length; i++) {
        const ch = bare[i]!;
        if (pairs[ch]) stack.push(pairs[ch]!);
        else if (ch === ')' || ch === ']' || ch === '}') {
            if (stack.pop() !== ch) return -1;
            if (stack.length === 0) return i;
        }
    }
    return -1;
}

/** Collapses whitespace runs and trims: the normalized form of a declaration or a line. */
export const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();
