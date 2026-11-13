# PRD 45 backlog triage — evidence log (2026-11-13)

Verified on main of Builderforce.ai.

## CORRECTION (2026-11-13, second pass)

The first pass below grepped for informal names and scoped out `builderforce-memory`,
which mis-classified B5/B6/B7 as missing. They are **implemented, wired, and tested**:

- **B5** — `brain-embedded/src/run/progressLine.ts:109` `computeProgressLine`, wired via
  `brainTurnTail.ts:26` → `brainPlatformTools.ts:159`. `progressLine.test.ts` 7/7.
  (First pass grepped for `planChecklist`; the PRD names it "host-derived progress line".)
- **B6 / B7** — `builderforce-memory/packages/memory/src/working/fold.ts`
  (`foldSupersededReads` :164, `foldRepeatedNarration` :213, `foldWorkingTranscript` :250),
  wired in `brain-embedded/src/run/brainFold.ts:141` via `@seanhogg/builderforce-memory/working`
  (published dep `^2026.10.80`, installed copy carries `dist/working/fold.js`).
  `fold.test.ts` 10/10 (incl. chat-#216 `regression:` cases).
- **B8** — `brain-embedded/src/toolExposure.ts` `toolExposureInTrace` reads the trace's real
  per-turn `advertisedTools` (the chat-#216 "1 advertised" fix). Tests in `toolExposure.test.ts`
  + `runStore/turnRecorder.toolExposure.test.ts`.
- **B9** — `brain-embedded/src/runStore/runBackstops.ts:352` `retitleShippedDeltaTicket`;
  `runBackstops.retitle.test.ts` 5/5.

Consequence: tickets 6552 (B4-B6) and 6553 (B7-B9) carry **no real remainder** — B4, B5, B6,
B7, B8, B9 are all landed. They should be closed done, not kept open.

The `progressTrace` import in brain-embedded returned 0 hits under `brain-embedded/src` —
the advisories-as-trace-rows slice (6532) lives in `packages/run-guards`, which is where its
callers should be; not a B-item gap.

## Original verdicts (kept for the audit trail; B5-B9 lines superseded above)

- 6553 / 6594 | PARTIAL→DONE | runBackstops.retitle landed; B7 fold + B8 counter are DONE per
  correction above | close 6553 done; 6594 duplicate.
- 6552 / 6593 | PARTIAL→DONE | batchingNudge.ts = B4 done; B5 progressLine + B6 fold DONE per
  correction | close 6552 done; 6593 duplicate.
- 6587 A3 | DONE | brain-embedded/src/runStore/postEditDiagnostics.ts + postEditDiagnostics.test.ts; wired at callRunner.ts L197-202 | close as done.
- 6588 A4 | DONE | brain-embedded/src/runStore/shipGates.ts + shipGates.preflight.test.ts + shipGates.outgoing.test.ts; parity scenario brain-embedded/src/run/parity/scenarios/gates.ts exists (binds fake ports) | close as done.
- 6589 A5 | DONE | clients/vscode/src/verify/reviewerPort.ts + shipPorts.ts + shipPorts.test.ts exist (OD-1 reviewer port bound on the VSIX host) | close as done.
- 6590 A6 | DONE | brain-embedded/src/runStore/runPreamble.ts references selfReviewShipDirective; selfReviewShip.ts + selfReviewShip.test.ts | close as done.
- 6591 / 6518 A7 | DONE | commit 74ab4c259 "PRD 45 §4.6: plugin HTTP routes authenticate by default (agent-runtime)" | 6518 already done(100%); 6591 exact duplicate — close 6591 as duplicate of 6518.
- 6592 B1-B3 | DONE | commit cc499f1e6 "outline-first reads (PRD 45 §4.7 B2) + readiness advisory (B1)"; packages/run-guards/src/readinessAdvisory.ts + readinessClaimRank.test.ts (B1); multiRead.ts + multiRead.test.ts (B3) | close as done.
- 6595 W9 | NOT_STARTED | PRD §8 table still shows targets em-dash (—); no re-measurement commit for #214/#216 replays after gates landed | keep open; blocked on 6596 (trace reader).
- 6584 W0 | DONE | api/scripts/chat-replay-baseline.cjs on disk; PRD §8 W0 baseline block filled with measured numbers | close as done.
- 6596 | NOT_STARTED | no telemetry trace-reader module found | keep open; blocks W0 re-runs and W9. THIS IS THE REAL REMAINDER.
- 6551 / 6586 A2 | DONE | clients/vscode/src/verify/ has 21 files with .test.ts coverage | close 6551 as done; 6586 exact duplicate of 6551.
- 6561 Part 1 | DONE | commit 74ab4c259 — plugin route auth landed | close as done.
- 6562 Part 2 | DONE | brain-embedded/src/runStore/publishHold.ts + publishHold.test.ts; chat-scoped, refuses git_commit/git_push/open_pull_request in callPreflight; swaps ship directive in runPreamble | close as done.
- 6550 epic | nearly DONE | A1-A7 + B1-B9 + W0 all landed per correction; remaining: W9 (6595), blocked on trace-reader capability (6596) | close 6552/6553, then only 6596→6595 remain.
- 6560 epic | DONE | Part 1 = 74ab4c259, Part 2 = publishHold.ts | close epic as done.

## Exact duplicates (close the higher-numbered copy)
- 6594 ≡ 6553 · 6593 ≡ 6552 · 6586 ≡ 6551 · 6591 ≡ 6518

## Real remaining work
1. **6596** — chat-scoped telemetry trace reader (the capability gap; unblocks W0 re-runs + W9).
2. **6595 (W9)** — re-measure #214/#216 after gates land; record vs §8 targets. Blocked on 6596.
