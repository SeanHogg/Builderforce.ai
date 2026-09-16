# PRD 29 — Verify and package the run-visibility + ticket-parent changes

**Status:** Ready to execute · **Created:** 2026-09-15 · **Owner:** whoever picks this up next
**Type:** Verification + packaging handoff. The code is written and wired; NOTHING has been compiled, tested or packaged.
**Do not commit** unless the person asks — report results first.

---

## 1. Why this exists

Two changes landed in the working tree in one pass and the session was stopped before the
verify/package step. Everything below is mechanical: run the checks in order, fix only
mechanical breakage, package the VSIX, install and verify it.

**Change A — a turn streaming a tool call is visible, a silent stream fails over, triage stops
crying "context exhaustion".** Origin: VS Code chat #113. A Grok 4.6 turn streamed the text
"Writing the Advisor Platform PRD and filing the epic now.", then showed `streaming the reply`
for 3m 23s with nothing moving. The model was in fact streaming a 21 KB `write_file` call; the
run loop only subscribed to TEXT deltas, so `onToolCallDelta` fired into nothing and the phase
never advanced past `writing`. The copied report then blamed CONTEXT EXHAUSTION on a run where
nothing failed (the 90k prompt is normal against a 64k working-transcript budget, and the "14
tool results cut" were the deliberate 6 KB tool-result budget).

**Change B — the chat ticket rail names each ticket's parent.** Same chat spawned an epic plus
three child epics and their tasks; every rail chip read `EPIC · BACKLOG · SPAWNED HERE` with
nothing saying which epic a ticket belonged to.

Both are recorded in [DONE.md](../../DONE.md) (two dated sections at the top, 2026-09-15).

---

## 2. What is already done (do not redo)

### Change A — brain-embedded 2026.9.30 · brain-ui 2026.9.10
| File | What |
|---|---|
| `brain-embedded/src/composingActivity.ts` (new) + `.test.ts` | Builds the turn's `onToolCallDelta`. First fragment publishes `{ phase: 'composing', label, bytes, startedAt, step }` and repaints at once; later fragments accumulate UTF-8 bytes on the coalesced repaint and hold `startedAt` stable (re-stamping re-seeds the LiveActivity ticker). Also exports `utf8ByteLength` / `toolCallArgBytes`. |
| `brain-embedded/src/streamIdleWatchdog.ts` (new) + `.test.ts` | `readWithIdleWatchdog`, `STREAM_IDLE_MS = 240_000`, `StreamIdleError`. Races each read against a timer, cancels the reader, swallows the losing read's rejection. |
| `brain-embedded/src/runActivity.ts` | `'composing'` phase, `bytes?` on `BrainRunActivity`, exported `formatBytes`, composing wording in `describeLiveStep`. |
| `brain-embedded/src/brainRunStore.ts` | ~12 lines: wire `onToolCallDelta`, first tool-call fragment now sets `firstTokenAt` (a tool-only turn finally records a TTFT), `composing.reset()` on turn restart, `argBytes` on the durable `llm.complete` step. |
| `brain-embedded/src/streamChatCompletion.ts` | New `idleTimeoutMs?` option; idle maps to `StreamInterruptedError` unless the user pressed Stop. The run loop already retries such an error on another model. |
| `brain-embedded/src/workingTranscript.ts` | Exports `HISTORY_TOKEN_BUDGET`. |
| `brain-embedded/src/brainTriage.ts` | `CONTEXT_PROMPT_PEAK` derived as `1.5 × HISTORY_TOKEN_BUDGET` (96,000). Context exhaustion now needs a CONSEQUENCE (length/empty finish, downgrade, exhausted loop, or a failed turn); pressure alone emits a separate `Context: pressure noted …` advisory and keeps the otherwise-derived verdict. Budget trims read "trimmed to the 6 KB tool-result budget (by design)". |
| `brain-embedded/src/modelScorecard.ts` | `ModelTurn.argBytes` / `.completionTokens`, rendered in the turn log. |
| `packages/brain-ui/src/LiveActivity.tsx` (+test) | `composing` / `composed` labels, glyph, `phaseLine` branch. Imports `formatBytes` from brain-embedded. |
| Locale wiring | `frontend/src/i18n/useLiveActivityLabels.ts`; `brain.timeline.live.composing` + `.composed` in all five catalogs; `clients/vscode/src/builderforcePanel.ts` (`tl.liveComposing`, `tl.liveComposed`); `clients/vscode/webview/src/chat/chatLabels.ts`; `clients/vscode/l10n/bundle.l10n*.json`. |
| Tests updated | `runActivity`, `brainTriage`, `modelScorecard`, `persistedSteps`, `runProgress`, `streamChatCompletion`, and `clients/vscode/harness/scenarios.test.ts` (wording regex). |

### Change B — api 2026.9.36 · brain-ui 2026.9.10 · frontend 2026.9.34
| File | What |
|---|---|
| `api/src/application/brain/ChatTicketService.ts` | `TicketParent` + `TicketHealth.parent?`; self-row select adds `taskType` + `parentTaskId`; private `resolveTaskParents` names parents already in the batch for free and issues AT MOST one extra batched `IN (…)` (zero when nothing has a parent). |
| `api/src/application/brain/ceremonyTicketHealth.test.ts` | 5 new cases incl. a query-count assertion. |
| `packages/brain-ui/src/chatTickets/` | `TicketParentLine.tsx` (+test, returns null with no parent), `tokens.ts` (the `V` palette MOVED out of the panel, not copied), `types.ts` (`TicketParentVM`, `inParent` label), panel renders the line and resolves the parent to the chat's own VM when it is also linked. |
| `frontend/src/components/brain/ChatTicketsPanel.tsx` + 5 catalogs | `brain.tickets.inParent` — en `in {parent}` · zh `属于 {parent}` · es `en {parent}` · fr `dans {parent}` · de `in {parent}`. |

Versions already bumped and staged: brain-embedded `2026.9.30`, brain-ui `2026.9.10`,
api `2026.9.36`, frontend `2026.9.34`, VSIX `2026.9.71` (with a benefit-framed
`clients/vscode/changelog.md` entry).

---

## 3. What remains — the whole of this PRD

Per the model-roles rule, every compile, test, dist rebuild, VSIX build and package step runs
through a **Sonnet subagent** (`Agent` with `model: "sonnet"`), never the orchestrating model's
own shell.

**Build order matters:** brain-ui's typecheck resolves `@seanhogg/builderforce-brain-embedded`
through `dist/index.d.ts`, and the VSIX webview resolves brain-ui through its `dist`. A stale
dist is the classic false failure here.

1. **brain-embedded** — `pnpm test`, then build its `dist`.
2. **packages/brain-ui** — `pnpm test`, then build its `dist`. `TicketParentLine.test.tsx` is the
   first chatTickets component test; the package's vitest config is already `jsdom` and the test
   uses `renderToStaticMarkup` like `ToolStep.test.tsx`.
3. **api** — `pnpm vitest run src/application/brain`, then the api typecheck. Run it from inside
   `api/` (the compile primitive needs that cwd).
4. **frontend** — typecheck plus the i18n catalog guard (look for an `i18n` / `check:i18n` script);
   `pnpm vitest run src/components/brain` if tests exist there.
5. **clients/vscode** — `pnpm run type-check`, `pnpm test` (includes the harness scenarios), then
   `node esbuild.mjs --production && tsc -p ./ && pnpm run build:webview`, then `pnpm run package`.
   Expect `clients/vscode/builderforce-ai-2026.9.71.vsix`.
6. **Install and verify** — install with the **absolute** path
   (`code --install-extension "/c/code/agentic/Builderforce.ai/clients/vscode/builderforce-ai-2026.9.71.vsix" --force`),
   then confirm with BOTH `code --list-extensions --show-versions | grep -i builderforce` and
   `ls ~/.vscode/extensions | grep -i builderforce`. The CLI's "successfully installed" line is
   not proof — a relative path has silently installed nothing before. Say explicitly that the VS
   Code window must be reloaded.

### Fix policy for the verifier
Mechanical breakage only: a wrong import path, a type error from the new `composing` phase or the
new `parent` field, a test literal still expecting `cut before the model saw them`, a missing
catalog key. Grep `BrainRunPhase` across `frontend/src`, `packages`, `clients/vscode/webview/src`
and add `composing` to any exhaustive `Record` that now lacks it. Anything that looks like a real
logic defect gets reported, not patched.

### Known concurrent edits — leave alone
A concurrent session has unrelated uncommitted changes in `api` (benchmarking, investor,
identity), `frontend` (creation-canvas, insights, benchmarking) and `ROADMAP.md`. Do not revert
or "fix" them; report any failure they cause separately.

---

## 4. Acceptance

- Every suite in §3 passes, or each failure is named with its exact output and attributed.
- `builderforce-ai-2026.9.71.vsix` exists and both verification commands report 2026.9.71.
- A live run in the reloaded editor shows `Composing a write_file call — N KB so far` with a
  ticking clock while a long file write streams, instead of a frozen `Writing the reply…`.
- A chat whose tickets sit under an epic shows `↳ in <epic title>` on each child chip.
- A copied triage report from a healthy long run no longer opens with
  `Likely CONTEXT EXHAUSTION` — it reports the verdict plus a separate `Context: pressure noted …`
  line.

### Not in scope — already owned elsewhere
The run report that started this also showed `builtin_kanban_assess_resource` returning
`403 manager role required` three times while the agent tried to staff its own epics. **Do not
chase that here.** A concurrent session has already root-caused it — a 365-day `bfk` auth-cache
entry predating api 2026.9.23 was resolving the workspace owner as an anonymous developer — and
shipped the versioned cache key as part of
[PRD 27 — staffed work + chat diagnostics](./27-prd-staffed-work-and-chat-diagnostics.md),
which is itself code-complete and unverified.

**Coordinate the packaging step with that PRD.** Both it and this one need a brain-embedded dist
rebuild before the VSIX is packaged, and both are staged in the same working tree. Whoever gets
there second should not package a second time — verify both sets of changes, then build and
install one VSIX that carries them together, and name both PRDs when reporting the result.
