/**
 * GENERATED FILE — do not edit by hand.
 *
 * `@builderforce/agent-loop` (the kernel every agent surface drives), compiled into one
 * dependency-free ESM module for the image surfaces: the Cloudflare Container imports it
 * from `agentImageLoop.mjs`, and the GitHub Actions runner inlines it via
 * `src/application/runtime/generated/agentLoopSource.ts`.
 *
 * Regenerate with `node scripts/gen-agent-loop-bundle.mjs` (from `api/`).
 * `--check` fails the build when the kernel source no longer matches the hash below.
 *
 * @source-sha256 654c4ff2ba190d2e9944e8f1c8cd5df2628743a6c7d6505a4bf5e68b0a3925e7
 */
// ── types.ts ──
/**
 * Contract of THE agent loop.
 *
 * One iteration = ask the model → run every tool it called → ask again, until the
 * model stops calling tools, a tool signals `finish`, a tool asks a human, the run is
 * cancelled or the step budget is spent. The kernel owns exactly that skeleton — the
 * budget, the cancel check, argument parsing, pushing the assistant / tool messages
 * and interpreting the two control signals. Everything a surface does differently
 * (steering, compaction, policy gates, stall recovery, tool selection, telemetry,
 * confirm prompts, read de-duplication) arrives through the ports and hooks below,
 * so the SAME kernel drives the Worker, the browser, Node and the extension host.
 *
 * `M` is the surface's own message type (OpenAI chat rows in most places, pi-style
 * `AgentMessage` in agent-runtime). The kernel never inspects a message — it only
 * asks the codec to build them and pushes them onto the transcript it was handed.
 */
/**
 * Consecutive failed tool dispatches after which a run is stopped, when the surface
 * names no other number. ONE value, owned here, so every surface stops for the same
 * reason at the same point.
 *
 * ── WHY A FAILURE STREAK, AND NOT A STEP COUNT ──────────────────────────────────
 * A run is not wrong for being long. A bulk ticket clean-up, a rename across a
 * repository, a review of forty branches — each is a hundred honest tool calls, and a
 * step ceiling stopped every one of them mid-task with "kept calling tools without
 * finishing". The ceiling existed to catch a run that had stopped making progress, and
 * that condition has a direct signal: tool calls that keep FAILING. So the only limit
 * the kernel applies is this one — a run whose last N dispatches all failed is stuck,
 * and stopping it is what the step cap was always trying to do by proxy. Five is past
 * the point where the repeat-failure advisories (nudge at 2, instruct at 3) have had
 * their say and been ignored.
 */
const DEFAULT_TOOL_FAILURE_STREAK = 5;

// ── parseToolCall.ts ──
/**
 * Turns a raw model tool call into the parsed form every dispatcher wants. Malformed
 * JSON never aborts a run — the call proceeds with `{}` and `malformed: true`, so the
 * tool (or the surface's `beforeDispatch`) can tell the model what went wrong.
 */
/**
 * THE rule for what counts as a tool-argument bag: a plain object, never an array,
 * a scalar or null. Owned here because every surface that hands args to a dispatcher
 * — the kernel below, and any router that unwraps a nested `args` — must agree on it.
 * Anything else collapses to `{}` rather than reaching a tool as a non-bag.
 */
function asToolArgs(value) {
    if (value && typeof value === "object" && !Array.isArray(value))
        return value;
    return null;
}
function parseToolArgs(raw) {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text)
        return { args: {}, malformed: false };
    try {
        const bag = asToolArgs(JSON.parse(text));
        return bag ? { args: bag, malformed: false } : { args: {}, malformed: true };
    }
    catch {
        return { args: {}, malformed: true };
    }
}
function parseToolCall(raw) {
    const { args, malformed } = parseToolArgs(raw.arguments);
    return { id: raw.id, name: raw.name, args, raw, malformed };
}

// ── repetitionLoop.ts ──
/**
 * A model STUCK REPEATING ITSELF — one reading, for every surface.
 *
 * Observed 2026-09-13 (chat #105, `direct/qwen/qwen3.8-max`): after "continue and build
 * it" the model wrote one sentence — "I'll start by checking this chat's linked tickets
 * and locating the Room bubble plus Brain Chat scroll code." — back to back until the
 * output ceiling, and nothing but the user's Stop could end it. The decoder had fallen
 * into a loop; every further token was the same block again.
 *
 * The gateway's coherence gate (`api/…/textCoherence.ts`) only sees ADJACENT word and
 * bigram repeats ("in the in the"), which is how an under-trained head degrades — a
 * frontier model degrades a whole sentence at a time, which that check never fires on.
 *
 * Two places read it: the Brain's stream client cuts a live stream the moment it is seen
 * (and routes the turn to another model), and the loop kernel trims any turn that
 * arrives already looped — the non-streaming server surfaces, the cloud engine and the
 * addressed-agent reply — to what it said before the loop.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────
 * The TAIL of the text is the same block, verbatim, {@link LOOP_MIN_COPIES} times in a
 * row, where the block is at least {@link LOOP_MIN_BLOCK_CHARS} long and reads as prose
 * (several words with letters in them) — or, for a paragraph-length block of at least
 * {@link LOOP_LONG_BLOCK_CHARS}, twice in a row. Checked on the tail only, so it costs a
 * handful of character compares per call, and matches wherever in the block the text stops.
 *
 * ── WHAT IT IS CAREFUL NOT TO CATCH ──────────────────────────────────────────────
 *  - Short repeats ("ok ok ok", a row of `─`): below the block minimum, or not prose.
 *  - Code: text inside an open ``` fence is never judged — three identical lines of
 *    boilerplate are a legitimate answer.
 *  - Near-repeats: a list of similar-but-different items is not periodic, so it passes.
 *
 * ── A RUNAWAY COUNT ──────────────────────────────────────────────────────────────
 * Observed 2026-09-13 (chat #106, `xai-oauth/grok-4.6`): after writing its tool calls as
 * text, the decoder counted `0 1 2 3 … 593` until Stop. Every number differs, so no block
 * repeats and the periodic rule above can never fire. A tail of {@link COUNT_MIN_RUN}
 * integers, each one more than the last, is that failure; `kept` is everything before the
 * count, `block` the count itself and `copies` how many numbers it ran to.
 */
/** Consecutive integers, each one more than the last, before a tail counts as a runaway count. */
const COUNT_MIN_RUN = 50;
/** Longest number a counting run is read over. */
const COUNT_MAX_DIGITS = 6;
const isDigit = (code) => code >= 48 && code <= 57;
/** Space, tab, newline, carriage return, comma — what separates the numbers of a count. */
const isCountSeparator = (code) => code === 32 || code === 9 || code === 10 || code === 13 || code === 44;
/** The counting run the text ends in, or null. Reads backwards and stops at the first break. */
function tailCountingRun(text) {
    let pos = text.length;
    let expected = null;
    let count = 0;
    let start = pos;
    for (;;) {
        let end = pos;
        while (end > 0 && isCountSeparator(text.charCodeAt(end - 1)))
            end -= 1;
        let begin = end;
        while (begin > 0 && end - begin <= COUNT_MAX_DIGITS && isDigit(text.charCodeAt(begin - 1)))
            begin -= 1;
        if (begin === end || end - begin > COUNT_MAX_DIGITS)
            break;
        // A number glued to a word ("v12") is not part of a count.
        if (begin > 0 && !isCountSeparator(text.charCodeAt(begin - 1)))
            break;
        const value = Number(text.slice(begin, end));
        if (expected !== null && value !== expected)
            break;
        count += 1;
        start = begin;
        pos = begin;
        expected = value - 1;
    }
    if (count < COUNT_MIN_RUN)
        return null;
    return { block: text.slice(start).trim(), copies: count, kept: text.slice(0, start).trimEnd() };
}
/** Consecutive verbatim copies of a block before the text counts as looping. */
const LOOP_MIN_COPIES = 3;
/** Shortest block that can count — a sentence, not a word or a divider. */
const LOOP_MIN_BLOCK_CHARS = 40;
/**
 * A block at least this long loops on its SECOND verbatim copy. A sentence said twice
 * can be emphasis; a whole paragraph written out again, character for character and
 * back to back, never is. Observed 2026-09-13 (chat #106, MiniMax): the model replayed
 * its own ~1,300-char run of narration — a dozen DIFFERENT sentences — over and over, so
 * no single sentence repeated and the old 800-char / three-copy rule could never fire.
 */
const LOOP_LONG_BLOCK_CHARS = 240;
/** Copies a {@link LOOP_LONG_BLOCK_CHARS} block needs. */
const LOOP_LONG_MIN_COPIES = 2;
/** Longest block looked for — a replayed paragraph of narration, not a whole answer. */
const LOOP_MAX_BLOCK_CHARS = 4000;
/** Copies a block of `chars` needs, back to back, before it reads as a loop. */
const minCopiesFor = (chars) => (chars >= LOOP_LONG_BLOCK_CHARS ? LOOP_LONG_MIN_COPIES : LOOP_MIN_COPIES);
/** Words (with at least one letter) a block needs before it reads as prose. */
const LOOP_MIN_BLOCK_WORDS = 5;
/** Inside an unclosed ``` fence — code, which is allowed to repeat itself. */
function inOpenCodeFence(text) {
    let fences = 0;
    for (let i = text.indexOf("```"); i !== -1; i = text.indexOf("```", i + 3))
        fences += 1;
    return fences % 2 === 1;
}
function readsAsProse(block) {
    let words = 0;
    for (const word of block.split(/\s+/)) {
        if (/\p{L}/u.test(word))
            words += 1;
        if (words >= LOOP_MIN_BLOCK_WORDS)
            return true;
    }
    return false;
}
/** True when the last `span` characters of `text` repeat with period `p`. */
function tailHasPeriod(text, p, span) {
    const end = text.length;
    for (let i = end - 1; i >= end - span + p; i -= 1) {
        if (text.charCodeAt(i) !== text.charCodeAt(i - p))
            return false;
    }
    return true;
}
/**
 * The loop the text is ending in, or null. Pure; safe to call on every streamed delta.
 * The shortest qualifying block wins, so a loop of a two-sentence block is reported as
 * that block, not as a multiple of it.
 */
function detectRepetitionLoop(text) {
    const counting = tailCountingRun(text);
    if (counting)
        return inOpenCodeFence(text) ? null : counting;
    const length = text.length;
    if (length < LOOP_MIN_COPIES * LOOP_MIN_BLOCK_CHARS)
        return null;
    const maxBlock = Math.min(LOOP_MAX_BLOCK_CHARS, Math.floor(length / LOOP_LONG_MIN_COPIES));
    for (let p = LOOP_MIN_BLOCK_CHARS; p <= maxBlock; p += 1) {
        const copies = minCopiesFor(p);
        if (copies * p > length || !tailHasPeriod(text, p, copies * p))
            continue;
        // Walk back to where the loop began, so `kept` drops every copy but the first and
        // `block` is that first copy as written, not a rotation of it cut mid-sentence.
        let start = length - copies * p;
        while (start > 0 && text.charCodeAt(start - 1) === text.charCodeAt(start - 1 + p))
            start -= 1;
        const block = text.slice(start, start + p);
        if (!readsAsProse(block))
            continue;
        // Checked last: it scans the whole text, and almost every call has no loop to excuse.
        if (inOpenCodeFence(text))
            return null;
        return { block, copies: Math.floor((length - start) / p), kept: text.slice(0, start + p) };
    }
    return null;
}
/** The text with a trailing loop cut back to its first copy; unchanged when there is none. */
function trimRepetitionLoop(text) {
    return detectRepetitionLoop(text)?.kept ?? text;
}

// ── loop.ts ──
/**
 * THE agent loop.
 *
 * Every BuilderForce surface — the cloud Durable Object, rehearsal, the server-side
 * Brain reply, the embedded browser Brain, the creation canvas, the on-prem runtime —
 * drives this ONE function. It owns the model→tools→model skeleton and nothing else;
 * see `types.ts` for the seams where each surface plugs in its own behaviour.
 *
 * Failure policy: the kernel does not catch. A throwing port aborts the run and the
 * surface's own try/finally records it, exactly as before consolidation. The single
 * exception is an abort signal firing mid-port — that is reported as `cancelled`, not
 * rethrown, because every surface treated it that way.
 */
class Ctx {
    messages;
    signal;
    step = 0;
    stepInCall = 0;
    output = "";
    failureStreak = 0;
    constructor(messages, signal) {
        this.messages = messages;
        this.signal = signal;
    }
}
/** How many calls from `start` may dispatch together: the run of consecutive read-only
 *  calls there, when it is at least two long; otherwise 1 (the sequential path). */
function readOnlySpan(calls, start, isReadOnly) {
    let end = start;
    while (end < calls.length && isReadOnly(calls[end]))
        end++;
    return end - start >= 2 ? end - start : 1;
}
export async function runAgentLoop(args) {
    const { codec, ports, budget, signal } = args;
    const hooks = args.hooks ?? {};
    const ctx = new Ctx(args.messages, signal);
    const startStep = Math.max(0, budget.startStep ?? 0);
    const maxThisCall = budget.maxSteps ?? Number.POSITIVE_INFINITY;
    // Read LIVE, not copied: a surface may widen its own budget mid-run (the canvas
    // does, the moment a turn's first workspace write commits and it becomes a build
    // turn). A copy taken here silently pinned such a run to its opening cap.
    const stepCap = () => budget.stepCap ?? Number.POSITIVE_INFINITY;
    const failureStreakCap = budget.failureStreakCap ?? DEFAULT_TOOL_FAILURE_STREAK;
    ctx.step = startStep;
    ctx.output = args.initialOutput ?? "";
    let ok = true;
    let finished = false;
    let cancelled = false;
    // The tool-failure breaker tripped: the run's last `failureStreakCap` dispatches all
    // failed, so it is stuck, not working. The ONLY limit a conversational run has.
    let failuresTripped = false;
    let awaitingInput;
    const isCancelled = async () => Boolean(signal?.aborted) || Boolean(await hooks.isCancelled?.(ctx));
    for (; ctx.step < stepCap() && !finished && ctx.stepInCall < maxThisCall; ctx.step++, ctx.stepInCall++) {
        if (await isCancelled()) {
            cancelled = true;
            break;
        }
        const before = await hooks.beforeTurn?.(ctx);
        if (before?.action === "stop") {
            ok = before.ok ?? false;
            if (before.output !== undefined)
                ctx.output = before.output;
            finished = before.finished ?? true;
            break;
        }
        let turnResult;
        try {
            turnResult = await ports.complete(ctx);
        }
        catch (err) {
            if (signal?.aborted) {
                cancelled = true;
                break;
            }
            throw err;
        }
        if ("skip" in turnResult)
            continue;
        if ("failed" in turnResult) {
            ok = false;
            ctx.output = turnResult.failed;
            finished = true;
            break;
        }
        let turn = turnResult;
        // A turn that arrives stuck repeating one block of prose keeps only what it said
        // before the loop. A streaming surface cuts the loop live; this catches every
        // surface that receives a whole completion at once.
        const looped = turn.content ? detectRepetitionLoop(turn.content) : null;
        if (looped) {
            turn = { ...turn, content: looped.kept };
            await hooks.onRepetitionLoop?.(ctx, looped);
        }
        if (turn.content)
            ctx.output = turn.content;
        await hooks.afterTurn?.(ctx, turn);
        if (turn.toolCalls.length === 0) {
            const decision = (await hooks.onNoToolCalls?.(ctx, turn)) ?? { action: "finish" };
            if (decision.action === "continue")
                continue;
            if (decision.action === "stop") {
                ok = decision.ok ?? false;
                if (decision.output !== undefined)
                    ctx.output = decision.output;
                finished = decision.finished ?? true;
                break;
            }
            if (decision.output !== undefined)
                ctx.output = decision.output;
            finished = true;
            break;
        }
        const calls = turn.toolCalls.map(parseToolCall);
        const gate = await hooks.beforeToolCalls?.(ctx, turn, calls);
        if (gate?.action === "stop") {
            ok = gate.ok ?? true;
            if (gate.output !== undefined)
                ctx.output = gate.output;
            finished = gate.finished ?? true;
            break;
        }
        ctx.messages.push(codec.assistant(turn));
        // Settle one dispatched call, in call order: interpret its control signal, count it
        // against the failure streak, push its row and run `afterDispatch`. True ⇒ the hook
        // abandoned the rest of the turn (every later call already has its skipped row).
        const settle = async (i, call, dispatched) => {
            let result = dispatched;
            if (result.control?.kind === "finish") {
                const block = await hooks.onFinish?.(ctx, result.control.summary, call);
                if (block) {
                    result = { data: { ok: false, error: block }, isError: true };
                }
                else {
                    finished = true;
                    if (result.control.summary)
                        ctx.output = result.control.summary;
                }
            }
            else if (result.control?.kind === "ask_human") {
                await hooks.onAskHuman?.(ctx, result.control, call);
                awaitingInput = { approvalId: result.control.approvalId, question: result.control.question, callId: call.id };
            }
            // A control signal is the run steering itself, not a tool failing; only a dispatch
            // the surface flagged as an error counts, and any success clears the streak. The
            // skipped remainder of a steered turn is not counted either — those calls never ran.
            if (!result.control)
                ctx.failureStreak = result.isError ? ctx.failureStreak + 1 : 0;
            const row = codec.tool(call, result);
            ctx.messages.push(row);
            const post = await hooks.afterDispatch?.(call, result, row, ctx);
            if (!post?.skipRemaining)
                return false;
            const skipped = { data: post.skipRemaining.data, isError: post.skipRemaining.isError ?? true };
            for (const rest of calls.slice(i + 1))
                ctx.messages.push(codec.tool(rest, skipped));
            return true;
        };
        for (let i = 0; i < calls.length;) {
            // D8: a run of consecutive read-only calls is dispatched together. `beforeDispatch`
            // still runs once per call, in order, BEFORE any of them dispatches; results are
            // settled in call order, so the transcript and every later hook see exactly the
            // sequential shape. A call whose `beforeDispatch` answered with a control signal,
            // or rewrote it into a call that is not read-only, closes the batch at itself.
            const span = ports.isReadOnly ? readOnlySpan(calls, i, ports.isReadOnly) : 1;
            const prepared = [];
            for (let j = i; j < i + span; j++) {
                let call = calls[j];
                let result;
                const pre = await hooks.beforeDispatch?.(call, ctx);
                if (pre && "result" in pre)
                    result = pre.result;
                else if (pre && "rewrite" in pre)
                    call = pre.rewrite;
                prepared.push(result ? { call, result } : { call });
                if (span > 1 && (result?.control || (!result && !ports.isReadOnly(call))))
                    break;
            }
            const last = prepared[prepared.length - 1];
            // A batch's trailing non-read-only rewrite runs AFTER the reads before it, alone.
            const tail = prepared.length > 1 && !last.result && !ports.isReadOnly(last.call) ? last : undefined;
            const batch = tail ? prepared.slice(0, -1) : prepared;
            const results = batch.length > 1
                ? await Promise.all(batch.map((p) => p.result ?? ports.dispatch(p.call, ctx)))
                : [batch[0].result ?? (await ports.dispatch(batch[0].call, ctx))];
            if (tail)
                results.push(await ports.dispatch(tail.call, ctx));
            let stop = false;
            for (let k = 0; k < prepared.length && !stop; k++)
                stop = await settle(i + k, prepared[k].call, results[k]);
            if (stop)
                break;
            i += prepared.length;
        }
        const after = await hooks.afterToolCalls?.(ctx, finished);
        if (after && after.finished !== undefined)
            finished = after.finished;
        if (awaitingInput)
            break;
        if (!finished && ctx.failureStreak >= failureStreakCap) {
            // The turn ran, so it is counted (the for-update is skipped by `break`); a
            // tripped breaker is terminal, so nothing resumes from this index anyway.
            ctx.step++;
            ctx.stepInCall++;
            failuresTripped = true;
            break;
        }
    }
    const exhausted = !finished && !cancelled && !awaitingInput && (failuresTripped || ctx.step >= stepCap());
    return {
        ok,
        output: ctx.output,
        finished,
        cancelled,
        step: ctx.step,
        exhausted,
        ...(exhausted ? { exhaustedBy: failuresTripped ? "failures" : "steps" } : {}),
        failureStreak: ctx.failureStreak,
        ...(awaitingInput ? { awaitingInput } : {}),
    };
}

// ── openaiCodec.ts ──
/**
 * The codec for every surface whose transcript is OpenAI chat-completion rows — the
 * cloud loop, the server Brain, the embedded Brain and the creation canvas. The tool
 * row's content is produced by the `serialize` the surface hands in, so payload
 * budgeting (the Brain trims, the cloud stringifies, the Brain reply slices) stays
 * with the surface while the ROW SHAPE lives here once.
 */
function toOpenAiToolCall(call) {
    // An empty / whitespace-only `arguments` string is not valid JSON; strict vendors
    // (Gemini) reject it. Normalize a no-arg call to an empty object.
    return { id: call.id, type: "function", function: { name: call.name, arguments: call.arguments?.trim() ? call.arguments : "{}" } };
}
const defaultToolRowSerializer = (result) => JSON.stringify(result.data ?? null);
function resolveSerializer(opts) {
    if (typeof opts === "function")
        return opts;
    if (opts?.serialize)
        return opts.serialize;
    const policy = opts?.toolResultPolicy;
    if (policy)
        return (result, call) => policy(call.name, result.data ?? null);
    return defaultToolRowSerializer;
}
/**
 * `M` is the surface's row type; it must be assignable FROM the assistant/tool rows
 * above (an `Array<Record<string, unknown>>` transcript qualifies).
 *
 * Takes the surface's serializer directly (the long-standing form), or options — where
 * `toolResultPolicy` opts the surface into the shared per-result budget.
 */
export function openAiChatCodec(serializeOrOptions) {
    const serialize = resolveSerializer(serializeOrOptions);
    return {
        assistant(turn) {
            const row = {
                role: "assistant",
                content: turn.content ?? "",
                tool_calls: turn.toolCalls.map(toOpenAiToolCall),
            };
            return row;
        },
        tool(call, result) {
            const row = { role: "tool", tool_call_id: call.id, content: serialize(result, call) };
            return row;
        },
    };
}
/** Reads the model's tool calls off an OpenAI-shape assistant message into the kernel's raw form. */
export function readOpenAiToolCalls(message) {
    const raw = message?.tool_calls;
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const tc of raw) {
        const fn = tc?.function;
        const name = typeof fn?.name === "string" ? fn.name : "";
        if (!name)
            continue;
        const idRaw = tc.id;
        const id = typeof idRaw === "string" && idRaw ? idRaw : `call_${out.length}`;
        const args = typeof fn?.arguments === "string" ? fn.arguments : fn?.arguments == null ? "" : JSON.stringify(fn.arguments);
        out.push({ id, name, arguments: args });
    }
    return out;
}
