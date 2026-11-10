/**
 * rules/support/files.ts — how text rules walk a {@link RuleInput}, scoped to ONE `computeRunDelta`
 * call (every memo hangs off the call's own `RuleInput` / `SideText` objects in a WeakMap, so nothing
 * outlives the call and no text is ever used as a cache key):
 *
 *  - {@link filePairs}: one pair per changed file (logical path, both sides as {@link TextView}s);
 *  - {@link TextView}: the side's text, its agent-tools `maskSource` copies (`code` = comments blanked,
 *    strings intact; `bare` = both blanked; computed lazily, once), a linear line index, and a per-view memo;
 *  - {@link perInput}: a per-call memo for analyses several rules share (routes, exports, test facts);
 *  - {@link redact}: THE redaction every rule output passes through (`@builderforce/secret-redaction`).
 */

import { codeLanguageOf, escapeRegex, isShellPath, maskSource, type MaskedSource } from '@builderforce/agent-tools/code-mask';
import type { RuleInput, SideText } from '../../contract.js';
import { redact } from '../../engine/redact.js';
import { lineOf, lineStarts } from '../../engine/text.js';

export { escapeRegex, isShellPath, redact };

export interface TextView {
    /** Logical (after-side) path: the anchor path. */
    readonly path: string;
    /** The path on this side (a renamed file's before side keeps its old path): the evidence path. */
    readonly sidePath: string;
    readonly text: string;
    readonly code: string;
    readonly bare: string;
    lineAt(offset: number): number;
    /** The line holding `offset`, cut from `source` (default the text; `code`/`bare` share its line layout). */
    lineText(offset: number, source?: string): string;
    memo<T>(key: string, compute: () => T): T;
}

class View implements TextView {
    private masks?: MaskedSource;
    private starts?: number[];
    private readonly memos = new Map<string, unknown>();

    constructor(readonly path: string, readonly sidePath: string, readonly text: string) {}

    private get masked(): MaskedSource {
        return (this.masks ??= maskSource(this.text, codeLanguageOf(this.path)));
    }
    get code(): string { return this.masked.code; }
    get bare(): string { return this.masked.bare; }

    lineAt(offset: number): number {
        return lineOf((this.starts ??= lineStarts(this.text)), offset);
    }

    lineText(offset: number, source: string = this.text): string {
        const starts = (this.starts ??= lineStarts(this.text));
        const line = lineOf(starts, offset);
        const end = line < starts.length ? starts[line]! - 1 : this.text.length;
        return source.slice(starts[line - 1]!, end);
    }

    memo<T>(key: string, compute: () => T): T {
        if (!this.memos.has(key)) this.memos.set(key, compute());
        return this.memos.get(key) as T;
    }
}

const views = new WeakMap<SideText, View>();

function viewOf(st: SideText | undefined, path: string): TextView | undefined {
    if (!st || st.text === undefined) return undefined;
    let v = views.get(st);
    if (!v || v.path !== path) {
        v = new View(path, st.path, st.text);
        views.set(st, v);
    }
    return v;
}

const inputs = new WeakMap<RuleInput, Map<string, unknown>>();

/** A memo scoped to one rule input (one `computeRunDelta` call). */
export function perInput<T>(input: RuleInput, key: string, compute: () => T): T {
    let m = inputs.get(input);
    if (!m) inputs.set(input, (m = new Map()));
    if (!m.has(key)) m.set(key, compute());
    return m.get(key) as T;
}

export interface FilePair {
    path: string;
    before?: TextView;
    after?: TextView;
}

/** Every changed file with at least one side, in path order (once per call). */
export function filePairs(input: RuleInput): FilePair[] {
    return perInput(input, 'filePairs', () => {
        const out: FilePair[] = [];
        for (const f of input.changed) {
            const before = viewOf(input.before.get(f.path), f.path), after = viewOf(input.after.get(f.path), f.path);
            if (before || after) out.push({ path: f.path, ...(before ? { before } : {}), ...(after ? { after } : {}) });
        }
        return out;
    });
}

export const isTestPath = (path: string): boolean => /(^|\/)__tests__\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
export const isSnapshotPath = (path: string): boolean => /\.snap$/.test(path) || /(^|\/)__snapshots__\//.test(path);
/** A source file (any language the symbol extractor or the shell masker knows), not docs. */
export const isCodePath = (path: string): boolean => { const l = codeLanguageOf(path); return l !== undefined && l !== 'markdown'; };
/** JS/TS family. */
export const isJsPath = (path: string): boolean => codeLanguageOf(path) === 'js';

/** A file the run changed that is code and not a test or snapshot: "the implementation". */
export function implChanged(input: RuleInput): boolean {
    return perInput(input, 'implChanged', () => filePairs(input)
        .some((p) => isCodePath(p.path) && !isTestPath(p.path) && !isSnapshotPath(p.path) && p.before?.text !== p.after?.text));
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

/** The offset of the opener matching the closer at `close`, walking back; -1 if none. */
export function matchOpen(bare: string, close: number): number {
    const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
    const stack: string[] = [];
    for (let i = close; i >= 0; i--) {
        const ch = bare[i]!;
        if (pairs[ch]) stack.push(pairs[ch]!);
        else if (ch === '(' || ch === '[' || ch === '{') {
            if (stack.pop() !== ch) return -1;
            if (stack.length === 0) return i;
        }
    }
    return -1;
}

/** Collapses whitespace runs and trims: the normalized form of a declaration or a line. */
export const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();
