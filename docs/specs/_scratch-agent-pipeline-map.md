# Agent Pipeline Map

How a chat becomes a run on every surface, as the code stands on 2026-11-22. Every surface does reach the one kernel (`runAgent` → `runAgentLoop`). The splits happen above and around it: each surface sets up the chat differently, routes the model differently, swaps different policy modules, and starts sub-agents by a different mechanism. Static read of the code, no runs traced.

## 1. As built: chat start to settle

The VS Code panel path is drawn in full. The other surfaces join at the kernel, and the notes show where each one forks.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant WV as VSIX webviewuseBrainConversation
  participant H as VSIX hostbrainRunHost
  participant BE as brain-embeddedstartRun / prepareBrainRun
  participant RA as agent-runrunAgent + policy hooks
  participant K as agent-looprunAgentLoop
  participant GW as API gatewaypickCloudModel
  participant T as Tools / hostnativeRunTool

  Note over WV,H: CHAT INIT
  WV->>H: ready
  H->>H: buildInit: resolveModelRoute, grounding, persona, labels
  H-->>WV: init frame (model, routingMode, personalityBlock)
  U->>WV: first message
  WV->>WV: ensureChatId (local-first id = run key)
  WV->>WV: useChatSystemPrompt: persona + project + editor + limbic + composer directives
  WV->>H: run.start (serialized request)
  H->>H: gateStarts: change-set id, run journal, delta capture
  H->>H: runTurn: policyGates, withRunPreamble, replaceWorkspaceMap, brainToolCatalog
  H->>BE: startRun(key, entryPoint "vscode")

  Note over BE: ROUTE + PROMPT (VSIX only)
  BE->>BE: decideRunPipeline: workload.classifyRunAction + pipeline-route.scorePipeline
  BE->>BE: classifyRequest / asksForChange (agent-stall), chatModeDirective
  BE->>BE: recall, prefetch, ship / review / prior-research directives
  BE->>BE: initialRunPolicy (startPhase, phaseModels, pinnedModel)
  BE->>RA: runPrepared: overrides compaction, model, finish

  Note over RA,K: THE KERNEL (shared by all surfaces)
  RA->>RA: buildContextPack (skipped rows when surface passes its own transcript)
  RA->>RA: model.preflight, guards.seed (D1 cascade, cloud only)
  RA->>K: runAgentLoop(complete, dispatch, kernelHooks)
  loop each turn
    K->>RA: complete -> completeTurn
    RA->>BE: brainTurnObserver / brainTurnMenu (per-turn role + tool menu)
    BE->>H: routeStream -> hostModelStream (local / hybrid / cloud)
    H->>GW: chat completion
    GW->>GW: difficultyGate, routingTable, BYO role order
    GW-->>K: turn (text + tool calls)
    K->>RA: dispatch -> dispatchCall
    RA->>BE: callPreflight / callRunner / callPostStep
    BE->>T: runTool (governance gates, confirm)
    T-->>K: result row
    K->>RA: hooks: stall, steering, guards, finish, failure streak
    BE->>BE: RunProgressGuard, progressBudget, ship gates (second detector set)
  end

  Note over T,H: SUB-AGENT (VSIX)
  T->>H: spawn_agent -> childRunHost.startChild
  H->>BE: internal start (skips gateStarts: no change set, journal, delta)
  BE->>RA: runAgent (no pipeline route, role pin via roleModelPin)
  RA-->>H: report -> queueRunSteering(owner) -> wake

  Note over RA,WV: SETTLE
  K-->>RA: LoopResult
  RA->>RA: settle / synthesizeFinal
  RA-->>BE: outcome
  BE->>BE: settleBrainRun, deterministicFinish, recordCodeChangeTicket, continueLeftovers
  BE->>GW: postRunOutcome (learned routing)
  BE-->>H: settled
  H->>H: flushNote, settleRun, childHost.afterRun, turnQueue.settled
  H-->>WV: run.settled (run.sync deltas)
  
```

Other surfaces enter at the **runAgent** lane: **Cloud**: cloudAgentEngine → cloudAdapter → runAgent, one step per Durable Object tick **Web chat reply**: agentReplyRun → runAgent **Canvas**: creationCanvasAi → runAgent (in the browser) **On-prem**: onPremAdapter → runAgent, and separately embedded-runner → agentLoop shim → channelAdapter → runAgent **VSIX @builderforce participant**: nativeBrainRun → runBrainLoop (= startRun) with no entry point

## 2. What differs by surface

| Stage | VSIX panel | VSIX participant | Cloud | Web reply | Canvas | On-prem |
| --- | --- | --- | --- | --- | --- | --- |
| Kernel | runAgent | runAgent | runAgent | runAgent | runAgent | runAgent via 2 adapters |
| entryPoint | vscode | unset → "web" | cloud | web | canvas | on-prem |
| Pipeline route (full / quick) | decideRunPipeline | same code, no stage models | none | none | none | none |
| Model choice | host route + stageModels + modelHook + gateway | host route + gateway | pickCloudModel + guards cascade | gateway | gateway | model-routing + candidate-ranking + learned-routing |
| Policy overrides | compaction, model, finish | compaction, model, finish | compaction, guards, finish | compaction | none | none |
| Finish gates | linked-work hold, spec-ticket coverage, ship gates | same | cloudFinishPorts, ship gate on guards | default, no ports | default, no ports | default, no ports |
| Stall / progress | Brain guard + kernel stall hook (A3 off) | same | kernel stall + guards | kernel | kernel | kernel + local stall-recovery.ts |
| Sub-agent spawn | childRunHost.startChild | no spawn tools | durable child execution | none | none | childRunner and spawnSubagentDirect |
| Child prompt | subagentSystemPrompt | n/a | subagentSystemPrompt | n/a | n/a | childPolicy, and separately buildSubagentSystemPrompt |

## 3. Duplication and wrong logic

- wrong**The policy a run gets depends on where the chat started.** `composePolicyHooks` replaces whole modules per surface. The VSIX binds its own finish gates, the cloud binds guards and finish, the web reply binds only compaction, and canvas and on-prem bind none. The same request ends under different gates on each surface. Canvas, web reply and on-prem finish with an unported default finish hook.

  packages/agent-run/src/policy/index.ts:108 · brain-embedded/src/run/runPrepared.ts:90 · api/src/application/runtime/cloudAdapterHooks.ts:104 · api/src/application/brain/agentReplyRun.ts:206
- wrong**Sub-agents are started four different ways.** The VSIX re-enters its host start. The cloud creates a durable child execution. On-prem runs an in-process `runAgent` with `childPolicy`. On-prem also has a second live path, `spawnSubagentDirect`, with its own `buildSubagentSystemPrompt`. The shared `childPolicy / childProvider / childResult` primitives are used only by on-prem.

  clients/vscode/src/childRunHost.ts:139 · api/src/application/runtime/cloudChildRuns.ts:96 · agent-runtime/src/run/onPremSubagents.ts:43 · agent-runtime/src/agents/subagent-spawn.ts:271
- wrong**VSIX children skip the start gate.** `startChild` calls the host's inner start, so a child gets no change-set identity, run-journal start or delta capture. A child that writes files is invisible to the change-set record and to crash recovery.

  clients/vscode/src/brainRunHostPorts.ts:346 (gateStarts) · clients/vscode/src/childRunHost.ts:139
- wrong**The @builderforce participant runs as "web".** `nativeBrainRun` sets no `entryPoint`, and `runPrepared` defaults to `'web'`. Telemetry, entry-point attribution and any entry-specific policy get the wrong surface. The participant also has no sub-agents or steering, and its own run-journal code.

  brain-embedded/src/run/runPrepared.ts:38 · clients/vscode/src/nativeBrainRun.ts
- wrong**Routing is decided in at least five places, and only the VSIX routes the pipeline.** Full vs quick (`decideRunPipeline`) runs only in brain-embedded, so cloud, canvas and on-prem runs never get a quick path or phase models. Model choice is split across the VSIX host, stage models, role pins, the kernel's model hook and guards cascade, the API gateway, and on-prem's own model-routing and learned-routing. Sub-agents are never routed.

  brain-embedded/src/runStore/pipelineRoute.ts:24 · clients/vscode/src/modelRouting.ts:90 · clients/vscode/src/stageModels.ts:74 · clients/vscode/src/roleModelPin.ts:59 · api/src/application/llm/pickCloudModel.ts · agent-runtime/src/agents/model-routing.ts
- duplicate**Two stall and progress systems run in the VSIX.** Brain `RunProgressGuard` and `progressBudget` run beside the kernel's `stallHook`, the run-guards progress detector, `autoContinueGuard` and the kernel failure-streak breaker. The kernel's A3 detector is switched off in the VSIX to avoid a clash, so the two surfaces stall differently.

  brain-embedded/src/runStore/progressGuard.ts:58 · packages/agent-run/src/policy/stall/index.ts:129 · brain-embedded/src/run/webAdapter.ts
- duplicate**Finish runs twice, and continuation lives in three places.** `deterministicFinish` is called directly from `startRun` and also wraps the finish hook. Failure close is both `closeAfterFailureStreak` and the kernel's `synthesizeFinal`. Continuation is `continueChat` (cap 5), host `childRunHost.wake` plus `turnQueue`, and the webview's `useContinuation` and interrupted resume.

  brain-embedded/src/runStore/startRun.ts · brain-embedded/src/runStore/continueChat.ts:245 · packages/agent-run/src/runAgent.ts:176
- duplicate**The system prompt is built in four layers.** Webview `useChatSystemPrompt`, host `withRunPreamble`, brain-embedded `prepareBrainRun`, and the participant's `buildSystemMessages`. When a surface hands its own transcript, the kernel's `openingRows` (governance and persona) are bypassed, so the kernel cannot guarantee the opening is the same on every surface.

  packages/agent-run/src/runAgent.ts:84 · brain-embedded/src/runStore/runPreamble.ts · clients/vscode/src/runPreamble.ts · clients/vscode/src/prompt.ts
- duplicate**On-prem enters the kernel through two adapters.** `onPremAdapter` and the channel path (`runEmbeddedAttempt` → `createAgentSession` → `agentLoop` shim → `runChannelAgent`). The channel path also keeps its own compaction, stall-recovery and run-governance beside the kernel's.

  agent-runtime/src/run/onPremAdapter.ts:30 · agent-runtime/src/run/channelAdapter.ts:21 · agent-runtime/src/builderforce/agent-loop/
- gap**The VSIX kernel gates are empty.** `runPrepared` passes `capabilities: new Set()`, `approvalGates: []` and `verify: 'none'`. Capability and governance checks happen in the host tool instead, so the kernel's call-time capability gate does nothing in the VSIX.

  brain-embedded/src/run/runPrepared.ts · brain-embedded/src/run/webAdapter.ts:117 · clients/vscode/src/localCapabilities.ts
- stale**The kernel's header is wrong.** `loop.ts` says every surface drives `runAgentLoop`. Only `runAgent` imports it, which is correct, but the comment misleads.

  packages/agent-loop/src/loop.ts:4

## 4. Current-state workflow

The same view as the target below, drawn as the code stands today. Red boxes are logic that exists in two or more places or is wrong. Amber boxes run on one surface only. Dashed lines are sub-agent paths.

```mermaid
flowchart TD
  subgraph Entry["Entry points: each builds its own run"]
    E1[VSIX panelwebview]
    E2[VSIX @builderforceparticipant]
    E3[Web chat replyagentReplyRun]
    E4[CanvascreationCanvasAi]
    E5[Cloud tickcloudAgentEngine]
    E6a[On-premonPremAdapter]
    E6b[On-prem channelsattempt → agentLoop shim]
  end

  E1 --> P1["webview promptuseChatSystemPrompt"]:::dup
  P1 --> GS["host gateStartschange set, journal, delta"]:::one
  GS --> HR["host runTurnwithRunPreamble, tool catalog,resolveModelRoute, stageModels"]:::dup
  E2 --> NB["nativeBrainRunbuildSystemMessages, own journalentryPoint unset → web"]:::bad
  HR --> SR
  NB --> SR["brain-embedded startRunprepareBrainRun"]
  SR --> PR["decideRunPipelinefull / quick, phase models"]:::one
  PR --> BP["brain prompt layerrecall, mode, ship, review directives"]:::dup
  BP --> RP["runPreparedoverrides: compaction, model, finishcapabilities empty, approvalGates empty"]:::bad

  E5 --> CA["cloudAdapterpickCloudModel + guards cascadeoverrides: compaction, guards, finish"]:::dup
  E3 --> AR["agentReplyRunoverrides: compaction only"]:::bad
  E4 --> CC["canvas runno overrides"]:::bad
  E6a --> OA["onPremAdapterno overrides"]:::bad
  E6b --> CH["channelAdapterown compaction, stall-recovery,governance beside the kernel's"]:::dup

  RP & CA & AR & CC & OA & CH --> K["runAgent → runAgentLoop(shared kernel)"]:::ok

  K -->|turn| MS["model choice againmodelHook, brainTurnObserver,hostModelStream, gateway difficultyGate,on-prem model-routing"]:::dup
  K -->|tool call| TD["dispatchVSIX: nativeRunTool gatesothers: kernel capability gate"]
  K --> ST["stall / progresskernel stallHook + failure breaker+ VSIX RunProgressGuard, progressBudget"]:::dup

  TD -.->|VSIX spawn_agent| C1["childRunHost.startChildskips gateStarts, no pipeline route"]:::bad
  TD -.->|cloud spawn| C2["cloudChildRunsdurable child execution"]:::dup
  TD -.->|on-prem spawn| C3["onPremSubagentschildPolicy, in-process runAgent"]:::dup
  TD -.->|sessions_spawn, /subagents| C4["subagent-spawn.tsown buildSubagentSystemPrompt"]:::bad
  C1 -.-> SR
  C2 -.-> CA
  C3 -.-> K
  C4 -.-> E6b

  K --> F["settle + synthesizeFinal"]
  F --> FV["VSIX settle layersettleBrainRun, deterministicFinish again,closeAfterFailureStreak"]:::dup
  FV --> CN["continuation in 3 placescontinueChat, childRunHost.wake + turnQueue,webview useContinuation"]:::dup
  F --> O["outcome → learned routing (VSIX only),telemetry, run.settled"]
  SR --> WI["work items: recordCodeChangeTicket,chatWorkLinking (after the fact, VSIX only)"]:::one
  RP --> WH["finish holds: openLinkedWorkHold,specTicketCoverageGate, ownerFinishHold (VSIX only)cloud: liveChildrenFinishBlock only"]:::one
  FV --> EV["grading: codeRunOutcome, brainVerdict / brainTriage(VSIX only, triage can say healthy on a failed run)"]:::bad

  classDef dup fill:transparent,stroke:#c0392b,stroke-width:2px;
  classDef bad fill:transparent,stroke:#c0392b,stroke-width:2px,stroke-dasharray:4 3;
  classDef one fill:transparent,stroke:#d08a1a,stroke-width:2px;
  classDef ok fill:transparent,stroke:#2e8b57,stroke-width:2px;
  
```

**Solid red**: duplicated logic **Dashed red**: wrong or missing (empty gates, wrong entry point, skipped start gate) **Amber**: runs on one surface only **Green**: shared by every surface

## 5. Target workflow: one pipeline for every modality

A surface supplies ports only. Everything that decides behaviour sits once, below the entry, and a sub-agent re-enters at the same place as a user's chat.

```mermaid
flowchart TD
  subgraph Entry["Entry points: ports only"]
    E1[VSIX panel]
    E2[VSIX participant]
    E3[Web chat / canvas]
    E4[Cloud tick]
    E5[On-prem / channels]
  end
  E1 & E2 & E3 & E4 & E5 --> S["openRun(request, ports)chat id, run id, entryPoint required"]
  SA["spawn_agent(any surface)"] -->|"same call, lineage set"| S
  S --> G["startGatechange set, journal, delta"]
  G --> R["routeRun: ONE decisionintent, full/quick, phase, role → model"]
  R --> W["planWork: create ASSIGNED work itemsone item per task, owner = this agent or a named sub-agent,acceptance criteria on each item"]
  W --> P["buildOpening: ONE promptgovernance, persona, mode, recall, directives,the run's work items"]
  P --> C["composePolicy: ONE module setsurface varies ports, never modules"]
  C --> K["runAgent → runAgentLoop"]
  K -->|turn| M["model port → gatewayapplies the routed model"]
  K -->|tool call| D["dispatch portcapability + governance gate"]
  D -->|spawn_agent| SA
  D -->|"work item done / blocked"| WL[("work ledgeritem status, evidence")]
  SA -.->|"child owns its items"| WL
  K -->|finish requested| FG{"all work items closed?every item done with evidenceor blocked with a named blocker;no live children"}
  FG -->|"no: open items returned as the next turn"| K
  WL --> FG
  FG -->|yes| F["settle: ONE finish pathfinal answer, items closed on the board"]
  F --> EV["evaluateRun: DETERMINISTIC scoresame inputs → same score, no model call"]
  WL --> EV
  EV --> SC["scorecarditems closed vs planned · criteria met ·typecheck/tests/CI result · gates passed ·steps, tokens, cost vs budget · failovers, stalls"]
  SC --> O["outcome → learned routing, diagnostics, telemetry, run.settled"]
  
```

Consolidation order: (1) require `entryPoint` and route the participant through the panel's host start; (2) one `spawnChild` built on `childPolicy`, called by every surface, entering at `openRun` so children pass the start gate; (3) move `decideRunPipeline` and model choice into one `routeRun` below the entry; (4) `planWork` creates the run's assigned work items up front, and one finish gate refuses to settle while any item is open or a child is live, on every surface. Today that exists only in the VS Code path (`openLinkedWorkHold`, `specTicketCoverageGate`, `recordCodeChangeTicket`), and items there are recorded after the work instead of planned before it; (5) one `evaluateRun` that scores every run from the work ledger and the trace with no model call, replacing `codeRunOutcome`, `brainVerdict` and `brainTriage`, and feeding learned routing and diagnostics; (6) one stall module set with ports per surface; (7) retire the second on-prem adapter and `spawnSubagentDirect`.