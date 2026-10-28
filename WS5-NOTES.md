# WS5 — on-prem adapter (PRD 35 §3.1/§4)

Branch: ws5-onprem-adapter
Worktree: Builderforce.ai/.builderforce/worktrees/ws5

## Files
- agent-runtime/src/run/onPremAdapter.ts — the on-prem adapter (~209 lines).
- agent-runtime/tsconfig.json — adds the `"@builderforce/agent-run": ["../packages/agent-run/src/index.ts"]`
  paths mapping (same one-line pattern as ws3/api and ws4/clients/vscode; the importer declares
  its own source mapping, never editing packages/agent-run).

## Ports built from the on-prem host
- model: host's ModelTransport
- capabilities: buildNodeCapabilityProvider (node fs + shell, native AgentTools) unless the host supplies one
- store: session-file store — load from host.resume, save via host.save or session.persistLeaf(), commitMemory passthrough
- events: relay frames — sendToRelay({type:'run.event', event}) best-effort
- human: process-wide approval gate (host.askHuman), defaults to paused
- steering: drained-once buffer
- context: host context pack or {focus:[],facts:[],recall:[]}
- policy.entryPoint: 'on-prem' literal — telemetry label only, NEVER branched on

## Outcome mapping
finished → ok/finished · paused → awaitingInput (not terminal) · yielded → not finished, state for next tick · failed → ok:false, cancelled when reason === 'cancelled'

## Verify
npx tsc --noEmit -p agent-runtime/tsconfig.json — src/run/onPremAdapter.ts: 0 errors
(no new errors vs baseline; node_modules absence noise is environmental).
