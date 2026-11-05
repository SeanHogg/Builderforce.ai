/**
 * knowledge/codeComplexity.ts — deterministic cyclomatic complexity per function, from
 * source text (PRD 38, Option B+ Contract 1: the `complexity` / `maxComplexity` badges).
 *
 * A function scores 1 plus its decision points: `if` (an `else if` is one `if`), `for`,
 * `while`, `case`, `catch`, `&&`, `||`, `??` and the ternary `?`. Strings and comments are
 * masked first ({@link maskSource}); a nested function's decisions belong to the nested
 * function, not its parent. The file's `complexity` is the sum over its functions (plus any
 * module-level decision points), `maxComplexity` the worst function.
 *
 * Function bodies are found per family: brace languages by their function keyword / method
 * shape and brace matching, Python by indentation. A family without a rule (Ruby, …) is
 * scored as one unit. Decision points are attributed to the innermost function in ONE sweep
 * over the sorted ranges and positions: O(R log R + D). No pattern here nests quantifiers,
 * so a hostile file cannot make a scan blow up. Heuristic in shape, deterministic in output.
 * Pure.
 */

import { codeLanguageOf, maskSource } from './codeMask.js';

export interface ComplexityResult {
    /** Sum of every function's score (plus module-level decision points). */
    total: number;
    /** The worst function's score. */
    max: number;
    /** Functions found. */
    functions: number;
}

interface Range { start: number; end: number; }

interface FamilyRule {
    /** Decision tokens; matched globally on masked text. */
    decisions: RegExp;
    /** Finds the brace-bodied functions of a masked source (each range starts just after its `{`). */
    braces?(masked: string): Range[];
    /** Indentation-bodied functions (Python). */
    indented?: boolean;
}

const NOT_FUNCTION_NAMES = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'with', 'else', 'do', 'try', 'new', 'await', 'typeof', 'super']);
/** `?` is a ternary unless it is `?.`, `??`, an optional marker (`a?:`, `a?,`, `a?)`, `a?=`) or an optional method (`foo?():`). */
const TERNARY = String.raw`\?(?![.:,)=]|\(\s*\)\s*:)`;
const JS_DECISIONS = new RegExp(String.raw`\b(?:if|for|while|case|catch)\b|&&|\|\||\?\?|${TERNARY}`, 'g');
const OO_DECISIONS = new RegExp(String.raw`\b(?:if|for|foreach|while|case|catch)\b|&&|\|\||\?\?|${TERNARY}`, 'g');
const MAX_PARAM_SCAN = 4_000;

/** For every `{`, the index of its `}` (the text length when unclosed): one stack pass, so closing N ranges is O(n), not O(N·n). */
function braceMatches(masked: string): Map<number, number> {
    const closes = new Map<number, number>();
    const open: number[] = [];
    for (let i = 0; i < masked.length; i++) {
        const ch = masked[i];
        if (ch === '{') open.push(i);
        else if (ch === '}' && open.length > 0) closes.set(open.pop()!, i);
    }
    for (const i of open) closes.set(i, masked.length);
    return closes;
}

/** The index just after the `)` that balances the `(` at `open`, or -1 (bounded). */
function afterParens(masked: string, open: number): number {
    let depth = 0;
    const stop = Math.min(masked.length, open + MAX_PARAM_SCAN);
    for (let i = open; i < stop; i++) {
        const ch = masked[i];
        if (ch === '(') depth++;
        else if (ch === ')' && --depth === 0) return i + 1;
    }
    return -1;
}

/** What may sit between `)` and the body `{`: a return type / `throws` list — no braces, parens, `;` or `=`. */
const BEFORE_BODY = /\s*(?::[^{;=()]*|throws[^{;=()]*)?\{/y;

/** Heads of `name(`, found by one linear regex; the body is located by paren balancing. */
const CALL_HEAD = /(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*(?:<[^<>()]*>)?\s*\(/g;
const FUNCTION_HEAD = /\bfunction\b\s*\*?\s*(?:[A-Za-z_$][\w$]*)?\s*(?:<[^<>()]*>)?\s*\(/g;

function parenBodies(masked: string, head: RegExp, skipKeywords: boolean): Range[] {
    const out: Range[] = [];
    for (const m of masked.matchAll(head)) {
        if (skipKeywords && m[1] !== undefined && NOT_FUNCTION_NAMES.has(m[1])) continue;
        const open = m.index! + m[0].length - 1;
        const close = afterParens(masked, open);
        if (close < 0) continue;
        BEFORE_BODY.lastIndex = close;
        const body = BEFORE_BODY.exec(masked);
        if (body) out.push({ start: close + body[0].length, end: -1 });
    }
    return out;
}

function patternBodies(masked: string, re: RegExp): Range[] {
    return [...masked.matchAll(re)].map((m) => ({ start: m.index! + m[0].length, end: -1 }));
}

const jsBodies = (masked: string): Range[] => [
    ...parenBodies(masked, FUNCTION_HEAD, false),
    ...parenBodies(masked, CALL_HEAD, true),
    ...patternBodies(masked, /=>\s*\{/g),
];
const ooBodies = (masked: string): Range[] => [...parenBodies(masked, CALL_HEAD, true), ...patternBodies(masked, /->\s*\{/g)];
const braceFnBodies = (masked: string): Range[] => patternBodies(masked, /\b(?:func|fn|function)\b[^{;]*\{/g);

const RULES: Record<string, FamilyRule> = {
    js: { decisions: JS_DECISIONS, braces: jsBodies },
    oo: { decisions: OO_DECISIONS, braces: ooBodies },
    go: { decisions: /\b(?:if|for|case)\b|&&|\|\|/g, braces: braceFnBodies },
    rust: { decisions: /\b(?:if|for|while|loop)\b|&&|\|\|/g, braces: braceFnBodies },
    python: { decisions: /\b(?:if|elif|for|while|except|case)\b|\band\b|\bor\b/g, indented: true },
    ruby: { decisions: /\b(?:if|elsif|unless|while|until|for|when|rescue)\b|&&|\|\||\band\b|\bor\b/g },
    shell: { decisions: /\b(?:if|elif|for|while|until|case)\b|&&|\|\|/g },
    powershell: {
        decisions: /\b(?:if|elseif|foreach|for|while|switch|catch|trap)\b|(?<![\w-])-(?:and|or)\b|&&|\|\|/gi,
        braces: braceFnBodies,
    },
};

/** Close each opener's range and drop duplicates (two heads can name the same `{`). */
function closeRanges(masked: string, openers: Range[]): Range[] {
    const closes = braceMatches(masked);
    const byStart = new Map<number, Range>();
    for (const r of openers) if (!byStart.has(r.start)) byStart.set(r.start, { start: r.start, end: closes.get(r.start - 1) ?? masked.length });
    return [...byStart.values()];
}

function pythonRanges(masked: string): Range[] {
    const lines = masked.split('\n');
    const offsets: number[] = [];
    let at = 0;
    for (const line of lines) { offsets.push(at); at += line.length + 1; }
    const ranges: Range[] = [];
    lines.forEach((line, i) => {
        const m = /^([ \t]*)(?:async\s+)?def\s+\w+\s*\(/.exec(line);
        if (!m) return;
        const indent = m[1]!.length;
        let last = i;
        for (let j = i + 1; j < lines.length; j++) {
            if (!lines[j]!.trim()) continue;
            if (/^[ \t]*/.exec(lines[j]!)![0].length <= indent) break;
            last = j;
        }
        ranges.push({ start: offsets[i]!, end: offsets[last]! + lines[last]!.length });
    });
    return ranges;
}

/** Where each decision token starts. */
function decisionPositions(masked: string, re: RegExp): number[] {
    return [...masked.matchAll(re)].map((m) => m.index!);
}

/**
 * Scores per range, by one sweep: ranges sorted by start (a nested one after its parent),
 * positions ascending, a stack of the ranges still open at the position.
 */
function scoreRanges(ranges: Range[], positions: number[]): { scores: number[]; moduleLevel: number } {
    const order = ranges.map((r, idx) => ({ r, idx })).sort((a, b) => a.r.start - b.r.start || b.r.end - a.r.end);
    const scores = ranges.map(() => 1);
    const stack: Array<{ r: Range; idx: number }> = [];
    let next = 0, moduleLevel = 0;
    for (const pos of positions) {
        while (next < order.length && order[next]!.r.start <= pos) {
            const entering = order[next++]!;
            while (stack.length > 0 && stack[stack.length - 1]!.r.end <= entering.r.start) stack.pop();
            stack.push(entering);
        }
        while (stack.length > 0 && stack[stack.length - 1]!.r.end <= pos) stack.pop();
        const top = stack[stack.length - 1];
        if (top) scores[top.idx]!++;
        else moduleLevel++;
    }
    return { scores, moduleLevel };
}

/** `bare` is the source with comments AND strings masked ({@link maskSource}); omit it to have it computed. */
export function cyclomaticComplexity(path: string, text: string, bare?: string): ComplexityResult {
    const language = codeLanguageOf(path);
    const rule = language ? RULES[language] : undefined;
    if (!language || !rule) return { total: 0, max: 0, functions: 0 };
    const masked = bare ?? maskSource(text, language).bare;
    const ranges = rule.indented ? pythonRanges(masked) : rule.braces ? closeRanges(masked, rule.braces(masked)) : [];
    const positions = decisionPositions(masked, rule.decisions);
    if (ranges.length === 0) {
        return positions.length === 0 ? { total: 0, max: 0, functions: 0 } : { total: 1 + positions.length, max: 1 + positions.length, functions: 1 };
    }
    const { scores, moduleLevel } = scoreRanges(ranges, positions);
    return { total: scores.reduce((a, b) => a + b, 0) + moduleLevel, max: Math.max(...scores), functions: ranges.length };
}
