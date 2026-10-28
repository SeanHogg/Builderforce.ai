/**
 * How a shared PreFetch executor runs a tool and shapes what it says: through the
 * surface's shell (`caps.shell` — the editor's local shell, on-prem's exec runtime), with
 * the action's deadline signal, and with its output CAPPED before it reaches a turn.
 * Pure: the shell is the host's.
 */

import type { DetectedTool, PrefetchExecHost } from './contract.js';

/** The most an executor's text may carry into a turn (characters). */
export const PREFETCH_OUTPUT_CAP = 8_000;
/** The most items a finding list names. */
export const PREFETCH_LIST_CAP = 15;
/** Where the shared executors write their own rule and report files (the platform's `.builderforce/`, beside the analyzers' artifacts). */
export const PREFETCH_SCRATCH_DIR = '.builderforce/code-analysis';

/** Text cut to `max`, saying how much was left out. */
export function capOutput(text: string, max = PREFETCH_OUTPUT_CAP): string {
    const t = text.trim();
    return t.length <= max ? t : `${t.slice(0, max)}\n… (${t.length - max} more characters not shown)`;
}

/** A markdown section with a fenced, capped body. */
export function fenced(title: string, body: string, max = PREFETCH_OUTPUT_CAP): string {
    return `### ${title}\n\n\`\`\`text\n${capOutput(body, max)}\n\`\`\``;
}

/** A root-relative path safe to put on a command line: no traversal, no shell syntax. */
export function safePath(path: string): string | undefined {
    const p = path.trim().split('\\').join('/').replace(/^\.\//, '');
    if (!p || p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.split('/').includes('..')) return undefined;
    return /^[\w@.+/-]+$/.test(p) ? p : undefined;
}

/** The focus files as command arguments (quoted), capped; empty ⇒ the caller scans the workspace. */
export function focusArgs(host: PrefetchExecHost, filter: (path: string) => boolean = () => true, max = 50): string[] {
    return (host.focusFiles?.() ?? [])
        .map(safePath)
        .filter((p): p is string => !!p && filter(p))
        .slice(0, max)
        .map((p) => `"${p}"`);
}

/** The detected tool for an id (or group id), or undefined. */
export function toolOf(host: PrefetchExecHost, id: string): DetectedTool | undefined {
    return host.tools()?.get(id);
}

export interface ToolRun {
    ok: boolean;
    exitCode?: number;
    /** Combined output (the shell's own bound applies first). */
    out: string;
}

/**
 * Run `<tool command> <args>` through the surface's shell, killed by `signal` (the
 * action's deadline or the run's Stop). Undefined when the tool is absent, there is no
 * shell, or the run was stopped — the executor then answers nothing and the turn goes on.
 */
export async function runTool(host: PrefetchExecHost, tool: DetectedTool | undefined, args: string, signal: AbortSignal): Promise<ToolRun | undefined> {
    const shell = host.caps.shell;
    if (!tool || !shell || signal.aborted) return undefined;
    try {
        const r = await shell.run(`${tool.command} ${args}`.trim(), { signal });
        if (r.aborted || signal.aborted) return undefined;
        return { ok: r.ok, ...(r.exitCode !== undefined ? { exitCode: r.exitCode } : {}), out: r.stdout ?? r.error ?? '' };
    } catch {
        return undefined;
    }
}

/** The first JSON value in mixed tool output (npm notices around it), or undefined. */
export function jsonIn(text: string): unknown {
    const starts = [text.indexOf('{'), text.indexOf('[')].filter((i) => i >= 0);
    if (starts.length === 0) return undefined;
    const start = Math.min(...starts);
    const open = text[start]!;
    const close = open === '{' ? '}' : ']';
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (escaped) escaped = false;
            else if (c === '\\') escaped = true;
            else if (c === '"') quoted = false;
        } else if (c === '"') quoted = true;
        else if (c === open) depth++;
        else if (c === close && --depth === 0) {
            try { return JSON.parse(text.slice(start, i + 1)); } catch { return undefined; }
        }
    }
    return undefined;
}

/** The words after a leading `/slash` (or the whole request): what a generator or codemod is asked. */
export function slashArgs(request: string, slash: string): string {
    const t = request.trim();
    return t.toLowerCase().startsWith(slash.toLowerCase()) ? t.slice(slash.length).trim() : t;
}
