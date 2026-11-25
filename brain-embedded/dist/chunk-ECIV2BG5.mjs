// ../packages/agent-loop/src/types.ts
var DEFAULT_TOOL_FAILURE_STREAK = 5;

// ../packages/agent-loop/src/stepRow.ts
var STEP_RESULT_CAP = 4e3;
function capped(value) {
  let s;
  try {
    s = JSON.stringify(value ?? null);
  } catch {
    return String(value);
  }
  return s.length > STEP_RESULT_CAP ? `${s.slice(0, STEP_RESULT_CAP)}\u2026[${s.length - STEP_RESULT_CAP} more chars]` : value ?? null;
}
function stepRow(step) {
  const metadata = JSON.stringify({
    kind: "step",
    category: step.category,
    label: step.label,
    args: step.args ?? null,
    result: capped(step.result),
    isError: step.isError ?? false,
    // Diagnostics scalars — tiny, and the whole point of keeping the row.
    ...step.durationMs != null ? { durationMs: step.durationMs } : {},
    ...step.resultBytes != null ? { resultBytes: step.resultBytes } : {},
    ...step.truncated ? { truncated: true } : {},
    ...step.usage ? { usage: step.usage } : {},
    ...step.finishReason != null ? { finishReason: step.finishReason } : {},
    ...step.textChars != null ? { textChars: step.textChars } : {},
    ...step.ttftMs != null ? { ttftMs: step.ttftMs } : {},
    ts: step.ts
  });
  return { role: "tool", content: "", metadata };
}

// ../packages/agent-loop/src/parseToolCall.ts
function asToolArgs(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return null;
}
function parseToolArgs(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { args: {}, malformed: false };
  try {
    const bag = asToolArgs(JSON.parse(text));
    return bag ? { args: bag, malformed: false } : { args: {}, malformed: true };
  } catch {
    return { args: {}, malformed: true };
  }
}
function parseToolCall(raw) {
  const { args, malformed } = parseToolArgs(raw.arguments);
  return { id: raw.id, name: raw.name, args, raw, malformed };
}

// ../packages/agent-loop/src/repetitionLoop.ts
var COUNT_MIN_RUN = 50;
var COUNT_MAX_DIGITS = 6;
var isDigit = (code) => code >= 48 && code <= 57;
var isCountSeparator = (code) => code === 32 || code === 9 || code === 10 || code === 13 || code === 44;
function tailCountingRun(text) {
  let pos = text.length;
  let expected = null;
  let count = 0;
  let start = pos;
  for (; ; ) {
    let end = pos;
    while (end > 0 && isCountSeparator(text.charCodeAt(end - 1))) end -= 1;
    let begin = end;
    while (begin > 0 && end - begin <= COUNT_MAX_DIGITS && isDigit(text.charCodeAt(begin - 1))) begin -= 1;
    if (begin === end || end - begin > COUNT_MAX_DIGITS) break;
    if (begin > 0 && !isCountSeparator(text.charCodeAt(begin - 1))) break;
    const value = Number(text.slice(begin, end));
    if (expected !== null && value !== expected) break;
    count += 1;
    start = begin;
    pos = begin;
    expected = value - 1;
  }
  if (count < COUNT_MIN_RUN) return null;
  return { block: text.slice(start).trim(), copies: count, kept: text.slice(0, start).trimEnd() };
}
var LOOP_MIN_COPIES = 3;
var LOOP_MIN_BLOCK_CHARS = 40;
var LOOP_LONG_BLOCK_CHARS = 240;
var LOOP_LONG_MIN_COPIES = 2;
var LOOP_MAX_BLOCK_CHARS = 4e3;
var minCopiesFor = (chars) => chars >= LOOP_LONG_BLOCK_CHARS ? LOOP_LONG_MIN_COPIES : LOOP_MIN_COPIES;
var LOOP_MIN_BLOCK_WORDS = 5;
function inOpenCodeFence(text) {
  let fences = 0;
  for (let i = text.indexOf("```"); i !== -1; i = text.indexOf("```", i + 3)) fences += 1;
  return fences % 2 === 1;
}
function readsAsProse(block) {
  let words = 0;
  for (const word of block.split(/\s+/)) {
    if (/\p{L}/u.test(word)) words += 1;
    if (words >= LOOP_MIN_BLOCK_WORDS) return true;
  }
  return false;
}
function tailHasPeriod(text, p, span) {
  const end = text.length;
  for (let i = end - 1; i >= end - span + p; i -= 1) {
    if (text.charCodeAt(i) !== text.charCodeAt(i - p)) return false;
  }
  return true;
}
function detectRepetitionLoop(text) {
  const counting = tailCountingRun(text);
  if (counting) return inOpenCodeFence(text) ? null : counting;
  const length = text.length;
  if (length < LOOP_MIN_COPIES * LOOP_MIN_BLOCK_CHARS) return null;
  const maxBlock = Math.min(LOOP_MAX_BLOCK_CHARS, Math.floor(length / LOOP_LONG_MIN_COPIES));
  for (let p = LOOP_MIN_BLOCK_CHARS; p <= maxBlock; p += 1) {
    const copies = minCopiesFor(p);
    if (copies * p > length || !tailHasPeriod(text, p, copies * p)) continue;
    let start = length - copies * p;
    while (start > 0 && text.charCodeAt(start - 1) === text.charCodeAt(start - 1 + p)) start -= 1;
    const block = text.slice(start, start + p);
    if (!readsAsProse(block)) continue;
    if (inOpenCodeFence(text)) return null;
    return { block, copies: Math.floor((length - start) / p), kept: text.slice(0, start + p) };
  }
  return null;
}
function trimRepetitionLoop(text) {
  return detectRepetitionLoop(text)?.kept ?? text;
}

// ../packages/agent-loop/src/loop.ts
var Ctx = class {
  constructor(messages, signal) {
    this.messages = messages;
    this.signal = signal;
  }
  messages;
  signal;
  step = 0;
  stepInCall = 0;
  output = "";
  failureStreak = 0;
};
var CANCELLED = /* @__PURE__ */ Symbol("cancelled");
function raceCancel(work, signal) {
  if (!signal) return work;
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(CANCELLED);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}
function readOnlySpan(calls, start, isReadOnly) {
  let end = start;
  while (end < calls.length && isReadOnly(calls[end])) end++;
  return end - start >= 2 ? end - start : 1;
}
async function runAgentLoop(args) {
  const { codec, ports, budget, signal } = args;
  const hooks = args.hooks ?? {};
  const ctx = new Ctx(args.messages, signal);
  const startStep = Math.max(0, budget.startStep ?? 0);
  const maxThisCall = budget.maxSteps ?? Number.POSITIVE_INFINITY;
  const stepCap = () => budget.stepCap ?? Number.POSITIVE_INFINITY;
  const failureStreakCap = budget.failureStreakCap ?? DEFAULT_TOOL_FAILURE_STREAK;
  ctx.step = startStep;
  ctx.output = args.initialOutput ?? "";
  let ok = true;
  let finished = false;
  let cancelled = false;
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
      if (before.output !== void 0) ctx.output = before.output;
      finished = before.finished ?? true;
      break;
    }
    let turnResult;
    try {
      turnResult = await ports.complete(ctx);
    } catch (err) {
      if (signal?.aborted) {
        cancelled = true;
        break;
      }
      throw err;
    }
    if ("skip" in turnResult) continue;
    if ("failed" in turnResult) {
      ok = false;
      ctx.output = turnResult.failed;
      finished = true;
      break;
    }
    let turn = turnResult;
    const looped = turn.content ? detectRepetitionLoop(turn.content) : null;
    if (looped) {
      turn = { ...turn, content: looped.kept };
      await hooks.onRepetitionLoop?.(ctx, looped);
    }
    if (turn.content) ctx.output = turn.content;
    await hooks.afterTurn?.(ctx, turn);
    if (turn.toolCalls.length === 0) {
      const decision = await hooks.onNoToolCalls?.(ctx, turn) ?? { action: "finish" };
      if (decision.action === "continue") continue;
      if (decision.action === "stop") {
        ok = decision.ok ?? false;
        if (decision.output !== void 0) ctx.output = decision.output;
        finished = decision.finished ?? true;
        break;
      }
      if (decision.output !== void 0) ctx.output = decision.output;
      finished = true;
      break;
    }
    const calls = turn.toolCalls.map(parseToolCall);
    const gate = await hooks.beforeToolCalls?.(ctx, turn, calls);
    if (gate?.action === "stop") {
      ok = gate.ok ?? true;
      if (gate.output !== void 0) ctx.output = gate.output;
      finished = gate.finished ?? true;
      break;
    }
    ctx.messages.push(codec.assistant(turn));
    const settle = async (i, call, dispatched) => {
      let result = dispatched;
      if (result.control?.kind === "finish") {
        const block = await hooks.onFinish?.(ctx, result.control.summary, call);
        if (typeof block === "object" && block !== null) {
          result = { data: { ok: true, finished: false, note: block.note } };
        } else if (block) {
          result = { data: { ok: false, error: block }, isError: true };
        } else {
          finished = true;
          if (result.control.summary) ctx.output = result.control.summary;
        }
      } else if (result.control?.kind === "ask_human") {
        const answered = await hooks.onAskHuman?.(ctx, result.control, call);
        if (answered) result = answered;
        else awaitingInput = { approvalId: result.control.approvalId, question: result.control.question, callId: call.id };
      }
      if (!result.control) ctx.failureStreak = result.isError ? ctx.failureStreak + 1 : 0;
      const row = codec.tool(call, result);
      ctx.messages.push(row);
      const post = await hooks.afterDispatch?.(call, result, row, ctx);
      if (!post?.skipRemaining) return false;
      const skipped = { data: post.skipRemaining.data, isError: post.skipRemaining.isError ?? true };
      for (const rest of calls.slice(i + 1)) ctx.messages.push(codec.tool(rest, skipped));
      return true;
    };
    for (let i = 0; i < calls.length; ) {
      const span = ports.isReadOnly ? readOnlySpan(calls, i, ports.isReadOnly) : 1;
      const prepared = [];
      for (let j = i; j < i + span; j++) {
        let call = calls[j];
        let result;
        const pre = await hooks.beforeDispatch?.(call, ctx);
        if (pre && "result" in pre) result = pre.result;
        else if (pre && "rewrite" in pre) call = pre.rewrite;
        prepared.push(result ? { call, result } : { call });
        if (span > 1 && (result?.control || !result && !ports.isReadOnly(call))) break;
      }
      const last = prepared[prepared.length - 1];
      const tail = prepared.length > 1 && !last.result && !ports.isReadOnly(last.call) ? last : void 0;
      const batch = tail ? prepared.slice(0, -1) : prepared;
      const start = (call) => signal?.aborted ? Promise.resolve(CANCELLED) : raceCancel(ports.dispatch(call, ctx), signal);
      const dispatchOne = (p) => p.result ? Promise.resolve(p.result) : start(p.call);
      const results = await Promise.all(batch.map(dispatchOne));
      if (tail && !results.includes(CANCELLED)) results.push(await start(tail.call));
      if (results.includes(CANCELLED)) {
        const stopped = { data: { ok: false, aborted: true, error: "stopped" }, isError: true };
        for (const rest of calls.slice(i)) ctx.messages.push(codec.tool(rest, stopped));
        cancelled = true;
        break;
      }
      let stop = false;
      for (let k = 0; k < prepared.length && !stop; k++) stop = await settle(i + k, prepared[k].call, results[k]);
      if (stop) break;
      i += prepared.length;
    }
    if (cancelled) break;
    const after = await hooks.afterToolCalls?.(ctx, finished);
    if (after && after.finished !== void 0) finished = after.finished;
    if (awaitingInput) break;
    if (!finished && ctx.failureStreak >= failureStreakCap) {
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
    ...exhausted ? { exhaustedBy: failuresTripped ? "failures" : "steps" } : {},
    failureStreak: ctx.failureStreak,
    ...awaitingInput ? { awaitingInput } : {}
  };
}

// ../packages/agent-loop/src/malformedCall.ts
var MALFORMED_CALL_RESULT = "This tool call's arguments were not valid JSON, so it was NOT executed. Re-issue it with strictly valid JSON: no comments, no trailing commas, no unescaped newlines or quotes inside string values.";
var TRUNCATED_CALL_RESULT = "This tool call was cut off by the output limit before its arguments were complete, so it was NOT executed. Re-issue it in your next response as ONE call with complete JSON \u2014 never several calls in one response. If the content is long, write it in parts: create it with its essential fields first, then extend it with follow-up calls.";
function malformedCallOutcome(call, truncated, retryHint) {
  if (!call.malformed) return null;
  const base = truncated ? TRUNCATED_CALL_RESULT : MALFORMED_CALL_RESULT;
  return { error: retryHint ? `${base} ${retryHint}` : base };
}
function malformedCallLabel(name, truncated) {
  return truncated ? `${name} (cut off by the output limit)` : `${name} (unparseable arguments)`;
}

// ../packages/agent-loop/src/runNarration.ts
var NARRATION_OPENER = new RegExp(
  "^(?:(?:now|next|first|then|so|okay|ok|alright|actually|great|good|perfect|but|and|also|finally)[,!.]?\\s+)*(?:let me|let's|i(?:'ll| will| need to| should| want to| am going to|'m going to| think| see| can see| notice| ran)\\b|looking (?:at|back|for)\\b|checking\\b|now the\\b|that was expected\\b)",
  "i"
);

// ../packages/agent-loop/src/turnPhase.ts
var MID_TURN_META_KEY = "midTurn";
function isMidTurnMetadata(metadata) {
  let meta = metadata;
  if (typeof meta === "string") {
    if (!meta.includes(MID_TURN_META_KEY)) return false;
    try {
      meta = JSON.parse(meta);
    } catch {
      return false;
    }
  }
  return typeof meta === "object" && meta !== null && meta[MID_TURN_META_KEY] === true;
}

// ../packages/agent-loop/src/taskClosedState.ts
var ARCHIVED_TASK_STATUS = "archived";
var TASK_CLOSED_STATUSES = ["done", "cancelled", "canceled", "completed", ARCHIVED_TASK_STATUS];
var CLOSED = new Set(TASK_CLOSED_STATUSES);
function isClosedTaskStatus(status) {
  return status != null && CLOSED.has(status.trim().toLowerCase());
}
var TASK_CANCELLED_STATUSES = ["cancelled", "canceled"];
var CANCELLED2 = new Set(TASK_CANCELLED_STATUSES);

// ../packages/agent-loop/src/ticketClosedStates.ts
var TASK_TABLE = { closed: TASK_CLOSED_STATUSES, cancelled: TASK_CANCELLED_STATUSES };
var CEREMONY_SESSION_CLOSED_STATUSES = ["completed", "cancelled", "closed", "archived"];
var CEREMONY_SESSION = { closed: CEREMONY_SESSION_CLOSED_STATUSES, cancelled: [] };
var PORTFOLIO_STATUSES = ["active", "archived", "cancelled"];
var INITIATIVE_STATUSES = ["proposed", "active", "completed", "archived", "cancelled"];
var OBJECTIVE_STATUSES = ["active", "achieved", "missed", "archived", "cancelled"];
var ROADMAP_STATUSES = ["planned", "in_progress", "shipped", "cancelled"];
var ROADMAP_LEGACY_DELIVERED_STATUSES = ["done", "complete", "completed", "released"];
function pick(_vocabulary, ...words) {
  return words;
}
var TICKET_STATUS_ALIASES = {
  roadmap: Object.fromEntries(ROADMAP_LEGACY_DELIVERED_STATUSES.map((word) => [word, "shipped"]))
};
var TICKET_CLOSED_STATES = {
  // agent-loop `taskClosedState.ts` TASK_CLOSED_STATUSES / TASK_CANCELLED_STATUSES.
  task: TASK_TABLE,
  gap: TASK_TABLE,
  epic: TASK_TABLE,
  portfolio: { closed: pick(PORTFOLIO_STATUSES, "archived"), cancelled: [] },
  initiative: { closed: pick(INITIATIVE_STATUSES, "completed", "archived"), cancelled: [] },
  // A MISSED objective is over without delivering, so it is skipped like a cancelled lane
  // rather than counted done (its own ring still reads 100: it is closed).
  objective: { closed: pick(OBJECTIVE_STATUSES, "achieved", "missed", "archived"), cancelled: pick(OBJECTIVE_STATUSES, "missed") },
  // Legacy delivered spellings are still read as closed: older rows carry them.
  roadmap: { closed: [...pick(ROADMAP_STATUSES, "shipped"), ...ROADMAP_LEGACY_DELIVERED_STATUSES], cancelled: [] },
  // api schema/kernel.ts `specStatusEnum`: draft | ready | in_progress | complete (a pg
  // enum, so the api test asserts this word is one of its values).
  spec: { closed: ["complete"], cancelled: [] },
  retro: CEREMONY_SESSION,
  poker: CEREMONY_SESSION
};
var CLOSED_BY_KIND = new Map(
  Object.entries(TICKET_CLOSED_STATES).map(([kind, v]) => [kind, { closed: new Set(v.closed), cancelled: new Set(v.cancelled) }])
);

// ../packages/agent-loop/src/reasoning.ts
var REASONING_TAG = "think(?:ing)?|thought|antthinking|scratchpad|reasoning";
var QUICK_TAG_RE = new RegExp(`<\\s*/?\\s*(?:${REASONING_TAG}|final)\\b`, "i");
var FINAL_TAG_RE = /<\s*\/?\s*final\b[^<>]*>/gi;
var REASONING_TAG_RE = new RegExp(`<\\s*(/?)\\s*(?:${REASONING_TAG})\\b[^<>]*>`, "gi");
function findCodeRegions(text) {
  const regions = [];
  const fencedRe = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?(?:(\n\2(?:\n|$))|$)/g;
  for (const match of text.matchAll(fencedRe)) {
    const lead = match[1] ?? "";
    const start = (match.index ?? 0) + lead.length;
    regions.push({ start, end: start + match[0].length - lead.length, unterminated: match[3] === void 0 });
  }
  const inlineRe = /`+(?:[^`\n]|\n(?![ \t]*\n))+`+/g;
  for (const match of text.matchAll(inlineRe)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const insideFenced = regions.some((r) => start >= r.start && end <= r.end);
    if (!insideFenced) regions.push({ start, end });
  }
  regions.sort((a, b) => a.start - b.start);
  return regions;
}
function isInsideCode(pos, regions) {
  return regions.some((r) => pos >= r.start && pos < r.end);
}
function codeRegionAt(pos, regions) {
  return regions.find((r) => pos >= r.start && pos < r.end);
}
function scanReasoning(text) {
  const regions = findCodeRegions(text);
  const spans = [];
  let kind = "answer";
  let start = 0;
  let contentStart = 0;
  REASONING_TAG_RE.lastIndex = 0;
  for (const match of text.matchAll(REASONING_TAG_RE)) {
    const idx = match.index ?? 0;
    const isClose = match[1] === "/";
    const region = codeRegionAt(idx, regions);
    if (region) {
      const releases = region.unterminated === true && kind === "thought" && isClose && region.start >= contentStart;
      if (!releases) continue;
      region.end = idx;
    }
    if (kind === "thought" && !isClose) continue;
    const after = idx + match[0].length;
    spans.push({ kind, start, contentStart, contentEnd: idx, end: isClose ? after : idx, unterminated: false });
    kind = isClose ? "answer" : "thought";
    start = isClose ? after : idx;
    contentStart = after;
  }
  spans.push({
    kind,
    start,
    contentStart,
    contentEnd: text.length,
    end: text.length,
    unterminated: kind === "thought"
  });
  return spans;
}
function splitReasoningSegments(text) {
  if (!text) return [];
  if (!QUICK_TAG_RE.test(text)) return [{ kind: "answer", content: text }];
  const cleaned = unwrapFinalTags(text);
  const segments = segmentsOf(cleaned, scanReasoning(cleaned));
  if (segments.length === 0) return [{ kind: "answer", content: text }];
  return stitchSplitSentence(promoteSwallowedAnswer(segments));
}
var EMPTY_TOOL_CALL_WRAPPER = /<([a-z][\w-]*:tool_call)\b[^<>]*>\s*<\/\1>/gi;
function segmentsOf(text, spans) {
  const out = [];
  for (const span of spans) {
    const raw = text.slice(span.contentStart, span.contentEnd);
    const content = (span.kind === "thought" ? raw.replace(EMPTY_TOOL_CALL_WRAPPER, "") : raw).trim();
    if (content) out.push({ kind: span.kind, content });
  }
  return out;
}
function unwrapFinalTags(text) {
  FINAL_TAG_RE.lastIndex = 0;
  if (!FINAL_TAG_RE.test(text)) {
    FINAL_TAG_RE.lastIndex = 0;
    return text;
  }
  FINAL_TAG_RE.lastIndex = 0;
  const regions = findCodeRegions(text);
  const cuts = [];
  for (const match of text.matchAll(FINAL_TAG_RE)) {
    const start = match.index ?? 0;
    if (!isInsideCode(start, regions)) cuts.push({ start, length: match[0].length });
  }
  let out = text;
  for (let i = cuts.length - 1; i >= 0; i--) {
    const cut = cuts[i];
    out = out.slice(0, cut.start) + out.slice(cut.start + cut.length);
  }
  return out;
}
function stripReasoningTagsFromText(text, options) {
  if (!text) return text;
  if (!QUICK_TAG_RE.test(text)) return text;
  const mode = options?.mode ?? "strict";
  const trimMode = options?.trim ?? "both";
  const cleaned = unwrapFinalTags(text);
  let result = "";
  for (const span of scanReasoning(cleaned)) {
    if (span.kind === "answer") result += cleaned.slice(span.contentStart, span.contentEnd);
    else if (span.unterminated && mode === "preserve") result += cleaned.slice(span.contentStart, span.contentEnd);
  }
  if (trimMode === "none") return result;
  return trimMode === "start" ? result.trimStart() : result.trim();
}
var MAX_FRAGMENT_CHARS = 40;
var REPLY_OPENER = /^[A-Z0-9#*\-_>`[|("']/;
function isFragment(text) {
  return text.length > 0 && text.length <= MAX_FRAGMENT_CHARS && !REPLY_OPENER.test(text);
}
function promoteSwallowedAnswer(segments) {
  const answers = segments.filter((s) => s.kind === "answer");
  if (answers.length === 0) return segments;
  const answerText = answers.map((s) => s.content).join(" ").trim();
  if (!isFragment(answerText)) return segments;
  const thoughts = segments.filter((s) => s.kind === "thought");
  const richest = thoughts.reduce(
    (best, s) => !best || s.content.length > best.content.length ? s : best,
    null
  );
  if (!richest || richest.content.length <= answerText.length) return segments;
  const promoted = [{ kind: "answer", content: `${richest.content} ${answerText}`.trim() }];
  for (const s of thoughts) if (s !== richest) promoted.unshift(s);
  return promoted;
}
var UNFINISHED_TAIL = /[\p{L}\p{N},]$/u;
var LOWERCASE_OPENER = /^\p{Ll}/u;
function lastSentenceStart(text) {
  let cut = text.lastIndexOf("\n") + 1;
  for (const match of text.matchAll(/[.!?](?=\s)/g)) {
    const after = (match.index ?? 0) + 1;
    if (after > cut) cut = after;
  }
  return cut;
}
function stitchSplitSentence(segments) {
  const out = [...segments];
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    if (prev.kind !== "thought" || cur.kind !== "answer") continue;
    if (cur.content.length <= MAX_FRAGMENT_CHARS) continue;
    if (!LOWERCASE_OPENER.test(cur.content) || !UNFINISHED_TAIL.test(prev.content)) continue;
    const cut = lastSentenceStart(prev.content);
    const head = prev.content.slice(0, cut).trim();
    out[i] = { kind: "answer", content: `${prev.content.slice(cut).trim()} ${cur.content}` };
    if (head) {
      out[i - 1] = { kind: "thought", content: head };
    } else {
      out.splice(i - 1, 1);
      i -= 1;
    }
  }
  return out;
}
function answerTextOf(content) {
  return splitReasoningSegments(content).filter((s) => s.kind === "answer").map((s) => s.content).join("\n\n").trim();
}
function thoughtTextOf(content) {
  return splitReasoningSegments(content).filter((s) => s.kind === "thought").map((s) => s.content).join("\n\n").trim();
}
function replayTextOf(content) {
  return answerTextOf(content) || thoughtTextOf(content);
}
function detailsText(details) {
  if (!Array.isArray(details)) return "";
  return details.map((d) => {
    const item = d;
    return item && (item.type === void 0 || item.type === "reasoning.text") && typeof item.text === "string" ? item.text : "";
  }).filter(Boolean).join("\n");
}
function splitVendorReasoning(message) {
  const rawContent = typeof message?.content === "string" ? message.content : "";
  const inlineThought = thoughtTextOf(rawContent);
  const content = inlineThought ? answerTextOf(rawContent) : rawContent;
  const structured = [
    typeof message?.reasoning_content === "string" ? message.reasoning_content : "",
    typeof message?.reasoning === "string" ? message.reasoning : "",
    detailsText(message?.reasoning_details)
  ].map((s) => s.trim()).filter(Boolean);
  const reasoning = [...structured, ...inlineThought ? [inlineThought] : []].join("\n\n").trim();
  return { content, reasoning };
}
function canonicalReasoningText(content, reasoning) {
  const answer = (content ?? "").trim();
  const thought = (reasoning ?? "").trim();
  if (!thought) return answer;
  return answer ? `<think>${thought}</think>

${answer}` : `<think>${thought}</think>`;
}

// ../packages/agent-loop/src/index.ts
var ASK_USER_TOOL = "ask_user";
var ASK_USER_TOOL_SPEC = {
  type: "function",
  function: {
    name: ASK_USER_TOOL,
    description: `Ask the user to choose between options when you genuinely cannot proceed without their decision (e.g. who owns this, which approach, create under X or Y). Prefer this over asking in prose \u2014 the UI renders your options as clickable buttons and the choice returns as the user's next message. Do NOT use it for questions you can answer yourself from the code or context. When one option is the choice you would advise (e.g. the sensible default), mark it with "recommended": true so a default/auto pick can select it.`,
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The single, specific question to ask." },
        options: {
          type: "array",
          description: "2\u20136 distinct, mutually-exclusive choices (unless multiSelect).",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Short choice text (1\u20135 words)." },
              description: { type: "string", description: "Optional one-line explanation of this choice." },
              recommended: { type: "boolean", description: "Optional: true on the option you would advise as the default pick." }
            },
            required: ["label"]
          }
        },
        multiSelect: { type: "boolean", description: "Allow choosing more than one option. Default false." }
      },
      required: ["question", "options"]
    }
  }
};
var ASK_USER_FENCE = /```ask-user\s*\n([\s\S]*?)\n```/i;
function coerceAskUserPayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = raw;
  const question = typeof o.question === "string" ? o.question.trim() : "";
  const optionsIn = Array.isArray(o.options) ? o.options : [];
  const options = optionsIn.map((it) => {
    if (typeof it === "string") return it.trim() ? { label: it.trim() } : null;
    if (it && typeof it === "object") {
      const rec = it;
      const label = typeof rec.label === "string" ? rec.label.trim() : "";
      const description = typeof rec.description === "string" ? rec.description.trim() : void 0;
      const recommended = rec.recommended === true ? true : void 0;
      return label ? { label, ...description ? { description } : {}, ...recommended ? { recommended } : {} } : null;
    }
    return null;
  }).filter((x) => !!x);
  if (!question || options.length < 2) return null;
  return { question, options, multiSelect: o.multiSelect === true };
}
function serializeAskUser(payload) {
  return ["```ask-user", JSON.stringify(payload), "```"].join("\n");
}
function askUserBlock(args) {
  const payload = coerceAskUserPayload(args);
  return payload ? serializeAskUser(payload) : null;
}
function parseAskUser(text) {
  if (!text || !text.includes("ask-user")) return null;
  const body = text.match(ASK_USER_FENCE)?.[1];
  if (!body) return null;
  try {
    return coerceAskUserPayload(JSON.parse(body));
  } catch {
    return null;
  }
}
var PROSE_LIST_ITEM = /^\s*(?:[-*•+]|\d{1,2}[.)])\s+(\S.*)$/;
var PROSE_BOLD_LEAD = /^\s*(?:\*\*|__)([^*_\n]+?)(?:\*\*|__)\s*(.*)$/;
var PROSE_CONTINUATION = /^\s{2,}\S/;
var PROSE_CHOICE_CUE = /\b(?:options?|choices?|choose|pick|which|prefer|approach|alternatives?)\b|\bwhat (?:would|do|should) (?:you|we) (?:like to )?(?:do|want)\b|\bhow (?:would|do) you (?:like|want)\b/i;
var PROSE_MAX_LABEL = 80;
var PROSE_MAX_OPTIONS = 6;
var plainLine = (line) => line.replace(/\*\*|__|`/g, "").trim();
function proseItemKind(line) {
  if (PROSE_LIST_ITEM.test(line)) return "marked";
  const bold = line.match(PROSE_BOLD_LEAD);
  if (!bold) return null;
  return !(bold[2] ?? "").trim() && plainLine(line).endsWith(":") ? null : "bold";
}
var isProseItem = (line) => proseItemKind(line) !== null;
function proseOption(line) {
  const body = line.match(PROSE_LIST_ITEM)?.[1] ?? line.trim();
  const bold = body.match(PROSE_BOLD_LEAD);
  let label;
  let rest;
  if (bold) {
    label = bold[1] ?? "";
    rest = bold[2] ?? "";
  } else {
    const sep = body.match(/\s+[—–-]\s+|:\s+/);
    label = sep?.index !== void 0 ? body.slice(0, sep.index) : body;
    rest = sep?.index !== void 0 ? body.slice(sep.index + sep[0].length) : "";
  }
  label = plainLine(label).replace(/[:.]$/, "").trim();
  const description = plainLine(rest).replace(/^[\s—–:-]+/, "").trim();
  if (!label || label.length > PROSE_MAX_LABEL) return null;
  return description ? { label, description } : { label };
}
function proseOptions(lines) {
  const options = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    if (isProseItem(line)) {
      const option = proseOption(line);
      if (!option) return null;
      options.push(option);
      continue;
    }
    const last = options[options.length - 1];
    if (!last || !PROSE_CONTINUATION.test(line)) return null;
    const more = plainLine(line);
    last.description = last.description ? `${last.description} ${more}` : more;
  }
  return options.length >= 2 && options.length <= PROSE_MAX_OPTIONS ? options : null;
}
function itemBlockStart(lines, end) {
  let kind = null;
  let i = end;
  while (i >= 0) {
    const line = lines[i] ?? "";
    const k = proseItemKind(line);
    if (k) {
      if (kind && k !== kind) break;
      kind = k;
      i--;
    } else if (!line.trim() || PROSE_CONTINUATION.test(line)) i--;
    else break;
  }
  let start = i + 1;
  while (start <= end && !(lines[start] ?? "").trim()) start++;
  return start;
}
function lineAbove(lines, index) {
  let i = index - 1;
  while (i >= 0 && !(lines[i] ?? "").trim()) i--;
  return i;
}
var isQuestionLine = (line) => !!line && !isProseItem(line) && plainLine(line).endsWith("?");
var isHeaderLine = (line) => !!line && !isProseItem(line) && plainLine(line).endsWith(":") && plainLine(line).length <= 60;
function liftProseAskUser(text) {
  if (!text || ASK_USER_FENCE.test(text)) return text;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let end = lines.length - 1;
  while (end >= 0 && !(lines[end] ?? "").trim()) end--;
  if (end < 1) return text;
  let question;
  let leadEnd;
  let itemStart;
  let itemEnd;
  if (isQuestionLine(lines[end])) {
    question = lines[end] ?? "";
    itemEnd = end - 1;
    itemStart = itemBlockStart(lines, itemEnd);
    const above = lineAbove(lines, itemStart);
    leadEnd = isHeaderLine(lines[above]) ? above : itemStart;
  } else {
    itemEnd = end;
    itemStart = itemBlockStart(lines, itemEnd);
    const above = lineAbove(lines, itemStart);
    if (!isQuestionLine(lines[above])) return text;
    question = lines[above] ?? "";
    leadEnd = above;
  }
  if (itemStart > itemEnd) return text;
  const cue = `${leadEnd < itemStart ? lines[leadEnd] ?? "" : ""} ${question}`;
  if (!PROSE_CHOICE_CUE.test(cue)) return text;
  const options = proseOptions(lines.slice(itemStart, itemEnd + 1));
  if (!options) return text;
  const payload = coerceAskUserPayload({ question: plainLine(question), options });
  if (!payload) return text;
  const lead = lines.slice(0, leadEnd).join("\n").trim();
  const block = serializeAskUser(payload);
  return lead ? `${lead}

${block}` : block;
}
function stripAskUser(text) {
  if (!text) return text;
  return text.replace(ASK_USER_FENCE, "").replace(/\n{3,}/g, "\n\n").trim();
}
function askUserAnchorId(messageId) {
  return `bf-ask-${messageId}`;
}
function selectPendingAskUser(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    if (msg.role === "user") return null;
    if (msg.role !== "assistant") continue;
    const payload = parseAskUser(msg.content);
    if (payload) return { payload, messageId: msg.id };
  }
  return null;
}

export {
  DEFAULT_TOOL_FAILURE_STREAK,
  asToolArgs,
  parseToolArgs,
  detectRepetitionLoop,
  trimRepetitionLoop,
  runAgentLoop,
  MALFORMED_CALL_RESULT,
  TRUNCATED_CALL_RESULT,
  malformedCallOutcome,
  malformedCallLabel,
  MID_TURN_META_KEY,
  isMidTurnMetadata,
  stepRow,
  isClosedTaskStatus,
  stripReasoningTagsFromText,
  answerTextOf,
  thoughtTextOf,
  replayTextOf,
  splitVendorReasoning,
  canonicalReasoningText,
  ASK_USER_TOOL,
  ASK_USER_TOOL_SPEC,
  coerceAskUserPayload,
  serializeAskUser,
  askUserBlock,
  parseAskUser,
  liftProseAskUser,
  stripAskUser,
  askUserAnchorId,
  selectPendingAskUser
};
//# sourceMappingURL=chunk-ECIV2BG5.mjs.map