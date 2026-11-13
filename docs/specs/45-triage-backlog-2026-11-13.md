# PRD 45 backlog triage — evidence log (2026-11-13)

Verified on main (a8a79f61e) of Builderforce.ai.

## Verdicts (one line each)

- 6553 / 6594 | PARTIAL | brain-embedded/src/runStore/runBackstops.retitle.test.ts exists (ticket-title retitle landed); NO planChecklist / narration-fold / diagnosticsCounter / superseded modules found in packages/run-guards/src or brain-embedded/src | keep 6553 open for remaining B7-B9 items; 6594 is an exact duplicate of 6553 — close as duplicate of 6553.
- 6552 / 6593 | PARTIAL | packages/run-guards/src/batchingNudge.ts + batchingNudge.test.ts (commits cda0c33e9, 1a148ecef "B4 nudge only on pure-idle turns") = B4 done; B5 plan checklist and B6 superseded-read fold NOT found on disk (grep for planChecklist/superseded in run-guards/src and brain-embedded/src: no hits) | keep 6552 open for B5/B6; 6593 exact duplicate — close as duplicate.
- 6587 A3 | DONE | brain-embedded/src/runStore/postEditDiagnostics.ts + postEditDiagnostics.test.ts; wired at callRunner.ts L197-202 (postEditNotes, advisory notes on edit result) | close as done.
- 6588 A4 | DONE | brain-embedded/src/runStore/shipGates.ts + shipGates.preflight.test.ts + shipGates.outgoing.test.ts; parity scenario brain-embedded/src/run/parity/scenarios/gates.ts exists (binds fake ports) | close as done.
- 6589 A5 | DONE | clients/vscode/src/verify/reviewerPort.ts + shipPorts.ts + shipPorts.test.ts exist (OD-1 reviewer port bound on the VSIX host) | close as done.
- 6590 A6 | DONE | brain-embedded/src/runStore/runPreamble.ts references selfReviewShipDirective; selfReviewShip.ts + selfReviewShip.test.ts | close as done.
- 6591 / 6518 A7 | DONE | commit 74ab4c259 "PRD 45 §4.6: plugin HTTP routes authenticate by default (agent-runtime)" | 6518 already done(100%); 6591 is an exact duplicate of 6518 — close 6591 as duplicate.
- 6592 B1-B3 | DONE | commit cc499f1e6 "outline-first reads (PRD 45 §4.7 B2) + readiness advisory (B1)"; packages/run-guards/src/readinessAdvisory.ts + readinessClaimRank.test.ts (B1); multiRead.ts + multiRead.test.ts (B3) | close as done.
- 6595 W9 | NOT_STARTED | PRD §8 table still shows targets em-dash (—); no re-measurement commit for #214/#216 replays after gates landed | keep open; blocked on 6596 (trace reader).
- 6584 W0 | DONE | api/scripts/chat-replay-baseline.cjs on disk; PRD §8 W0 baseline block filled with measured numbers (3,023,666 prompt tokens #214; 4,109,351 #216 session) | close as done.
- 6596 | NOT_STARTED | no telemetry trace-reader module found (grep for telemetryTrace / "trace reader" / chat-scoped telemetry across brain-embedded/src, api/src, packages/agent-run/src: no hits) | keep open; blocks W0 re-runs and W9.
- 6551 / 6586 A2 | DONE | clients/vscode/src/verify/ has 21 files (execRunner, typecheck, targetedTests, pathDiagnostics, formatDiagnostic, gitPort, fullTier, repoGuards) with .test.ts coverage incl. execRunner.process.test.ts (Windows .cmd launch) | close 6551 as done; 6586 exact duplicate of 6551.
- 6561 Part 1 | DONE | commit 74ab4c259 (same as A7) — plugin route auth landed | close as done.
- 6562 Part 2 | DONE | brain-embedded/src/runStore/publishHold.ts + publishHold.test.ts EXIST on disk; publishHold is chat-scoped (RunCell.publishHold), refuses git_commit/git_push/open_pull_request in callPreflight before the confirm gate, and swaps the ship directive in runPreamble while held. NOTE: scenarios/publishHold.ts does NOT exist — but that was the A4 done-check (gates.ts covers it), not 6562's; 6562's contract is the publish-hold gate itself | close as done.
- 6550 epic | PARTIAL | A1-A7 + B1-B4 + W0 landed (see above); remaining: W9 (6595, NOT_STARTED), trace-reader capability (6596, NOT_STARTED), B5/B6 (6552 partial), B7-B9 (6553 partial) | NOT "complete except W9/6596" — also 6552/6553 carry real remainder.
- 6560 epic | DONE | Part 1 = 74ab4c259, Part 2 = publishHold.ts on disk + wired in callPreflight/runPreamble | close epic as done.

## Exact duplicates
- 6594 ≡ 6553 (same title "B7-B9: narration fold, diagnostics counter, ticket title")
- 6593 ≡ 6552 ("B4-B6: batching nudge, plan checklist, superseded-read fold")
- 6586 ≡ 6551 ("A2: VSIX verifier (host port)")
- 6591 ≡ 6518 ("A7: plugin route auth by default") — 6518 already marked done
Close the higher-numbered copy of each pair; keep the original.
