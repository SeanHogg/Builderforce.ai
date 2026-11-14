/**
 * THE tool-output policy: what a tool result costs the MODEL transcript, and how it is
 * cut down when it costs too much. The full result always survives in the surface's
 * own trace; only the copy the model re-reads every turn is bounded.
 *
 *   • `read_file` is paged by line with the continuation offset rewritten
 *     ({@link windowReadFile});
 *   • with the C7 lever on (`summarize: true`), a shell/test/build log is summarized
 *     ({@link summarizeShellOutput}) and any other large JSON is PROJECTED
 *     ({@link projectJson}) instead of head-sliced;
 *   • otherwise (and as the last resort) a head slice with an explicit marker, so the
 *     model knows data was elided and can re-call with a narrower filter.
 *
 * Pure: no I/O, no clock, no env. The lever decision arrives as a parameter.
 */
import { DEFAULT_TOOL_OUTPUT_CHARS, isPagedReadTool, isShellTool, toolOutputCap, windowedCap } from './caps.js';
import { projectJson } from './jsonProjection.js';
import { isReadFileResult, isReadFilesResult, windowReadFile, windowReadFiles } from './readFileWindow.js';
import { detectRunner, summarizeShellOutput } from './shellSummary.js';
import { cutHeadTail } from './textCut.js';
/** Field names that carry a command's log in a structured shell result. */
const LOG_FIELDS = ['output', 'stdout', 'stderr'];
/** Whether `text` reads as a shell/build/test log. */
export function isLogLike(text, tool) {
    return (tool !== undefined && isShellTool(tool)) || detectRunner(text) !== 'unknown';
}
/**
 * Fit one text result to `maxChars`. With the lever on, a log is summarized (failing
 * tests, errors, diffs, tail); otherwise `fallback` — head+tail by default, so a
 * command's verdict at the end is never the part that is dropped.
 */
export function fitToolText(text, maxChars, opts = {}) {
    if (text.length <= maxChars)
        return text;
    if (opts.summarize && isLogLike(text, opts.tool))
        return summarizeShellOutput(text, { maxChars }).text;
    return (opts.fallback ?? cutHeadTail)(text, maxChars);
}
function attach(value, opts) {
    return opts.advisory && opts.attachAdvisory ? opts.attachAdvisory(value, opts.advisory) : value;
}
/** The cap for a tool on this call. The per-tool rows beyond `read_file` are a C7
 *  behaviour, so with the lever off every other tool keeps the generic cap it always had. */
function capFor(tool, opts) {
    if (opts.maxChars !== undefined)
        return opts.maxChars;
    const tableCap = !opts.summarize && !isPagedReadTool(tool) ? DEFAULT_TOOL_OUTPUT_CHARS : toolOutputCap(tool, opts.caps);
    return windowedCap(tool, tableCap, opts.contextWindowTokens);
}
/** Shrink the log fields of a structured shell result so the whole result fits. */
function shrinkLogFields(tool, out, cap, overhead) {
    const fields = LOG_FIELDS.filter((f) => typeof out[f] === 'string' && out[f].length > 0);
    if (fields.length === 0)
        return null;
    const logChars = fields.reduce((n, f) => n + out[f].length, 0);
    const rest = JSON.stringify({ ...out, ...Object.fromEntries(fields.map((f) => [f, ''])) }).length;
    // JSON escaping inflates a log (newlines, quotes) — budget against the escaped size.
    const escapedLog = fields.reduce((n, f) => n + JSON.stringify(out[f]).length - 2, 0);
    const inflation = logChars > 0 ? escapedLog / logChars : 1;
    const budget = Math.floor((cap - rest - overhead) / inflation);
    if (budget < 500)
        return null;
    const shrunk = { ...out };
    for (const f of fields) {
        const text = out[f];
        const share = Math.max(200, Math.floor(budget * (text.length / logChars)));
        shrunk[f] = fitToolText(text, share, { tool, summarize: true });
    }
    return shrunk;
}
/**
 * The sentence that travels WITH a cut result so the model never takes it for the whole:
 * how long the result was (in chars — the unit the cap counts), the most this surface
 * returns, and what to do. Short enough to ride inside the cap it describes, and compact
 * when the cap is tiny. The ONE wording; every host that cuts a result says this.
 */
export function truncatedResultNote(originalChars, maxChars) {
    if (maxChars < 600)
        return 'Truncated: NOT the whole result — do not treat it as complete.';
    return `Truncated: the full result was ${originalChars.toLocaleString('en-US')} chars and this surface returns at most ~${maxChars.toLocaleString('en-US')}. \`output\` is only a cut of it, NOT the whole — never treat it as complete or write it back as if it were. Re-call with a narrower query, id or filter to see the rest.`;
}
/**
 * Shape a tool result for the model transcript. `bytes` is always the ORIGINAL size.
 */
export function shapeToolResult(tool, out, opts = {}) {
    const bytes = JSON.stringify(out ?? null).length;
    if (isPagedReadTool(tool) && (isReadFileResult(out) || isReadFilesResult(out))) {
        // The line window's own row (the `caps` override never applied to it), sized to the window.
        const maxChars = opts.maxChars ?? windowedCap(tool, toolOutputCap(tool), opts.contextWindowTokens);
        const windowOpts = { tool, maxChars, advisory: opts.advisory, attachAdvisory: opts.attachAdvisory };
        const windowed = isReadFileResult(out) ? windowReadFile(out, windowOpts) : windowReadFiles(out, windowOpts);
        return { content: JSON.stringify(windowed.value), bytes, truncated: windowed.truncated, served: windowed.served };
    }
    const cap = capFor(tool, opts);
    const full = JSON.stringify(attach(out ?? null, opts));
    if (full.length <= cap)
        return { content: full, bytes, truncated: false };
    const advisoryChars = opts.advisory ? opts.advisory.length + 16 : 0;
    if (opts.summarize) {
        // A log as a bare string, or in a structured shell result's log fields.
        if (typeof out === 'string') {
            // Budget against the ESCAPED size: JSON inflates a log's newlines and quotes.
            const inflation = out.length > 0 ? (bytes - 2) / out.length : 1;
            const shaped = fitToolText(out, Math.max(500, Math.floor((cap - advisoryChars - 32) / Math.max(1, inflation))), { tool, summarize: true });
            const content = JSON.stringify(attach(shaped, opts));
            if (content.length <= cap)
                return { content, bytes, truncated: true };
        }
        else if (out && typeof out === 'object' && !Array.isArray(out)) {
            const shrunk = shrinkLogFields(tool, out, cap, advisoryChars + 64);
            if (shrunk) {
                const content = JSON.stringify(attach(shrunk, opts));
                if (content.length <= cap)
                    return { content, bytes, truncated: true };
            }
        }
        // Any other large JSON: keep its shape, not its first rows.
        const marker = `\n[projected to fit the ~${cap.toLocaleString('en-US')}-char tool-result budget (original ${bytes.toLocaleString('en-US')} chars): every top-level key is kept; arrays show their first items with a count of the rest and long strings are clipped. Re-call with a narrower filter, limit or id to see specific items.]`;
        const projection = projectJson(out ?? null, cap - marker.length - advisoryChars);
        if (projection.fits) {
            return { content: `${projection.json}${marker}${opts.advisory ? `\n${opts.advisory}` : ''}`, bytes, truncated: true };
        }
    }
    // Legacy head slice. If the result is an array, tell the model how many items were
    // dropped — the signal it needs to add a `limit`/`status`/`projectId` filter.
    const itemNote = Array.isArray(out)
        ? ` The full result had ${out.length} items; re-call this tool with a narrower filter (e.g. status, projectId, or limit) to see specific ones.`
        : ' The full result was large; re-call with a narrower query if you need the elided fields.';
    const head = JSON.stringify(out ?? null).slice(0, cap);
    const marker = `…[truncated ${bytes - cap} of ${bytes} chars to protect the context window.${itemNote}]`;
    // The advisory rides after the marker: a trim must never be what silences the guard.
    const content = `${head}\n${marker}${opts.advisory ? `\n${opts.advisory}` : ''}`;
    return { content, bytes, truncated: true };
}
//# sourceMappingURL=policy.js.map