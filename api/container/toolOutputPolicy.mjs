/**
 * GENERATED FILE — do not edit by hand.
 *
 * Compiled from `packages/tool-output-policy/src` (caps.ts, textCut.ts, shellSummary.ts, jsonProjection.ts, readFileWindow.ts, policy.ts, modelPolicy.ts) into one dependency-free ESM
 * module for the Cloudflare Container, which has no build step.
 *
 * Regenerate with `node scripts/gen-container-shared.mjs` (from `api/`).
 * `--check` fails the build when the source no longer matches the hash below.
 *
 * @source-sha256 73405783f3f57e2993dc499be317134e58b6f806ff443ca361e43d5d3f90232a
 */
// ── caps.ts ──
/**
 * The budgets, as DATA. Every surface used to carry its own numbers — the Brain's 6,000
 * generic / 16,000 `read_file`, agent-runtime's 30%-of-window with a 400K hard cap and a
 * 2K floor, the local shell's 200K capture / 30K pending buffer, the container's 60K
 * capture and 20K `run_command` reply. They live here once; a surface picks the row it
 * needs instead of restating it.
 */
/** Per-result cap (chars) for a tool with no row in {@link TOOL_OUTPUT_CAPS}. */
const DEFAULT_TOOL_OUTPUT_CHARS = 6_000;
/**
 * Per-tool caps (chars of the model-facing result). `read_file` is larger on purpose:
 * reading source is what a coding surface DOES, and it is paged by line with the offset
 * that continues it, so a big file costs several honest windows rather than one lossy
 * cut. Shell tools get room for a build/test summary plus the tail of the log.
 */
const TOOL_OUTPUT_CAPS = {
    read_file: 16_000,
    run_command: 20_000,
    exec: 20_000,
    bash: 20_000,
    git_status: 20_000,
    git_diff: 20_000,
    git_history: 20_000,
    git_sync_latest: 20_000,
    git_undo: 20_000,
    git_redo: 20_000,
};
/** The tool whose results are paged by line rather than sliced by char. */
const READ_FILE_TOOL = 'read_file';
/** Tool names whose result is a shell/build/test log. */
const SHELL_TOOLS = new Set(['run_command', 'exec', 'bash', 'shell', 'process']);
/** Even the largest window (~2M tokens) should not spend more than ~100K tokens on one result. */
const HARD_MAX_TOOL_RESULT_CHARS = 400_000;
/** Max share of the context window one tool result may occupy (window-relative cap). */
const TOOL_RESULT_WINDOW_SHARE = 0.3;
/** Rough chars-per-token used to turn a window share into a char budget. */
const TOOL_RESULT_CHARS_PER_TOKEN = 4;
/** A cut never keeps less than this — the model must still see what the content was. */
const MIN_KEEP_CHARS = 2_000;
/**
 * Capture buffers for a running process (how much of a live log is HELD, not what the
 * model is handed). The tail is kept: a build or test run prints its verdict last.
 */
const SHELL_CAPTURE_CHARS = {
    /** agent-runtime's aggregated exec buffer. */
    local: 200_000,
    /** agent-runtime's pending (not-yet-polled) buffer. */
    localPending: 30_000,
    /** The cloud container's per-command buffer. */
    container: 60_000,
};
/** The cap for one tool's result. `caps` overrides the table (tests, a surface's own row). */
function toolOutputCap(tool, caps = TOOL_OUTPUT_CAPS) {
    return caps[tool] ?? DEFAULT_TOOL_OUTPUT_CHARS;
}
/**
 * The window-relative cap: {@link TOOL_RESULT_WINDOW_SHARE} of the context window, in
 * chars, never above {@link HARD_MAX_TOOL_RESULT_CHARS}.
 */
function windowToolResultCap(contextWindowTokens) {
    const maxTokens = Math.floor(contextWindowTokens * TOOL_RESULT_WINDOW_SHARE);
    return Math.min(maxTokens * TOOL_RESULT_CHARS_PER_TOKEN, HARD_MAX_TOOL_RESULT_CHARS);
}
/** Whether a tool's output is a shell/build/test log. */
function isShellTool(tool) {
    return SHELL_TOOLS.has(tool);
}

// ── textCut.ts ──
/**
 * Plain-text cuts. Three shapes, each owned once:
 *
 *   • {@link keepTail}    — a capture BUFFER for a live process (the verdict prints last);
 *   • {@link cutHead}     — a result whose beginning is what matters, snapped to a line;
 *   • {@link cutHeadTail} — a log: the command's start AND its end (where test/build
 *                           summaries live), with an explicit elision marker between.
 */
/** Keep the last `max` chars — a rolling capture buffer. */
function keepTail(text, max) {
    if (text.length <= max)
        return text;
    return text.slice(text.length - max);
}
const DEFAULT_TRUNCATION_SUFFIX = "\n\n⚠️ [Content truncated — original was too large for the model's context window. " +
    'The content above is a partial view. If you need more, request specific sections or use ' +
    'offset/limit parameters to read smaller chunks.]';
/** Keep the head of `text` within `maxChars` (suffix included), cut at a line boundary when one is near. */
function cutHead(text, maxChars, opts = {}) {
    if (text.length <= maxChars)
        return text;
    const suffix = opts.suffix ?? DEFAULT_TRUNCATION_SUFFIX;
    const snap = opts.snap ?? 0.8;
    const keep = Math.max(opts.minKeep ?? 0, maxChars - suffix.length);
    if (keep <= 0)
        return opts.emptyNotice ?? suffix.trim();
    let cutPoint = keep;
    const lastNewline = text.lastIndexOf('\n', keep);
    if (lastNewline > keep * snap)
        cutPoint = lastNewline;
    return text.slice(0, cutPoint) + suffix;
}
/** Room reserved for the elision marker. */
const MARKER_RESERVE = 160;
function countLines(text) {
    let n = 0;
    for (let i = 0; i < text.length; i++)
        if (text.charCodeAt(i) === 10)
            n++;
    return n;
}
/**
 * Keep the head and the tail of `text` within `maxChars`, both snapped to line
 * boundaries, with a marker that says exactly how much was elided. The tail gets the
 * larger share by default: a build or test run prints its verdict at the end.
 */
function cutHeadTail(text, maxChars, opts = {}) {
    if (text.length <= maxChars)
        return text;
    const budget = maxChars - MARKER_RESERVE;
    if (budget <= 0)
        return keepTail(text, Math.max(0, maxChars));
    const headShare = Math.min(1, Math.max(0, opts.headShare ?? 0.25));
    const headBudget = Math.floor(budget * headShare);
    const tailBudget = budget - headBudget;
    let headEnd = headBudget;
    const nl = text.lastIndexOf('\n', headBudget);
    if (nl > headBudget * 0.8)
        headEnd = nl;
    let tailStart = text.length - tailBudget;
    const nextNl = text.indexOf('\n', tailStart);
    if (nextNl >= 0 && nextNl - tailStart < tailBudget * 0.2)
        tailStart = nextNl + 1;
    const head = text.slice(0, headEnd);
    const tail = text.slice(tailStart);
    const elided = text.slice(headEnd, tailStart);
    const marker = `\n…[${elided.length.toLocaleString('en-US')} chars (${countLines(elided).toLocaleString('en-US')} lines) elided — showing the first ${head.length.toLocaleString('en-US')} and the last ${tail.length.toLocaleString('en-US')} of ${text.length.toLocaleString('en-US')} chars]…\n`;
    return `${head}${marker}${tail}`;
}

// ── shellSummary.ts ──
/**
 * The shell/test/build output summarizer.
 *
 * A failing `pnpm test` prints thousands of lines of passing noise and buries the few
 * that matter — which test failed, the assertion diff, the compiler error — somewhere
 * in the middle. A head slice hands the model the noise and drops the verdict; a tail
 * slice keeps the verdict and drops the failure detail. This keeps what a developer
 * would read: the failing test names, every error line, the assertion diffs, and the
 * last {@link DEFAULT_TAIL_LINES} lines, and says how much passing output it dropped.
 *
 * Recognises vitest, jest, pytest, cargo, tsc and go test; anything else still gets the
 * generic error-line + tail treatment.
 */
const DEFAULT_TAIL_LINES = 40;
/** Assertion-diff lines kept after a diff header. */
const MAX_DIFF_LINES = 24;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
function stripAnsi(text) {
    return text.replace(ANSI, '');
}
const RUNNER_SIGNATURES = [
    ['vitest', /\bvitest\b|^\s*(?:Test Files|Tests)\s+\d+\s+(?:failed|passed)|^\s*[❯›]\s+\S+\.(?:test|spec)\.[cm]?[jt]sx?/m],
    ['jest', /^\s*(?:PASS|FAIL)\s+\S+\.(?:test|spec)\.[cm]?[jt]sx?|^Test Suites:\s+\d+/m],
    ['pytest', /=+ test session starts =+|^(?:FAILED|ERROR) \S+::|=+ .*\b(?:passed|failed)\b.* in [\d.]+s =+/m],
    ['cargo', /^\s*(?:Compiling|Finished|Running) .*|^test result: (?:ok|FAILED)\.|^error(?:\[E\d+\])?: /m],
    ['tsc', /\berror TS\d+:/],
    ['go', /^(?:---|===) (?:FAIL|RUN|PASS):|^(?:ok|FAIL)\s+\S+\s+[\d.]+s/m],
];
/** Which test/build tool printed this output. */
function detectRunner(text) {
    for (const [runner, re] of RUNNER_SIGNATURES)
        if (re.test(text))
            return runner;
    return 'unknown';
}
/** Lines that are pure passing / progress noise. */
const NOISE = [
    /^\s*[✓√✔]\s/,
    /^\s*PASS\s/,
    /^\s*PASSED\b/,
    /\bPASSED\s*(?:\[\s*\d+%\])?$/,
    /^test .* \.\.\. ok$/,
    /^ok\s+\S+\s+[\d.]+s/,
    /^=== RUN\s/,
    /^--- PASS:/,
    /^\s*Compiling\s/,
    /^\s*Downloaded?\s/,
    /^\s*$/,
];
/** Lines that name a failure or an error. */
const ERROR_LINE = [
    /\berror\b|\bERROR\b|\bError\b/,
    /\bFAIL(?:ED|URE)?\b|\bfailed\b/,
    /^\s*[✗×✕❌]\s/,
    /\bpanic(?:ked)?\b|^Traceback \(most recent call last\)/,
    /\bAssertion(?:Error)?\b|\bassert(?:ion)?\b/,
    /^E\s{2,}/, // pytest assertion detail
    /^\s*●\s/, // jest failing test header
    /\berror TS\d+:/,
    /^\s*-->\s.+:\d+:\d+$/, // cargo error location
];
/** Lines that open an assertion diff — the following +/- lines are kept with them. */
const DIFF_HEADER = /^\s*(?:[-+]\s*Expected|[-+]\s*Received|Expected:|Received:|expected:|actual:|Difference:|- expected|\+ actual|assert .* ==)/;
const DIFF_BODY = /^\s*[-+](?!-)|^\s{2,}\S/;
/** Failing-test name extractors, per runner. Group 1 is the name. */
const FAILING_TEST = [
    /^\s*(?:FAIL|×|✕|✗)\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?(?:\s+>\s+.+?)?)(?:\s+\d+ms)?$/, // vitest/jest file (+ test path)
    /^\s*●\s+(.+?)\s*$/, // jest
    /^\s*[×✕✗]\s+(.+?)(?:\s+\d+ms)?$/, // vitest/jest test line
    /^FAILED\s+(\S+::\S+)/, // pytest
    /^test\s+(\S+)\s+\.\.\.\s+FAILED$/, // cargo
    /^---\s+FAIL:\s+(\S+)/, // go
];
function isNoise(line) {
    return NOISE.some((re) => re.test(line));
}
function isErrorLine(line) {
    return ERROR_LINE.some((re) => re.test(line));
}
function failingTestName(line) {
    for (const re of FAILING_TEST) {
        const m = re.exec(line);
        if (m && m[1])
            return m[1].trim();
    }
    return null;
}
/**
 * Summarize a shell/test/build log to fit `maxChars`. Output already within budget is
 * returned untouched (ANSI and all) — the summarizer only ever runs when something has
 * to be dropped.
 */
function summarizeShellOutput(raw, opts) {
    const tailLines = opts.tailLines ?? DEFAULT_TAIL_LINES;
    if (raw.length <= opts.maxChars) {
        return { text: raw, runner: detectRunner(raw), failingTests: [], droppedNoise: 0 };
    }
    const text = stripAnsi(raw).replace(/\r\n?/g, '\n');
    const runner = detectRunner(text);
    const lines = text.split('\n');
    const tailFrom = Math.max(0, lines.length - tailLines);
    const tail = lines.slice(tailFrom);
    const failing = [];
    const seenFailing = new Set();
    const kept = [];
    const seenKept = new Set();
    let droppedNoise = 0;
    let diffLeft = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const name = failingTestName(line);
        if (name && !seenFailing.has(name)) {
            seenFailing.add(name);
            failing.push(name);
        }
        if (i >= tailFrom)
            continue; // the tail is shown verbatim below
        if (DIFF_HEADER.test(line)) {
            diffLeft = MAX_DIFF_LINES;
            kept.push(line);
            continue;
        }
        if (diffLeft > 0) {
            if (DIFF_BODY.test(line) && !isNoise(line)) {
                kept.push(line);
                diffLeft--;
                continue;
            }
            diffLeft = 0;
        }
        if (isNoise(line)) {
            droppedNoise++;
            continue;
        }
        if (isErrorLine(line)) {
            const key = line.trim();
            if (seenKept.has(key))
                continue;
            seenKept.add(key);
            kept.push(line);
        }
    }
    const header = `[output summarised${runner === 'unknown' ? '' : ` (${runner})`}: ${lines.length.toLocaleString('en-US')} lines / ${raw.length.toLocaleString('en-US')} chars → failing tests, error lines, assertion diffs and the last ${tail.length} lines; ${droppedNoise.toLocaleString('en-US')} passing/progress lines dropped. Re-run a narrower command (one test file, grep) for more.]`;
    const failingBlock = failing.length > 0 ? `Failing tests (${failing.length}):\n${failing.slice(0, 50).map((n) => `  - ${n}`).join('\n')}${failing.length > 50 ? `\n  … +${failing.length - 50} more` : ''}` : '';
    const tailBlock = `--- last ${tail.length} lines ---\n${tail.join('\n')}`;
    // The tail and header are fixed; the error section gets what is left.
    const fixed = [header, failingBlock, tailBlock].filter(Boolean).join('\n\n');
    const room = opts.maxChars - fixed.length - 40;
    let errorsBlock = '';
    if (kept.length > 0 && room > 200) {
        const body = `--- errors (${kept.length} lines) ---\n${kept.join('\n')}`;
        errorsBlock = body.length <= room ? body : cutHead(body, room, { suffix: '\n…[more error lines elided]' });
    }
    const assembled = [header, failingBlock, errorsBlock, tailBlock].filter(Boolean).join('\n\n');
    // Pathological tails (one 50K-char line) still have to fit.
    const fitted = assembled.length <= opts.maxChars ? assembled : cutHeadTail(assembled, opts.maxChars, { headShare: 0.5 });
    return { text: fitted, runner, failingTests: failing, droppedNoise };
}

// ── jsonProjection.ts ──
/**
 * Large-JSON projection. A head slice of a big JSON result hands the model the first
 * few rows and a broken bracket; it never learns what fields exist or how many rows it
 * missed. A projection keeps the SHAPE instead: every top-level key, nested values to a
 * bounded depth, arrays cut to their first items with an explicit count of the rest,
 * and long strings clipped with their length — so the model can re-call the tool with
 * the filter or limit it now knows it needs.
 */
/** Progressively tighter projections, tried in order until one fits. */
const STEPS = [
    { depth: 4, arrayItems: 10, stringChars: 400 },
    { depth: 3, arrayItems: 5, stringChars: 200 },
    { depth: 2, arrayItems: 3, stringChars: 120 },
    { depth: 2, arrayItems: 1, stringChars: 80 },
    { depth: 1, arrayItems: 1, stringChars: 60 },
];
function describe(value) {
    if (Array.isArray(value))
        return `[array: ${value.length} items]`;
    if (value && typeof value === 'object')
        return `{object: ${Object.keys(value).length} keys}`;
    return String(value);
}
function projectValue(value, step, depth) {
    if (typeof value === 'string') {
        return value.length > step.stringChars ? `${value.slice(0, step.stringChars)}…(+${value.length - step.stringChars} chars)` : value;
    }
    if (value === null || typeof value !== 'object')
        return value;
    if (depth >= step.depth)
        return describe(value);
    if (Array.isArray(value)) {
        const head = value.slice(0, step.arrayItems).map((v) => projectValue(v, step, depth + 1));
        if (value.length > step.arrayItems)
            head.push(`…(+${value.length - step.arrayItems} more of ${value.length} items)`);
        return head;
    }
    const out = {};
    for (const [k, v] of Object.entries(value))
        out[k] = projectValue(v, step, depth + 1);
    return out;
}
/**
 * Project `value` to fit `maxChars` of JSON. Top-level keys always survive (depth 0 is
 * never summarised away); arrays and strings shrink step by step until it fits.
 */
function projectJson(value, maxChars) {
    let last = { value: undefined, json: '', fits: false };
    for (const step of STEPS) {
        const projected = projectValue(value, step, 0);
        const json = JSON.stringify(projected);
        last = { value: projected, json, fits: json.length <= maxChars };
        if (last.fits)
            return last;
    }
    return last;
}

// ── readFileWindow.ts ──
/**
 * `read_file` paged at a LINE boundary — lifted from brain-embedded's `toolResultBudget.ts`,
 * which learned it the hard way:
 *
 *   `read_file` returns up to 2,000 lines, then `{content, truncated, totalLines,
 *   offset, note}` — the continuation fields AFTER the content. Slicing the JSON at a
 *   char cap cut mid-line and, because they sit at the end, deleted every one of those
 *   fields. The model was handed ~10% of a 54 KB service file with no line number for
 *   where it stopped, no total, and no `offset` to continue from. Measured on chat #99:
 *   one file read six times, 45% of all calls revisiting ground already covered, and the
 *   requested change never made.
 *
 * So a file read is trimmed the way the tool itself pages: at a line boundary, with the
 * structured fields rewritten to describe exactly what was returned and the precise
 * `offset` that continues it. A large file costs several honest windows instead of one
 * dishonest one — and the model can page forward instead of guessing.
 */
/** Per-result cap for `read_file` (chars of JSON). */
const READ_FILE_RESULT_CHARS = TOOL_OUTPUT_CAPS.read_file ?? 16_000;
function isReadFileResult(out) {
    return !!out && typeof out === 'object' && !Array.isArray(out)
        && out.ok !== false
        && typeof out.content === 'string';
}
/**
 * Cut a `read_file` result to the budget at a line boundary and rewrite its paging
 * fields so the model knows exactly which lines it has and which `offset` continues.
 */
function windowReadFile(out, opts = {}) {
    const maxChars = opts.maxChars ?? READ_FILE_RESULT_CHARS;
    const withNote = (result) => opts.advisory && opts.attachAdvisory ? opts.attachAdvisory(result, opts.advisory) : result;
    const lines = out.content.split('\n');
    const offset = typeof out.offset === 'number' && out.offset > 0 ? Math.floor(out.offset) : 1;
    const totalLines = typeof out.totalLines === 'number' && out.totalLines > 0 ? Math.floor(out.totalLines) : offset + lines.length - 1;
    const alreadyPartial = out.truncated === true;
    const build = (kept, note) => {
        const lastLine = offset + kept.length - 1;
        return withNote({ ...out, content: kept.join('\n'), offset, totalLines, truncated: lastLine < totalLines || alreadyPartial, note });
    };
    const fits = (value) => JSON.stringify(value).length <= maxChars;
    // Whole result within budget: the tool's own fields stand; only the advisory is added.
    const whole = withNote({ ...out });
    if (fits(whole))
        return { value: whole, truncated: false };
    const continuation = (lastLine) => `Showing lines ${offset}–${lastLine} of ${totalLines}. This surface returns at most ~${maxChars.toLocaleString('en-US')} chars per read, so a large file arrives in several windows — call read_file again with offset ${lastLine + 1} to continue from exactly where this one stopped. Do not re-request lines you already have.`;
    // Largest whole-line prefix that fits. Monotonic in the line count, so a binary
    // search over 0..lines.length costs ~11 stringifies of a bounded string.
    let lo = 1;
    let hi = lines.length;
    let best = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (fits(build(lines.slice(0, mid), continuation(offset + mid - 1)))) {
            best = mid;
            lo = mid + 1;
        }
        else {
            hi = mid - 1;
        }
    }
    if (best === 0) {
        // Even the first line alone overflows (a minified bundle, a one-line JSON blob).
        // Paging by line cannot help; hand over as much of it as fits and say so plainly.
        const first = lines[0] ?? '';
        const head = first.slice(0, Math.max(0, maxChars - 600));
        const note = `Line ${offset} of ${totalLines} is longer than the ~${maxChars.toLocaleString('en-US')}-char read budget; the first ${head.length.toLocaleString('en-US')} of its ${first.length.toLocaleString('en-US')} chars are shown. Paging by offset cannot reach the rest of this line — use search_code for the specific symbol instead.`;
        return { value: withNote({ ...out, content: head, offset, totalLines, truncated: true, note }), truncated: true };
    }
    return { value: build(lines.slice(0, best), continuation(offset + best - 1)), truncated: true };
}

// ── policy.ts ──
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
/** Field names that carry a command's log in a structured shell result. */
const LOG_FIELDS = ['output', 'stdout', 'stderr'];
/** Whether `text` reads as a shell/build/test log. */
function isLogLike(text, tool) {
    return (tool !== undefined && isShellTool(tool)) || detectRunner(text) !== 'unknown';
}
/**
 * Fit one text result to `maxChars`. With the lever on, a log is summarized (failing
 * tests, errors, diffs, tail); otherwise `fallback` — head+tail by default, so a
 * command's verdict at the end is never the part that is dropped.
 */
function fitToolText(text, maxChars, opts = {}) {
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
    if (!opts.summarize && tool !== READ_FILE_TOOL)
        return DEFAULT_TOOL_OUTPUT_CHARS;
    return toolOutputCap(tool, opts.caps);
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
 * Shape a tool result for the model transcript. `bytes` is always the ORIGINAL size.
 */
function shapeToolResult(tool, out, opts = {}) {
    const bytes = JSON.stringify(out ?? null).length;
    if (tool === READ_FILE_TOOL && isReadFileResult(out)) {
        const windowed = windowReadFile(out, { maxChars: opts.maxChars, advisory: opts.advisory, attachAdvisory: opts.attachAdvisory });
        return { content: JSON.stringify(windowed.value), bytes, truncated: windowed.truncated };
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

// ── modelPolicy.ts ──
/**
 * The codec seam. `@builderforce/agent-loop`'s `openAiChatCodec({ toolResultPolicy })`
 * takes a plain `(toolName, data) => string` so the kernel stays dependency-free; this
 * builds that function from the shared policy for a surface that has no advisory of its
 * own (the cloud durable loop, the container image loop).
 */
function modelToolResultPolicy(opts) {
    return (toolName, data) => shapeToolResult(toolName, data ?? null, { summarize: opts.summarize, caps: opts.caps }).content;
}

export { SHELL_CAPTURE_CHARS, TOOL_OUTPUT_CAPS, toolOutputCap, keepTail, cutHead, cutHeadTail, summarizeShellOutput, detectRunner, projectJson, windowReadFile, fitToolText, shapeToolResult, modelToolResultPolicy };
