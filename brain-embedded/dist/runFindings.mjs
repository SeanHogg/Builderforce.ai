import {
  STOPPED_TURN_STEP,
  bracketDelta,
  changesBalance,
  claimsReady,
  commandOf,
  describeBracketDelta,
  editedFilesOf,
  editedPathsOf,
  isCacheAnswered,
  isCodeChangeTool,
  isFailedToolResult,
  isTicketWriteTool,
  modelTurnLog,
  routingByRole,
  staffingSummaryInTrace,
  traceWithPersistedSteps,
  utf8ByteLength
} from "./chunk-4EX4OH2B.mjs";

// src/runFindings/policy.ts
import { NARRATION_OVERLAP } from "@seanhogg/builderforce-memory/working";
var RUN_FINDING_POLICY = Object.freeze({
  /** Read-only turns before the first write that make an analysis overrun. */
  analysisReadTurns: 8,
  /** Read-only turns after a readiness claim that leave it unkept. */
  unkeptReadTurns: 2,
  /** Turns that each made exactly one write, at which the run is writing serially. */
  serialSingleWriteTurns: 4,
  /** Prompt : completion ratio and prompt total at which the run's prompt is bloated. */
  promptBloatRatio: 50,
  promptBloatMinTokens: 5e5,
  /** Writes of one path that make churn. */
  editChurnWrites: 4,
  /** Argument bytes of one non-write call that are oversized. */
  oversizedArgBytes: 4 * 1024,
  /** Identical text (bytes) two calls of one tool must share to count as a copied block. */
  sharedArgBytes: 1024,
  /** A turn this slow (ms) is slow. */
  slowTurnMs: 6e4,
  /** Word-set overlap at which a pre-call text repeats the last kept one: memory's B7 fold threshold, so the
   *  diagnostic and the fold agree (`NARRATION_OVERLAP`, `@seanhogg/builderforce-memory/working`). */
  narrationOverlap: NARRATION_OVERLAP,
  /** Longest excerpt an evidence row quotes. */
  excerptChars: 160
});
var CHECK_TOOL = /diagnostic|typecheck|type[_-]check|(^|[_.-])tests?($|[_.-])|lint|(^|[_.-])verify($|[_.-])/i;
var CHECK_COMMAND = /\b(?:tsc|tsgo|vitest|jest|mocha|playwright|eslint|biome|oxlint|pytest|cargo\s+(?:check|test|clippy)|go\s+(?:test|vet))\b|\b(?:npm|pnpm|yarn|bun|npx)\b[^|;&\n]*?\b(?:test|lint|check|typecheck|type-check)\b/i;
var SHELL_TOOLS = /* @__PURE__ */ new Set(["run_command", "shell", "bash", "exec"]);

// src/runFindings/findingParts.ts
function finding(kind, severity, params, evidence) {
  const first = evidence.reduce((min, e) => Math.min(min, e.step), Number.POSITIVE_INFINITY);
  const subject = params.path ?? params.tool;
  const id = `${kind}:${subject !== void 0 ? `${subject}:` : ""}${Number.isFinite(first) ? first : 0}`;
  return { id, kind, severity, params, evidence };
}
function withUniqueIds(findings) {
  const seen = /* @__PURE__ */ new Map();
  return findings.map((f) => {
    const n = (seen.get(f.id) ?? 0) + 1;
    seen.set(f.id, n);
    return n === 1 ? f : { ...f, id: `${f.id}#${n}` };
  });
}
function excerpt(text) {
  const flat = text.replace(/\s+/g, " ").trim();
  const max = RUN_FINDING_POLICY.excerptChars;
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}\u2026` : flat;
}
function turnEvidence(t, label = "llm.complete", text) {
  return { step: t.step, turn: t.index, label, ...text ? { excerpt: excerpt(text) } : {} };
}
function callEvidence(c, path, text) {
  return {
    step: c.step,
    ...c.turn > 0 ? { turn: c.turn } : {},
    label: c.name,
    ...path ? { path } : {},
    ...text ? { excerpt: excerpt(text) } : {}
  };
}
function fileLedger(view) {
  const rows = /* @__PURE__ */ new Map();
  for (const c of view.calls) {
    if (c.check) for (const row of rows.values()) row.checked = true;
    for (const path of c.paths) {
      const row = rows.get(path);
      if (row) {
        row.writes += 1;
        row.lastWrite = c;
        row.checked = false;
      } else {
        rows.set(path, { path, writes: 1, lastWrite: c, checked: false });
      }
    }
  }
  return [...rows.values()];
}
function unverifiedFiles(view) {
  return fileLedger(view).filter((r) => !r.checked);
}
function writeCalls(view) {
  return view.calls.filter((c) => c.write);
}

// src/runFindings/detectors/analysisOverrun.ts
function analysisOverrun(view) {
  const firstWrite = view.turns.find((t) => t.kind === "write");
  const before = firstWrite ? view.turns.filter((t) => t.index < firstWrite.index) : view.turns;
  const reads = before.filter((t) => t.kind === "read");
  const forced = before.find((t) => t.forced);
  const forcedByBudget = !!forced && view.routing.handOffsForced > 0;
  if (reads.length < RUN_FINDING_POLICY.analysisReadTurns && !forcedByBudget) return [];
  const evidence = [
    ...reads[0] ? [turnEvidence(reads[0])] : [],
    ...reads.length > 1 ? [turnEvidence(reads[reads.length - 1])] : [],
    ...forced ? [turnEvidence(forced, "loop.hand_off_due")] : []
  ];
  return [finding("analysis_overrun", forcedByBudget ? "error" : "warn", {
    readTurns: reads.length,
    firstWriteTurn: firstWrite?.index ?? 0
  }, evidence)];
}

// src/runFindings/detectors/bracketBreak.ts
function bracketBreak(view) {
  const out = [];
  for (const c of view.calls) {
    if (!c.write) continue;
    for (const r of editedFilesOf(c.name, c.args)) {
      if (r.before === void 0 || r.after === void 0) continue;
      const delta = bracketDelta(r.before, r.after, r.path);
      if (!changesBalance(delta)) continue;
      out.push(finding(
        "bracket_break",
        "error",
        { path: r.path, delta: describeBracketDelta(delta) },
        [callEvidence(c, r.path, r.after)]
      ));
    }
  }
  return out;
}

// src/runFindings/detectors/editChurn.ts
function editChurn(view) {
  return fileLedger(view).filter((f) => f.writes >= RUN_FINDING_POLICY.editChurnWrites).map((f) => finding(
    "edit_churn",
    "warn",
    { path: f.path, writes: f.writes },
    view.calls.filter((c) => c.paths.includes(f.path)).map((c) => callEvidence(c, f.path))
  ));
}

// src/runFindings/detectors/filedThenInline.ts
function filedThenInline(view) {
  const { staffing } = view;
  if (staffing.ticketsCreated === 0 || staffing.dispatched > 0 || staffing.personaSubagents.some((p) => p.ok)) return [];
  const filed = view.calls.filter((c) => c.ok && isTicketWriteTool(c.name));
  const last = filed[filed.length - 1];
  if (!last) return [];
  const inline = view.calls.find((c) => c.write && c.step > last.step);
  if (!inline) return [];
  return [finding("filed_then_inline", "info", { tickets: staffing.ticketsCreated }, [
    ...filed.map((c) => callEvidence(c, void 0, typeof c.args.title === "string" ? c.args.title : void 0)),
    callEvidence(inline, inline.paths[0])
  ])];
}

// src/runFindings/detectors/oversizedArgs.ts
function blocksOf(v, out = /* @__PURE__ */ new Set()) {
  if (typeof v === "string") {
    for (const p of v.split(/\n\s*\n/)) {
      const block = p.trim();
      if (utf8ByteLength(block) >= RUN_FINDING_POLICY.sharedArgBytes) out.add(block);
    }
  } else if (Array.isArray(v)) {
    for (const x of v) blocksOf(x, out);
  } else if (v && typeof v === "object") {
    for (const x of Object.values(v)) blocksOf(x, out);
  }
  return out;
}
function sharingCalls(calls) {
  const holders = /* @__PURE__ */ new Map();
  for (const c of calls) for (const b of blocksOf(c.args)) holders.set(b, [...holders.get(b) ?? [], c]);
  const out = /* @__PURE__ */ new Set();
  for (const list of holders.values()) if (list.length >= 2) for (const c of list) out.add(c);
  return out;
}
function oversizedArgs(view) {
  const byTool = /* @__PURE__ */ new Map();
  for (const c of view.calls) {
    if (isCodeChangeTool(c.name)) continue;
    byTool.set(c.name, [...byTool.get(c.name) ?? [], c]);
  }
  const out = [];
  for (const [tool, calls] of byTool) {
    const shared = sharingCalls(calls);
    const flagged = calls.filter((c) => c.argBytes >= RUN_FINDING_POLICY.oversizedArgBytes || shared.has(c));
    if (flagged.length === 0) continue;
    const evidence = flagged.map((c) => ({
      ...callEvidence(c),
      note: shared.has(c) ? "argBytesShared" : "argBytes",
      params: { bytes: c.argBytes }
    }));
    out.push(finding("oversized_args", "warn", { tool, bytes: Math.max(...flagged.map((c) => c.argBytes)), calls: flagged.length }, evidence));
  }
  for (const t of view.turns) {
    if (!t.handOffVia || t.argBytes < RUN_FINDING_POLICY.oversizedArgBytes || byTool.has(t.handOffVia)) continue;
    out.push(finding(
      "oversized_args",
      "warn",
      { tool: t.handOffVia, bytes: t.argBytes, calls: 1 },
      [{ ...turnEvidence(t, t.handOffVia), note: "argBytes", params: { bytes: t.argBytes } }]
    ));
  }
  return out;
}

// src/runFindings/detectors/promptBloat.ts
function promptBloat(view) {
  const promptTokens = view.turns.reduce((sum, t) => sum + t.promptTokens, 0);
  const completion = view.turns.reduce((sum, t) => sum + t.completionTokens, 0);
  if (promptTokens < RUN_FINDING_POLICY.promptBloatMinTokens) return [];
  const ratio = completion > 0 ? promptTokens / completion : Number.POSITIVE_INFINITY;
  if (ratio < RUN_FINDING_POLICY.promptBloatRatio) return [];
  const writes = writeCalls(view).length;
  const peak = view.turns.reduce((max, t) => t.promptTokens > max.promptTokens ? t : max, view.turns[0]);
  return [finding("prompt_bloat", "warn", {
    ratio: Number.isFinite(ratio) ? Math.round(ratio) : 0,
    promptTokens,
    perWrite: writes > 0 ? Math.round(promptTokens / writes) : 0
  }, [turnEvidence(peak)])];
}

// src/runFindings/detectors/repeatedNarration.ts
import { foldRepeatedNarration } from "@seanhogg/builderforce-memory/working";
function asNarration(t) {
  return { role: "assistant", content: t.text, tool_calls: t.calls.map(() => ({})) };
}
var isCandidate = (t) => t.calls.length > 0 && t.text.trim().length > 0;
function repeatedNarration(view) {
  const msgs = view.turns.map(asNarration);
  const folded = foldRepeatedNarration(msgs, RUN_FINDING_POLICY.narrationOverlap);
  const repeats = /* @__PURE__ */ new Set();
  let lastKept = null;
  for (let i = 0; i < view.turns.length; i++) {
    const t = view.turns[i];
    if (!isCandidate(t)) continue;
    if (folded[i] === msgs[i]) {
      lastKept = t;
      continue;
    }
    if (lastKept) repeats.add(lastKept);
    repeats.add(t);
  }
  if (repeats.size === 0) return [];
  const turns = [...repeats].sort((a, b) => a.index - b.index);
  return [finding(
    "repeated_narration",
    "info",
    { turns: turns.length },
    turns.map((t) => turnEvidence(t, "agent.message", t.text))
  )];
}

// src/runFindings/detectors/sameModelRoles.ts
function soleModel(view, role) {
  const models = view.routing.roles.find((r) => r.role === role)?.models ?? [];
  return models.length === 1 ? models[0].model : null;
}
function sameModelRoles(view) {
  const r = view.routing;
  if (r.handOffs + r.handOffsForced + r.coderReasks === 0) return [];
  const plan = soleModel(view, "plan");
  if (!plan || plan !== soleModel(view, "code")) return [];
  const firstPlan = view.turns.find((t) => t.role === "plan");
  const firstCode = view.turns.find((t) => t.role === "code");
  return [finding("same_model_roles", "info", { model: plan }, [
    ...firstPlan ? [turnEvidence(firstPlan)] : [],
    ...firstCode ? [turnEvidence(firstCode)] : []
  ])];
}

// src/runFindings/detectors/serialSingleWrites.ts
function serialSingleWrites(view) {
  const single = view.turns.filter((t) => t.calls.filter((c) => c.write).length === 1);
  if (single.length < RUN_FINDING_POLICY.serialSingleWriteTurns) return [];
  const promptTokens = single.reduce((sum, t) => sum + t.promptTokens, 0);
  return [finding(
    "serial_single_writes",
    "warn",
    { turns: single.length, promptTokens },
    single.map((t) => {
      const write = t.calls.find((c) => c.write);
      return { ...turnEvidence(t, write.name), ...write.paths[0] ? { path: write.paths[0] } : {} };
    })
  )];
}

// src/runFindings/detectors/slowTurns.ts
function slowTurns(view) {
  const slow = view.turns.filter((t) => t.durationMs >= RUN_FINDING_POLICY.slowTurnMs);
  if (slow.length === 0) return [];
  const slowestMs = Math.max(...slow.map((t) => t.durationMs));
  return [finding("slow_turns", "warn", { turns: slow.length, slowestMs }, slow.map((t) => ({ ...turnEvidence(t), note: "slowTurn", params: { ms: t.durationMs, completionTokens: t.completionTokens, argBytes: t.argBytes } })))];
}

// src/runFindings/detectors/stoppedUnverified.ts
function stoppedUnverified(view) {
  if (!view.stopped) return [];
  const files = unverifiedFiles(view);
  if (files.length === 0) return [];
  return [finding("stopped_unverified", "error", { files: files.length }, [
    { step: view.stopped.step, label: STOPPED_TURN_STEP },
    ...files.map((f) => callEvidence(f.lastWrite, f.path))
  ])];
}

// src/runFindings/detectors/unkeptReadiness.ts
function readTurnsAfter(turns, from) {
  let n = 0;
  for (const t of turns) {
    if (t.index <= from) continue;
    if (t.kind !== "read") break;
    n += 1;
  }
  return n;
}
function unkeptReadiness(view) {
  const claims = view.turns.filter((t) => t.kind === "read" && claimsReady(t.text));
  const first = claims[0];
  if (!first) return [];
  const after = readTurnsAfter(view.turns, first.index);
  if (after < RUN_FINDING_POLICY.unkeptReadTurns) return [];
  return [finding(
    "unkept_readiness",
    "warn",
    { claims: claims.length, readTurnsAfter: after },
    claims.map((t) => turnEvidence(t, "agent.message", t.text))
  )];
}

// src/runFindings/detectors/unverifiedWrites.ts
function unverifiedWrites(view) {
  const files = unverifiedFiles(view);
  if (files.length === 0) return [];
  const writes = writeCalls(view).filter((c) => c.paths.some((p) => files.some((f) => f.path === p))).length;
  return [finding(
    "unverified_writes",
    "error",
    { files: files.length, writes },
    files.map((f) => callEvidence(f.lastWrite, f.path))
  )];
}

// src/runFindings/registry.ts
var RUN_FINDING_REGISTRY = [
  { kind: "analysis_overrun", detect: analysisOverrun },
  { kind: "unkept_readiness", detect: unkeptReadiness },
  { kind: "serial_single_writes", detect: serialSingleWrites },
  { kind: "prompt_bloat", detect: promptBloat },
  { kind: "unverified_writes", detect: unverifiedWrites },
  { kind: "bracket_break", detect: bracketBreak },
  { kind: "edit_churn", detect: editChurn },
  { kind: "filed_then_inline", detect: filedThenInline },
  { kind: "same_model_roles", detect: sameModelRoles },
  { kind: "oversized_args", detect: oversizedArgs },
  { kind: "slow_turns", detect: slowTurns },
  { kind: "repeated_narration", detect: repeatedNarration },
  { kind: "stopped_unverified", detect: stoppedUnverified }
];

// src/runFindings/runView.ts
var HAND_OFF_DUE = "loop.hand_off_due";
var ROLE_HANDOFF = "llm.role_handoff";
var record = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
function jsonBytes(v) {
  try {
    return utf8ByteLength(JSON.stringify(v ?? null));
  } catch {
    return 0;
  }
}
function isCheck(ev) {
  if (CHECK_TOOL.test(ev.label)) return true;
  return SHELL_TOOLS.has(ev.label) && CHECK_COMMAND.test(commandOf(ev));
}
function callOf(ev, step, turn) {
  const ok = !ev.isError && !isFailedToolResult(ev.result);
  const args = record(ev.args);
  const write = ok && isCodeChangeTool(ev.label) && !isCacheAnswered(ev);
  return {
    step,
    turn,
    name: ev.label,
    args,
    ok,
    argBytes: jsonBytes(ev.args),
    write,
    check: ok && isCheck(ev),
    paths: write ? editedPathsOf(ev.label, args) : []
  };
}
function kindOf(t, failed) {
  if (failed) return "failed";
  if (t.forced) return "forced";
  if (t.calls.some((c) => c.write)) return "write";
  return t.toolCalls > 0 || t.calls.length > 0 ? "read" : "text";
}
function buildRunView(events, messages = []) {
  const list = [...events];
  const turns = [];
  const calls = [];
  let forcedNext = false;
  let stopped = null;
  for (const [i, ev] of list.entries()) {
    const step = i + 1;
    const current = turns[turns.length - 1];
    if (ev.label === HAND_OFF_DUE) {
      forcedNext = true;
      continue;
    }
    if (ev.label === STOPPED_TURN_STEP) {
      const model = record(ev.args).model;
      stopped = { step, ...typeof model === "string" ? { model } : {} };
      continue;
    }
    if (ev.label === "llm.complete") {
      const logged = modelTurnLog([ev])[0];
      if (!logged) continue;
      const failed = logged.failed === true;
      turns.push({
        index: turns.length + 1,
        step,
        role: logged.role ?? "",
        model: logged.model,
        kind: failed ? "failed" : "text",
        toolCalls: logged.toolCalls,
        promptTokens: ev.usage?.prompt ?? 0,
        completionTokens: logged.completionTokens ?? 0,
        durationMs: logged.durationMs ?? 0,
        argBytes: logged.argBytes ?? 0,
        forced: forcedNext && !failed,
        text: "",
        calls: []
      });
      if (!failed) forcedNext = false;
      stopped = null;
      continue;
    }
    if (!current) {
      if (ev.category === "tool") calls.push(callOf(ev, step, 0));
      continue;
    }
    if (ev.label === "agent.message" && typeof ev.result === "string" && !current.text) current.text = ev.result;
    else if (ev.label === ROLE_HANDOFF && typeof record(ev.args).via === "string") current.handOffVia = record(ev.args).via;
    else if (ev.category === "tool") {
      const call = callOf(ev, step, current.index);
      current.calls.push(call);
      calls.push(call);
    }
  }
  for (const t of turns) t.kind = kindOf(t, t.kind === "failed");
  return {
    events: list,
    messages: [...messages],
    turns,
    calls,
    stopped,
    routing: routingByRole(modelTurnLog(list), list),
    staffing: staffingSummaryInTrace(list)
  };
}

// src/runFindings/detectRunFindings.ts
var SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };
var firstStep = (f) => f.evidence.reduce((min, e) => Math.min(min, e.step), Number.POSITIVE_INFINITY);
function compareFindings(a, b) {
  return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || firstStep(a) - firstStep(b) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function summaryOf(view, findings, identity) {
  const ask = view.messages.find((m) => m.role === "user")?.content.replace(/\s+/g, " ").trim() ?? "";
  const max = RUN_FINDING_POLICY.excerptChars;
  const counts = { info: 0, warn: 0, error: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return {
    id: identity.id ?? "",
    title: identity.title ?? (ask.length > max ? `${ask.slice(0, max - 1).trimEnd()}\u2026` : ask),
    startedAt: view.events[0]?.ts ?? "",
    endedAt: view.events[view.events.length - 1]?.ts ?? "",
    models: [...new Set(view.turns.map((t) => t.model))],
    turns: view.turns.length,
    counts
  };
}
function detectRunFindings(events, messages = [], identity = {}) {
  const view = buildRunView(events, messages);
  const findings = withUniqueIds(RUN_FINDING_REGISTRY.flatMap((d) => d.detect(view)).sort(compareFindings));
  return {
    summary: summaryOf(view, findings, identity),
    turns: view.turns.map((t) => ({
      index: t.index,
      role: t.role,
      model: t.model,
      kind: t.kind,
      toolCalls: t.toolCalls,
      promptTokens: t.promptTokens,
      completionTokens: t.completionTokens,
      durationMs: t.durationMs
    })),
    findings,
    files: fileLedger(view).map((f) => ({ path: f.path, writes: f.writes, checked: f.checked }))
  };
}
export {
  RUN_FINDING_POLICY,
  RUN_FINDING_REGISTRY,
  buildRunView,
  compareFindings,
  detectRunFindings,
  traceWithPersistedSteps
};
//# sourceMappingURL=runFindings.mjs.map