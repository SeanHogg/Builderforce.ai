# VSIX harness — validate the chat without building a VSIX

Validating a change to the extension's chat used to mean: change code → `vsce package` →
install the `.vsix` → reload the window → retype the prompt → click **Copy** → paste the
output somewhere and read it. Several minutes per attempt, most of which confirmed the
same failure.

The chat is really the run loop in `@seanhogg/builderforce-brain-embedded` talking to one
injected function — `stream(opts, handlers)` — and everything a triager cares about
(tool dispatch, stall recovery, model failover, context compaction, the diagnostics
verdict) is deterministic given the completions that function returns. So this directory
does two things:

| | what it exercises | needs |
|---|---|---|
| `pnpm harness` | the real loop, against **scripted** model behaviour | nothing |
| `pnpm probe "…"` | the real loop, against the **real** gateway | `BF_EDITOR_KEY` |
| `pnpm test` | the scripted scenarios, as assertions | nothing |

Both print the **exact** report the chat's Copy button produces — same
`buildTranscript`, same diagnostics block — so a harness result can be read the same way
a pasted bug report is.

## Offline: replay the failure catalogue

```
pnpm harness                             # every scenario, with its verdict
pnpm harness --only narrates-forever     # …and print that one's full report
pnpm harness --only narrates-forever --json
pnpm harness list                        # what's in the catalogue
```

The whole catalogue runs in well under a second:

```
narrates-forever       verdict=tool-calls-not-emitted · tools=0 · turns=4 · reprompts=3 · GAVE-UP
narrates-then-acts     verdict=healthy · tools=1 · turns=3 · reprompts=1
failover-rescues       verdict=healthy · tools=1 · turns=6 · reprompts=3 · failovers=1
tool-not-advertised    verdict=tool-not-advertised · tools=0 · turns=4 · reprompts=3 · GAVE-UP
…
```

### Adding a scenario

A newly-reported chat failure belongs in [`scenarios.ts`](./scenarios.ts) as a statement
of what the MODEL did — nothing about what the loop should do in response, which is what
the tests assert:

```ts
{
  id: 'answers-without-calling',
  what: 'Model answers from memory instead of calling the tool it was given',
  prompt: 'How many tickets are in the backlog?',
  script: [{ text: 'There are about twenty tickets in the backlog.' }],
}
```

`script` is either a fixed list of turns or `(ctx) => turn`, where `ctx` carries the turn
index, the requested model, the tools advertised that turn and the transcript so far —
enough to model a model that changes behaviour once it has a tool result, or once the
loop swaps models under it. Turns past the end of a fixed list repeat the last one, so a
model that misbehaves *forever* is the default rather than something you have to spell
out.

## Live: run a real turn from the terminal

```
BF_EDITOR_KEY=bfk_… pnpm probe "review the backlog and group by status"
BF_EDITOR_KEY=bfk_… pnpm probe --chat 85 --model xai-oauth/grok-4.3 "…"
BF_EDITOR_KEY=bfk_… pnpm probe --no-tools "…"     # reproduce a failed tool catalog
```

Same gateway, same tenant, same chat rows, same tool catalog, same system prompt as the
installed extension. Get an editor key from `<web app>/activate` — the page the
extension's own sign-in opens.

A probe spends real tokens and writes real chat rows, exactly as reproducing the failure
by hand does. It exits `2` when the run never emitted a tool call (or was handed none),
so a shell pipeline or CI job can gate on it.

## What is real, and what is not

Real: the agent loop, the IDE system prompt, the extension's own `TOOL_DEFS`, per-turn
tool selection, stall recovery, model failover, durable step persistence, the inline
tool-call dialect filter, `buildTranscript`, and the diagnostics.

Faked (offline only): the gateway (`fakeGateway.ts`), the API (an in-memory message
store) and tool execution (canned results). Nothing between a model's output and a
diagnostics verdict is stubbed — that path is what these tests exist to hold still.

## What it does not cover

Anything above the run loop: React rendering, the webview↔host `postMessage` bridge, tree
views, commands, activation. Those still need a real extension host. The harness is
aimed at the layer where the reported failures actually live.
