# @seanhogg/builderforce-voice

Voice-cloning + LLM-narration client for **Builderforce.ai Studio**. One seam —
`resolveNarrationEngine()` (or the `VoiceClient` wrapper) — turns a `voiceId`
(a `studio_voice_clones.id`) plus text into audio, choosing the best available
backend and degrading **honestly**:

1. **On-device clone** (`clone-client`) — the `@seanhogg/builderforce-studio` SSM
   clone engine on WebGPU. $0 marginal infra, runs on the user's GPU, nothing is
   billed. Preferred when available.
2. **Server clone** (`clone-server`) — `POST /api/studio/voice-clones/:id/synthesize`
   on the Builderforce gateway: license-checked, token-metered
   (`voice_clone_synthesis`), read-through cached, persisted to `studio_voiceovers`.
   Works on every device, including mobile / Safari with no WebGPU.
3. **Named fallback** (`fallback`) — your existing non-cloned voice (Kokoro /
   Piper / Web Speech). Used only when no clone path can run, and **always**
   flagged `cloned: false` with a human-readable reason, so the UI can say
   *"Cloning unavailable — using Narrator"* instead of swapping silently.

Every studio LLM flow (AI script → narration, dubbing, the value-prop / pitch
builder) routes through the same seam, so none of them re-implements provider
selection, licensing, or the fallback contract.

## Install

```bash
npm install @seanhogg/builderforce-voice
# optional, only for the on-device ($0) path:
npm install @seanhogg/builderforce-studio
```

## Quick start (server path — works everywhere)

```ts
import { VoiceClient } from '@seanhogg/builderforce-voice';

const voice = new VoiceClient({ apiKey: process.env.BUILDERFORCE_API_KEY! });

const result = await voice.narrate('clone_abc123', {
  text: 'The AI wrote this — and it speaks in my voice.',
});
// result.engineId === 'clone-server', result.cloned === true
// result.audioUrl, result.durationMs, result.wordTimestamps
```

## On-device clone (free, when WebGPU is present)

```ts
import { VoiceClient } from '@seanhogg/builderforce-voice';
import { VoiceCloneEngine } from '@seanhogg/builderforce-studio';

const engine = new VoiceCloneEngine();
const speaker = engine.enroll(referencePcm); // enrol once, persist the embedding

const voice = new VoiceClient({ apiKey, clientEngine: engine });
const result = await voice.narrate('clone_abc123', { text }, { speaker });
// Prefers 'clone-client' (on-device); never touches the metered endpoint.
```

## The honesty contract

```ts
import { resolveNarrationEngine, getEngineUnavailableReason } from '@seanhogg/builderforce-voice';

const engine = await resolveNarrationEngine({ voiceId, providers, fallback });
if (!engine.cloned) showBanner(engine.fallbackReason); // shown BEFORE synthesizing
const audio = await engine.synthesize({ text });
```

`getEngineUnavailableReason(providers)` is the single source of truth for
"can I clone right now" — the picker, the dubbing panel header, and the pitch
button all read it instead of each recomputing availability.

## Status

The server endpoint and the on-device clone *model weights* are tracked in the
repo's Consolidated Gap Register (voice gaps #1991, #1994–#2000). This package is
the client seam: it is complete and stable, and a better clone model is a config
swap behind the same interface, not a call-site rewrite.
