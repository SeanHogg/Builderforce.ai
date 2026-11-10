import { B as BrainTraceEvent, x as StreamFailureDetail, U as UsageSurface, a as BrainMessage } from './brainTriage-RveFqfcR.js';
import { L as LocalRuntimeId, b as LocalEndpoint, a as LocalRuntimeProbe, c as LocalModel } from './probe-DkPrGnWT.js';
import { EvermindRecallResult } from '@seanhogg/builderforce-memory/evermind';
import { ConsolidateOptions, ConsolidatedMemory } from '@seanhogg/builderforce-memory/working';

/**
 * The SINGLE source of truth for the composer's "Effort" control.
 *
 * Effort used to be prose-only (a system-prompt nudge), so picking Quick vs
 * Thorough changed nothing measurable about the request. It now drives THREE
 * things, and every consumer — the UI that describes an effort level to the
 * user, and the request builder that puts it on the wire — reads them from
 * here, so the numbers can never drift apart:
 *
 *   1. `maxTokens`  → the request's `max_tokens` (previously a hardcoded 4096
 *                     for every turn regardless of effort).
 *   2. `reasoningLevel` → the level sent when the Thinking toggle is ON.
 *   3. the system-prompt nudge (kept — but no longer the ONLY effect).
 *
 * ── Why the wire field is VENDOR-NEUTRAL ────────────────────────────────────
 * The client must NOT emit vendor-specific reasoning params. The gateway's
 * `reasoningCapability.ts` is the one conservative registry mapping a model id
 * to the CORRECT vendor param (Anthropic `thinking` for bare `claude-*` only;
 * OpenAI `reasoning_effort` for o-series/gpt-5; everything else dropped), and a
 * blanket Anthropic `thinking` sent to a strict OpenAI-compatible coder 400s the
 * whole run. The client frequently does not even know the model — the picker's
 * default is "auto (let the gateway choose)".
 *
 * So we send INTENT ONLY (`reasoning: { level }`) and the gateway maps it
 * against the model it actually RESOLVED. {@link ReasoningLevel} deliberately
 * uses the same member names as the server's `AgentThinkLevel` union so the
 * gateway can feed it straight into `reasoningParamsForModel` with no second
 * translation table.
 *
 * `balanced` + Thinking OFF is the neutral default and produces a request
 * byte-identical to the pre-change one (max_tokens 4096, no `reasoning` key).
 */
/** How hard the model should work on the next turn — the composer's `/` menu. */
type Effort = 'quick' | 'balanced' | 'thorough';
/**
 * Vendor-neutral reasoning intent. Member names match the server's
 * `AgentThinkLevel` (from `@builderforce/agent-tools`) so the gateway maps them
 * without translating. Intentionally NOT imported from that package: this SDK
 * is published standalone and dependency-free.
 */
type ReasoningLevel = 'off' | 'low' | 'medium' | 'high';
/** The vendor-neutral reasoning field carried on the wire. */
interface ReasoningIntent {
    level: ReasoningLevel;
}
/** Everything one effort level decides. */
interface EffortProfile {
    effort: Effort;
    /** `max_tokens` for the completion — the answer-length/cost lever. */
    maxTokens: number;
    /** The level sent as `reasoning.level` when Thinking is ON. */
    reasoningLevel: Exclude<ReasoningLevel, 'off'>;
    /**
     * The extended-thinking token budget the gateway's registry maps
     * `reasoningLevel` to. Mirrors `THINK_BUDGET_TOKENS` in
     * `api/src/application/llm/reasoningCapability.ts` (low 2048 / medium 8192 /
     * high 16384). DISPLAY ONLY — never sent, so the client cannot drift the
     * server's actual budget; it exists so the menu can tell the user what the
     * toggle really costs.
     */
    thinkingBudgetTokens: number;
    /**
     * The system-prompt nudge for this level, or '' for the neutral default.
     * Kept alongside the real params (belt and braces for models whose family the
     * server registry drops the reasoning param for).
     */
    directive: string;
}
/** The profile for an effort level. Unknown/absent input falls back to `balanced`. */
declare function effortProfile(effort: Effort | undefined): EffortProfile;
/** Is this a known effort level? Guards a persisted/user-supplied string. */
declare function isEffort(value: unknown): value is Effort;
/**
 * The vendor-neutral reasoning intent for a run, or `undefined` when Thinking is
 * OFF — in which case the caller omits the field entirely and the request stays
 * byte-identical to one from before this feature existed.
 */
declare function reasoningForRun(o: {
    effort: Effort;
    thinking: boolean;
}): ReasoningIntent | undefined;

/**
 * LOCAL FIRST — the ordered attempts for one call: capable on-device model(s), then the
 * cloud gateway.
 *
 * "Capable" is decided from what the runtime REPORTED, conservatively:
 *  - a TOOL turn goes only to a model the runtime says can take tools; unknown is no.
 *    A model that ignores `tools` answers an agent turn with prose about calling one —
 *    that is not a failure the failover can see, so it must never be attempted;
 *  - a model whose reported context window cannot hold the prompt plus the expected
 *    completion is skipped. An UNREPORTED window is not disqualifying: an overflow there
 *    is an HTTP error from the runtime, which the failover does see and recovers from.
 *
 * Only `onDevice` runtimes take part, in the registry's `automaticRank` — our engines
 * first, a third-party server (Ollama, FreeToken) last. `kimi-code` is locally dispatched
 * but hosted, so it is reachable by an explicit pin and never by local-first. Pure.
 */

/**
 * The slice of `@builderforce/workload`'s `WorkloadProfile` this plan reads. Structural
 * on purpose: a `WorkloadProfile` is assignable to it, and the package stays free of
 * the workload package's own dependency graph — it is bundled into the editor's webview
 * and a browser extension, where that graph would have to be resolved too.
 */
interface LocalFirstWorkload {
    /** The call carries tools (an agent turn). */
    agentic: boolean;
    inputTokens: number;
    outputTokens: number;
}
type LocalFirstAttempt = {
    kind: 'local';
    /** Full `local/<runtime>/<model>` ref — what a trace and a provenance chip show. */
    ref: string;
    provider: LocalRuntimeId;
    /** The bare id the runtime knows. */
    model: string;
    endpoint: LocalEndpoint;
} | {
    kind: 'cloud';
    /** The host's cloud choice; undefined = let the gateway route. */
    model?: string;
};
/**
 * A connected subscription this host calls ITSELF because its provider refuses our cloud
 * (Kimi Code — registry `accountProvider`). Hybrid tries it after this device and before
 * the cloud, the way the gateway leads with the tenant's other connected accounts.
 */
type LocalFirstAccount = Omit<Extract<LocalFirstAttempt, {
    kind: 'local';
}>, 'kind'>;

/**
 * Run a local-first plan: each attempt in order, falling over to the next when one fails
 * BEFORE the user saw anything, and recording every attempt so a trace shows which
 * served.
 *
 * The rule that makes the failover transparent rather than merely automatic is
 * COMMITMENT. The moment an attempt has streamed output to the user (a text delta, a
 * tool-call fragment) it owns the turn: replaying the turn elsewhere would show the user
 * two answers spliced together, so a failure after that point is rethrown, not retried.
 * Before it, a failure — refused connection, HTTP error, a runtime that rejects the
 * model, an empty answer — is invisible, and the next attempt runs as if it were first.
 *
 * A Stop is never failed over: an aborted signal rethrows whatever the attempt threw.
 * Transport-agnostic: the host supplies `run`, so the same rule drives the editor's
 * transport seam and a browser extension's.
 */

type LocalFirstOutcome = 'served' | 'failed' | 'refused';
interface LocalFirstAttemptRecord {
    attempt: LocalFirstAttempt;
    outcome: LocalFirstOutcome;
    /** Why it did not serve (`failed`: the error's message; `refused`: an empty answer). */
    detail?: string;
}

/**
 * Evidence ledger (PRD 45 §4.2) — the pure half of the deterministic run gates.
 *
 * Evidence is a host fact keyed by the BYTES ON DISK. The ledger never hashes
 * anything itself (pure: no I/O, no clock — callers pass `at`) and never accepts
 * model prose: the only way a check lands here is the host calling `record` with
 * the content hash the host computed. A model's transcript line
 * `npx tsc | grep | head; echo DONE` has no path into this module — and even a
 * forged CheckRecord is useless, because the gate looks evidence up by the hash
 * of the file's real bytes, which the model does not control.
 *
 * Keys are normalised through {@link normalizeEvidencePath}: backslashes become
 * forward slashes so a Windows absolute path and a repo-relative path for the
 * same file share one entry. Hosts that want repo-relative display paths
 * (FileEvidence.path) simply pass repo-relative keys; the module echoes them.
 *
 * Rules:
 * - `record` for a non-latest hash is DROPPED — a stale check finishing late,
 *   after the file was rewritten, must never bless the new bytes.
 * - `noteWrite` drops evidence for older hashes of the path. Correctness never
 *   depends on it: the gate hashes the bytes at gate time and asks `for(hash)`,
 *   so a forgotten `noteWrite` only leaves memory that a lookup then misses.
 * - Lifetime is one run; `snapshot`/`createEvidenceLedger(resume)` exist so a
 *   host persisting between steps (the cloud durable loop) can carry it.
 */
type CheckKind = "diagnostics" | "typecheck" | "test" | "guard";
interface CheckRecord {
    kind: CheckKind;
    /** "lsp", "pnpm --filter @builderforce/agent-tools typecheck", "check:source-package-graph" */
    name: string;
    /** unavailable = no such check here, or it timed out (OD-3) — never a pass. */
    outcome: "pass" | "fail" | "unavailable";
    /** The process exit code the HOST captured; null for lsp/unavailable. */
    exitCode: number | null;
    /** ≤ 20 lines "path:line:col severity message (code)". */
    findings: readonly string[];
    /** epoch ms, passed in — the module stays clock-free. */
    at: number;
}

/**
 * Gate decisions (PRD 45 §4.3) — the pure half of the deterministic run gates.
 *
 * Every gate takes facts and returns a {@link GateVerdict}; none does I/O. The gates
 * trust only what is in the {@link EvidenceLedger}, and the ledger is keyed by the
 * bytes on disk — so evidence the model *claims* in its output can never satisfy a
 * gate. A line in a model's transcript such as
 *
 *     npx tsc | grep error | head -20; echo DONE
 *
 * never reaches this module: no host code parses model output into CheckRecords.
 * Even a forged record is useless, because the gate looks evidence up by the hash of
 * the file's real bytes at gate time (`OutgoingFile.hash`, computed by the host from
 * the file itself), and the model does not control that hash. A `tsc | grep | head`
 * pipe also hides the real exit code behind `head`'s — which is exactly why the host
 * captures process exit codes itself and why a record without a host-captured hash
 * match counts for nothing here.
 *
 * A required check passes when its `outcome` is "pass". "unavailable" passes AND is
 * reported in the verdict's `unavailable` list (OD-3: shown in the approval prompt,
 * never reported as verified). "fail" refuses. A diagnostics record additionally
 * fails on any `error`-severity finding for the file, even when its outcome says
 * pass — the LSP is the source of truth there, not the exit code.
 *
 * `outgoingGate` is THE ship gate: it fires at `git_commit` (advisory), `git_push`
 * and `open_pull_request` (refusal), and ticket completion (via the host). A file
 * changed by `run_command`, a sub-agent, or the human in the editor is handled
 * identically — the host re-hashes the bytes and the gate asks for evidence against
 * the new hash. Deleted paths need no checks of their own; the owning package's
 * typecheck covers what imported them (PRD §4.2).
 */

interface EvidencePolicy {
    /** By extension, e.g. ".ts": ["diagnostics","typecheck","test"]. */
    required: Readonly<Record<string, readonly CheckKind[]>>;
    /** A NEW source file must ship with a test in the same push. */
    newSourceNeedsTest: boolean;
    /** Per check; a timeout records "unavailable", never "pass" (OD-3). */
    checkTimeoutMs: number;
}
interface OutgoingFile {
    /** Key the ledger was recorded under (repo-relative with forward slashes, or absolute). */
    absPath: string;
    /** Hash of the file's CURRENT bytes, computed by the host at gate time. */
    hash: string;
    isNew: boolean;
    deleted: boolean;
}
/** OD-1: an independent review verdict, produced by a different model over the diff. */
interface ReviewVerdict {
    reviewerModel: string;
    verdict: "approved" | "changes_requested";
    diffHash: string;
    findings: readonly string[];
}

/**
 * The timeline step the Brain run loop records when a LOCAL-FIRST turn did not end
 * where it started — an on-device model was tried and the turn fell over to the next
 * attempt (usually the cloud gateway).
 *
 * The served model already reaches the provenance chip as the turn's `resolvedModel`
 * (`local/<runtime>/<model>` for a local answer). What would otherwise be invisible is
 * the fallback itself: "why did this turn go to the cloud when I have Synapse running?"
 * must have an answer in a copied diagnostics report and a reopened chat. Same shape and
 * category as the other `llm.*` self-reports (see `runPolicyTraces.ts`). Pure: the
 * caller stamps `ts`.
 *
 * Attempts are carried as SUMMARIES (`target` + outcome), never as the plan's attempts:
 * those hold the runtime endpoint, and its bearer must never reach a persisted step.
 */

/** One attempt as a trace may record it — no endpoint, no credential. */
interface LocalFirstAttemptSummary {
    /** `local/<runtime>/<model>` for a local attempt; `gateway` (or the cloud model) otherwise. */
    target: string;
    outcome: LocalFirstAttemptRecord['outcome'];
    detail?: string;
}
/** Project a runner record onto what a trace may hold. */
declare function summarizeLocalFirstAttempt(record: LocalFirstAttemptRecord): LocalFirstAttemptSummary;
/**
 * The `llm.local_fallback` step for a turn's attempts, or null when the first attempt
 * served (nothing fell over, so there is nothing to explain).
 */
declare function localFallbackTrace(ts: string, step: number, attempts: readonly LocalFirstAttemptSummary[] | undefined): BrainTraceEvent | null;

/**
 * The single tool-capable, streaming chat-completion client for the Brain.
 *
 * Targets the OpenAI-compatible gateway `POST {baseUrl}/llm/v1/chat/completions`
 * with `stream: true`, forwards `tools`/`tool_choice`, and surfaces BOTH text
 * deltas and `tool_calls` deltas to the caller.
 *
 * Unlike the in-app original, auth and error mapping are injected via a
 * `BrainTransport` (baseUrl + getToken + onUnauthorized + mapError) so the same
 * client works for builderforce.ai (tenant JWT) and external embeds (a
 * short-lived relay token) without importing any app code.
 *
 * Tool names are kept flat snake_case by convention (no dots), so the gateway's
 * tool-name sanitizer is a no-op and streamed `tool_calls` names round-trip
 * unchanged.
 *
 * Some models emit tool calls inline in the *text* stream as `<tool_call>…`
 * markup instead of native `tool_calls` deltas. {@link XmlToolCallFilter} lifts
 * those into the same structured shape (so they actually execute) and strips the
 * markup from the visible text — see `xmlToolCalls.ts`.
 */

/** Injected auth + endpoint config. Built once by BrainProvider from BrainConfig.transport. */
interface BrainTransport {
    /** Gateway base URL, e.g. https://api.builderforce.ai (no trailing slash). */
    baseUrl: string;
    /** Returns the current bearer token (tenant JWT or embed relay token), or null. */
    getToken: () => string | null;
    /** Called on a 401 so the host can clear the session / redirect. */
    onUnauthorized?: (res: Response, hadToken: boolean) => void;
    /** Map a non-OK response to a typed Error (e.g. plan-limit handling). */
    mapError?: (res: Response) => Promise<Error>;
    /** Default model when a call doesn't specify one. */
    defaultModel?: string;
    /**
     * Optional networking override. When set, the streaming request is performed
     * through this instead of the global `fetch`. It MUST resolve to a `Response`
     * whose `body` is a readable stream of the raw SSE bytes (same contract as
     * `fetch`). Hosts that can't reach the gateway directly from the UI context
     * (e.g. a VS Code webview, where a `vscode-webview://` origin is CORS-blocked)
     * inject a fetch that proxies the call through their privileged side. Defaults
     * to the global `fetch` for the browser/web app.
     */
    fetch?: (input: string, init: RequestInit) => Promise<Response>;
    /**
     * `openai`: the transport reaches a provider's plain OpenAI route, not the gateway
     * (`localTransport`). The gateway-only fields — `strict`, `routingMode`,
     * `excludeModels`, `role`, `arcStage`, `reasoning`, `metadata` — are never sent: the
     * gateway strips them before any vendor (`STANDARD_BODY_FIELDS`), and a provider may
     * reject them outright (Kimi Code 400s `metadata` with numeric values). Absent =
     * the gateway.
     */
    wire?: 'gateway' | 'openai';
    /** The provider chooses sampling per model, so no `temperature` is sent — Kimi K3
     *  accepts only `1` and 400s our default (the runtime registry's `providerSampling`). */
    providerSampling?: boolean;
    /** A provider reached directly (not the gateway): named in a silence error and its detail. Absent = the gateway. */
    destination?: {
        label: string;
        host: string;
    };
    /** Whether this request's per-request credential lookup settled - read when the request fails. */
    credentialState?: (attemptSignal?: AbortSignal) => 'resolved' | 'pending' | 'none';
}
/** OpenAI function-tool spec (the `tools[]` entries sent to the model). */
interface BrainToolSpec {
    type: 'function';
    function: {
        name: string;
        description: string;
        /** JSON Schema for the function arguments. */
        parameters: Record<string, unknown>;
    };
}
/** A plain-text content part (OpenAI multimodal `content[]` shape). */
interface TextContentPart {
    type: 'text';
    text: string;
}
/**
 * An image content part. `url` is either a `data:` URI (inlined, the common
 * case after client-side downscaling) or a short-lived signed public URL the
 * upstream provider can fetch. The gateway's shape router detects these and
 * floats a vision-capable model to the head of the cascade.
 */
interface ImageUrlContentPart {
    type: 'image_url';
    image_url: {
        url: string;
        detail?: 'low' | 'high' | 'auto';
    };
}
type ContentPart = TextContentPart | ImageUrlContentPart;
/** A message in the working array — supports assistant tool-call turns and tool results. */
interface ChatCompletionMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    /**
     * Plain string for the overwhelming majority of turns. A `ContentPart[]` is
     * used only when a user turn carries images (vision): the gateway forwards
     * the array untouched and routes to a vision model. Persistence stays
     * text-only — the rich array lives in the in-memory transcript so the model
     * keeps seeing the image on later turns.
     */
    content: string | ContentPart[];
    /** Present on an assistant turn that requested tools. */
    tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }>;
    /** Present on a tool-result message, linking it to the call. */
    tool_call_id?: string;
}
interface StreamHandlers {
    onTextDelta?(delta: string): void;
    /** Fired per streamed tool-call fragment; accumulate by `index`. */
    onToolCallDelta?(index: number, partial: {
        id?: string;
        name?: string;
        argsFragment?: string;
    }): void;
    onDone?(finishReason: string | null): void;
    /**
     * Fired ONCE, the moment the gateway names the model serving this stream (its
     * `x-builderforce-model` header, else the first chunk's `model`) — long before the
     * result exists. A caller whose stream is cut short (a user Stop aborts the fetch, so
     * no result is ever returned) otherwise never learns which model it was watching.
     */
    onModel?(model: string, account: string | undefined): void;
    /**
     * Fired before each wait when the gateway could not be reached at all (the connection
     * never opened — `retryOnConnectFailure`). The request is sent again after `delayMs`;
     * a caller uses this to show that the run is waiting on the network, not hung.
     */
    onConnectRetry?(attempt: number, delayMs: number, reason: string): void;
}
/**
 * Caller-supplied provenance for a completion, forwarded to the gateway as the
 * request body's `metadata` object. Every field is optional; the server treats a
 * missing `chatId` as "not chat traffic" and records nothing.
 */
interface CompletionMetadata {
    /** The SERVER Brain chat this completion is serving — the audit emit's switch. Never a
     *  local chat's view key (PRD 36): an unbound local chat leaves it out. */
    chatId?: number;
    /** The local chat's client id (a uuid), for diagnostics only — the server never
     *  resolves it to a chat. */
    clientChatId?: string;
    /** The chat's project, when it has one (scopes the audit row). */
    projectId?: number;
    /** Stable identifier of the answering agent. Defaults server-side to `brain-default`. */
    agentRef?: string;
    /** Display name of the answering agent. Defaults server-side to `Brain`. */
    agentName?: string;
    /** One user submit. Reused by every model iteration in that submit so guest
     * metering charges the user action once, not once per tool-loop completion. */
    guestTurnId?: string;
    /** Original text the user submitted. Internal specialist/tool prompts retain
     * this value so the gateway can verify the turn even when their prompts differ. */
    guestTurnInput?: string;
    /**
     * The conversation's MODE (0409) — `chat` or `work`. Carried so the usage row this
     * completion produces records WHICH KIND of turn spent the tokens. Without it,
     * spend can only be attributed to a chat id, and "what does execution actually
     * cost us versus conversation" has no answer.
     */
    mode?: string;
    /**
     * What memory did to THIS call (`memorySavings.ts`): prompt tokens compaction kept out
     * of it and tokens recall added to it. The gateway's usage writer stamps them on the
     * call's own usage row, so the savings ledger costs no request of its own.
     */
    memory?: {
        trimmedTokens: number;
        recallTokens: number;
    };
    /**
     * The run's PIPELINE route (`@builderforce/pipeline-route`) — `full` (plan → code →
     * verify) or `quick` (one coding pass) — and the router's score, decided once in the
     * run preamble. The gateway's usage writer promotes both to `llm_usage_log` columns;
     * the device's run usage ledger reads them off the same call. Absent when the run was
     * not routed (a host that sends no pipeline settings, a sub-agent).
     */
    pipelineRoute?: 'full' | 'quick';
    routeScore?: number;
    /**
     * How the PreFetch gate left this run's turn (`runStore/prefetchGate.ts`): `prefetch`
     * when deterministic facts rode into it, `llm` when nothing did. A turn the gate
     * ANSWERED made no call to carry it. Absent when the host has no gate.
     */
    gateRoute?: 'prefetch' | 'llm';
}
interface StreamChatOptions {
    messages: ChatCompletionMessage[];
    tools?: BrainToolSpec[];
    tool_choice?: 'auto' | 'none' | 'required';
    model?: string;
    /** Hard-pin {@link model}. Used by an explicit user pick so validation cannot
     * silently succeed on a gateway substitute. */
    modelStrict?: boolean;
    /** `auto` lets the gateway choose across every entitled route; `byo_pool`
     * constrains the turn to the tenant's ordered connected-account cascade. */
    routingMode?: 'auto' | 'byo_pool';
    /**
     * Models the caller has already proved unusable for this piece of work — emitted
     * as the body's `excludeModels` so the gateway routes AROUND them.
     *
     * A hint, never a veto: the gateway drops them from the cascade only while another
     * candidate remains, so this can never turn "a weak answer" into "no answer". Only
     * meaningful alongside auto-routing; with an explicit {@link StreamChatOptions.model}
     * the caller has already made the choice. Omitted when empty, so a request without
     * one stays byte-identical to a pre-feature request.
     */
    excludeModels?: string[];
    /**
     * Prompt-cache affinity key (OpenAI-style `prompt_cache_key`), e.g. `brain:<chatId>`,
     * so every turn of one conversation lands on the same provider cache. Forwarded
     * verbatim; absent ⇒ omitted from the body.
     */
    prompt_cache_key?: string;
    /**
     * What kind of call this is (plan/code/verify/explore/chat/utility), emitted as the
     * body's `role`. Under auto-routing the gateway orders the tenant's connected
     * accounts for it — analysis on the tenant's own order, code on the strongest
     * connected model. Omitted when unset, so the body stays byte-identical.
     */
    role?: string;
    /**
     * The launching canvas session's arc stage (idea/make/run/measure/reach), emitted as
     * the body's `arcStage` — a nudge on top of {@link StreamChatOptions.role} that the
     * gateway validates (`isArcStage`) and folds into its role/cost ordering. Omitted when
     * unset, so the body stays byte-identical.
     */
    arcStage?: string;
    temperature?: number;
    maxTokens?: number;
    /**
     * Vendor-neutral reasoning INTENT for this completion. Emitted on the wire as
     * `reasoning: { level }` and mapped SERVER-side against the model the gateway
     * actually resolved (`reasoningParamsForModel`), which knows which families
     * accept Anthropic `thinking` vs OpenAI `reasoning_effort` and drops it for the
     * rest. The client must never emit a vendor param itself: the model is often
     * `auto`, and an Anthropic-only `thinking` sent to an OpenAI-compatible coder
     * 400s the run. Omit (or `{ level: 'off' }`) to leave the body unchanged.
     */
    reasoning?: ReasoningIntent;
    /**
     * Caller identity for this completion, emitted verbatim as the wire body's
     * `metadata` object. The gateway reads it in `recordBrainChatModelActivity`
     * (`api/src/presentation/routes/llmRoutes.ts`) to write the audit-log row that
     * names WHICH MODEL served this turn — the default-agent twin of the addressed
     * agent's `BrainService.agentReply` emit. `chatId` is the key that switches the
     * emit on; without it the server no-ops.
     *
     * Only populated fields should be set: an EMPTY object (or `undefined`) omits
     * the `metadata` key from the body entirely, so anonymous/unsaved runs stay
     * byte-identical to a pre-feature request (same discipline as `reasoning`).
     */
    metadata?: CompletionMetadata;
    /**
     * The run's own chat key on THIS device — what a host groups the conversation's calls
     * by (the local-success label waits under it for the chat's verdict). Never on the
     * wire: on a local-first host it is a view key that must not leave the machine
     * (PRD 36), which is why it is not {@link CompletionMetadata.chatId}.
     */
    conversationKey?: number;
    /**
     * Silence that ends this request — no response headers, or zero bytes read, for this
     * long — defaulting to {@link STREAM_IDLE_MS}. A stalled upstream never settles, so
     * without this a dead turn hangs until the user presses Stop. A host sets its own
     * budget here (the canvas, an interactive surface on free models, waits less than an
     * IDE run whose reasoning model may think for minutes); the RULE is this one.
     */
    idleTimeoutMs?: number;
    signal?: AbortSignal;
    /** Auth + endpoint. Injected by BrainProvider; callers via the hook never set this directly. */
    transport: BrainTransport;
}
/** A fully-stitched tool call assembled from streamed deltas. */
interface AssembledToolCall {
    id: string;
    name: string;
    /** Raw JSON argument string (parse with `JSON.parse`). */
    args: string;
}
/**
 * Token accounting for one completion, as reported by the gateway's final
 * `usage` chunk (OpenAI shape). Absent when the upstream didn't emit usage
 * (some providers don't). Surfaced so the triage/diagnostics layer can tell a
 * CONTEXT-EXHAUSTION death (prompt tokens climbing turn over turn until the
 * model 413s / truncates) apart from a model-DEGRADATION death (an Evermind/SSM
 * turn returning empty or garbage while token counts stay low).
 */
interface CompletionUsage {
    prompt?: number;
    completion?: number;
    total?: number;
    /** Prompt tokens served from the vendor's prompt cache — INCLUDED in `prompt`. */
    cacheRead?: number;
    /** Prompt tokens written to the vendor's prompt cache — INCLUDED in `prompt`. */
    cacheCreation?: number;
}
/**
 * What the vendor's RAW response carried, counted by the gateway before it translated
 * the turn (the `x_builderforce_upstream` field the Responses vendors — Grok, Codex —
 * put on the finishing chunk). It answers the first question of any "the model won't
 * call tools" report: did the vendor return a structured function call at all?
 */
interface UpstreamTurnEvidence {
    /** Output items by type, as the vendor returned them. */
    items: Record<string, number>;
    /** Structured function calls the vendor returned. */
    functionCalls: number;
    /** How many of those the gateway rebuilt from the final frame. */
    recovered: number;
}
/** One model the gateway tried and left before the one that answered. */
interface GatewayFailover {
    model: string;
    vendor: string;
    code: number;
    kind?: string;
}
/**
 * How the gateway routed this turn — its terminal `_builderforce` frame
 * (`api/.../streamDiagnostics.ts`). Without it a run could only see the model that
 * answered, never the coders it was seeded with or the ones that refused: chat #6 ran
 * hundreds of `code` turns on MiniMax Flash with Grok and Kimi connected, and nothing
 * on the client could say why.
 */
interface GatewayRouting {
    /** Every model tried and left, in order. */
    failovers: GatewayFailover[];
    /** The head of the candidate chain the gateway walked. */
    candidates?: string[];
    traceId?: string;
}
interface StreamChatResult {
    /** How the gateway routed the turn — absent off the gateway or on an older one. */
    gateway?: GatewayRouting;
    /**
     * What the vendor's raw response carried before translation — see
     * {@link UpstreamTurnEvidence}. Absent for vendors that do not report it.
     */
    upstream?: UpstreamTurnEvidence;
    text: string;
    toolCalls: AssembledToolCall[];
    finishReason: string | null;
    /**
     * The model the GATEWAY actually used for this completion — which can differ
     * from the requested `model` (empty/absent means the gateway auto-selected
     * from its pool, and failover may have swapped upstreams mid-cascade). Sourced
     * from the `x-builderforce-model` response header when readable, else from the
     * `model` field the OpenAI-shaped stream chunks carry. Surfaced so callers can
     * record which LLM (or which `evermind/…` artifact) produced a turn.
     */
    resolvedModel?: string;
    /** Provider/vendor that actually served the completion, reported independently
     * from the model id so diagnostics never have to guess from naming conventions. */
    resolvedVendor?: string;
    /**
     * Which account served this turn, from the gateway's `x-builderforce-account`
     * response header: `own` (the tenant's connected frontier account), `shared`
     * (the shared pool, no connected account), or `shared_byo_unused` (the shared
     * pool despite a connected account existing). Undefined when the gateway didn't
     * report one (older gateway, or the header wasn't CORS-exposed). Feeds the
     * per-reply provenance chip so a successful turn shows whose account ran it.
     */
    account?: string;
    /**
     * Providers the tenant CONNECTED but that the gateway could NOT resolve for this
     * turn (from `x-builderforce-byo-unresolved`, comma-separated) — e.g. a connected
     * Claude subscription whose token expired, so the run silently fell to the shared
     * pool instead of the tenant's own Opus. Undefined/absent when every connected
     * provider resolved. Surfaced in triage so a "should have used my BYO account" run
     * is self-explaining instead of looking like "nothing connected".
     */
    byoUnresolved?: string;
    /**
     * BYO providers that hit a usage/capacity cap this turn (from
     * `x-builderforce-provider-cap`, comma-separated) — e.g. the tenant's Anthropic
     * key hit its monthly spend limit, or Meta MUSE quota was exhausted. Only set
     * when the tenant's OWN key hit the cap (never the shared operator pool). The
     * client should prompt the user to manage their provider keys in settings.
     */
    providerCap?: string;
    /** Token usage for this completion, when the gateway reported it. */
    usage?: CompletionUsage;
    /**
     * Set only by a LOCAL-FIRST stream (`localFirstTransport.ts`): every attempt this
     * completion made, in order — the on-device model(s) tried and whichever served. The
     * run loop turns a fallback into an `llm.local_fallback` step. Summaries only: no
     * endpoint, no credential.
     */
    localFirst?: LocalFirstAttemptSummary[];
}
/**
 * The stream broke AFTER the gateway committed to a model: an in-band `error` frame, or
 * the connection dropping mid-answer. The gateway can only fail over before it sends
 * headers, so from here the caller is the only one who can route around the model —
 * `model` is what it needs to do that (`excludeModels` on a retry). Before this, both
 * cases ended the stream as a clean, empty `stop`, and the agent run simply ended.
 */
declare class StreamInterruptedError extends Error {
    readonly model: string | undefined;
    /** What the failed request looked like (destination, phase, elapsed, size) - for logs and triage. */
    readonly detail?: StreamFailureDetail;
    /**
     * The model was PICKED (named and held strictly) and stayed silent or dropped the connection - the only interruption
     * where "choose another model" is the right offer. Never set for an in-band provider error.
     */
    readonly pinned: boolean;
    constructor(message: string, model: string | undefined, detail?: StreamFailureDetail, options?: {
        pinned?: boolean;
    });
}
/**
 * A transport-level failure: the fetch itself threw (network error, DNS failure,
 * connection refused, timeout before response). This is distinct from the gateway
 * returning an HTTP error — that reaches us as a non-OK Response and maps through
 * `transport.mapError`. This catches the case where NO response was ever received.
 *
 * The caller retries these the same way as `StreamInterruptedError`: under auto-routing,
 * the turn is retried on another connected model. The model is unknown because the
 * failure happened BEFORE the gateway could commit to one.
 */
declare class TransportError extends Error {
    readonly model: string | undefined;
    /**
     * The gateway could not be reached at all, and stayed unreachable through every
     * backoff retry. Another model cannot help — none was ever asked — so the caller
     * reports the outage instead of retrying.
     */
    readonly unreachable: boolean;
    /** As {@link StreamInterruptedError.pinned}. */
    readonly pinned: boolean;
    constructor(message: string, model?: string | undefined, options?: {
        cause?: unknown;
        unreachable?: boolean;
        pinned?: boolean;
    });
}
/**
 * The model fell into a decoding loop — the same block of prose, verbatim, over and over
 * (`repetitionLoop.ts`). The stream is cut the moment it is seen instead of running to the
 * output ceiling while the reader watches one sentence repeat.
 *
 * An interruption like any other: the model is still answering, just uselessly, and only
 * the caller can route around it — so a caller that retries interrupted turns on another
 * model (the Brain run) does so here without knowing the difference. `kept` is what the
 * model said before it looped, for a caller that would rather show that than retry.
 */
declare class RepetitionLoopError extends StreamInterruptedError {
    readonly kept: string;
    readonly block: string;
    readonly copies: number;
    constructor(loop: {
        block: string;
        copies: number;
        kept: string;
    }, model: string | undefined);
}
/**
 * Stream a chat completion. Resolves once the stream ends with the stitched
 * final text and any tool calls the model requested.
 */
declare function streamChatCompletion(opts: StreamChatOptions, handlers?: StreamHandlers): Promise<StreamChatResult>;

interface AskUserOption {
    label: string;
    description?: string;
    /** Mark the option the model would advise / the default pick — hosts in
     *  auto-answer mode pick the first recommended option when the user isn't
     *  asked. Optional; ignored by readers that don't support it. */
    recommended?: boolean;
}
interface AskUserPayload {
    question: string;
    options: AskUserOption[];
    /** Allow more than one option to be chosen (checkboxes + submit) instead of a
     *  single click. */
    multiSelect?: boolean;
}
/** The tool name every surface advertises this question under. */
declare const ASK_USER_TOOL = "ask_user";
/**
 * The `ask_user` tool as the model is shown it.
 *
 * NOT a platform action — an autonomous cloud agent has no live user to ask — so it
 * is injected by the CONVERSATIONAL loops only (the api's addressed-agent reply and
 * the Brain run store the editor/web chat drives) and intercepted as a terminal turn.
 */
interface AskUserToolSpec {
    type: "function";
    function: {
        name: string;
        description: string;
        /** JSON Schema for the arguments. */
        parameters: Record<string, unknown>;
    };
}
declare const ASK_USER_TOOL_SPEC: AskUserToolSpec;
/**
 * Coerce anything — raw tool arguments, parsed JSON off a fenced block — into a
 * renderable payload, or null when it isn't one.
 *
 * The threshold is deliberate and shared: a card is only meaningful with a prompt
 * AND at least two choices, so a producer that cannot clear it falls back to prose
 * (where the question at least still reads) instead of emitting a block the
 * consumer would decline.
 */
declare function coerceAskUserPayload(raw: unknown): AskUserPayload | null;
/**
 * Serialize a payload into the canonical fenced block. Shared so the producer and
 * {@link parseAskUser} can never drift on the format.
 */
declare function serializeAskUser(payload: AskUserPayload): string;
/**
 * The producer's ONE call: raw `ask_user` tool arguments → the block to reply with,
 * or null when the arguments don't make a card (the caller then keeps its prose).
 */
declare function askUserBlock(args: unknown): string | null;
/** Extract the payload from an assistant message, or null if none/invalid. */
declare function parseAskUser(text: string): AskUserPayload | null;
/** Remove the raw block so the message's prose reads cleanly beside the rendered
 *  card. Collapses the whitespace the removed block leaves behind. */
declare function stripAskUser(text: string): string;
/** The DOM id of a rendered question card. ONE convention, shared by the transcript
 *  that stamps it and any host that scrolls to it — so the two can never drift. */
declare function askUserAnchorId(messageId: number): string;
/** The minimal message shape {@link selectPendingAskUser} needs — structural on
 *  purpose, so this module stays free of any transcript import. */
interface AskUserMessageLike {
    id: number;
    role: string;
    content: string;
}
/** An unanswered question and the message carrying it. */
interface PendingAskUser {
    payload: AskUserPayload;
    /** The assistant message the question rides in (lets a host reveal its card). */
    messageId: number;
}
/**
 * The question the conversation is currently BLOCKED on, or null when there is none.
 * Walks back from the newest turn: the last assistant `ask-user` block wins, but a
 * user turn after it means the question was already answered (answering posts the
 * choice as the next user turn), so nothing is pending.
 *
 * Shared so a host never re-derives "is there an open question" — the same predicate
 * drives the pinned banner and any host-side pending affordance.
 */
declare function selectPendingAskUser(messages: readonly AskUserMessageLike[]): PendingAskUser | null;

/**
 * The run-outcome write-back's TELEMETRY half — the PRD 35 §8.2 uniform outcome row.
 *
 * Every entry point's run ends in one row (`@builderforce/agent-run`'s `RunOutcomeRow`).
 * A client posts it to `POST /llm/v1/run-outcome` beside the routing fields, under the
 * SAME field names, so an adapter spreads the row into the request and nothing is
 * renamed on the way. {@link parseRunOutcomeTelemetry} validates each field and drops
 * the ones that do not hold — a malformed counter is a missing fact, never a rejected
 * report. Pure and dependency-free, like the rest of this package.
 */
/** Every entry point a run can be labelled with (PRD 35 §3.2) — the ONE list. A telemetry
 *  label only: nothing branches on it for behaviour. */
declare const ALL_ENTRY_POINTS: readonly ["vscode", "web", "rovr", "canvas", "on-prem", "cloud"];
type EntryPoint = (typeof ALL_ENTRY_POINTS)[number];
/** The entry points a client may label its run with. `cloud` is scored server-side and
 *  never accepted off the wire (a client claiming it would double-count). */
type ClientEntryPoint = Exclude<EntryPoint, 'cloud'>;
/** The declared verify phase's result. */
type RunVerifyResult = 'passed' | 'failed' | 'not-run';
/** The §8.2 fields, as a client sends them and as the scorer records them. */
interface RunOutcomeTelemetry {
    entryPoint?: ClientEntryPoint;
    toolCalls?: number;
    toolErrors?: number;
    tokens?: number;
    cacheReadTokens?: number;
    compactions?: number;
    stallRecoveries?: number;
    escalations?: number;
    verify?: RunVerifyResult;
    /** The step the first spawn happened on; `null` = the run spawned nothing. */
    firstSpawnTurn?: number | null;
    coveredReadStubs?: number;
    shellFileReads?: number;
    repoErrors?: number;
    contextPackTokens?: number;
    /** `ok` | `refreshed` | `degraded:<reason>`, at most {@link MODEL_PREFLIGHT_MAX} chars. */
    modelPreflight?: string;
    unkeptReadyClaims?: number;
    /** The A3 progress trips, by signal. */
    progressTrips?: Record<string, number>;
    /**
     * Set on a SUB-AGENT's row: the `clientRunId` its owner's row was reported under, so a child is
     * one more row of the owner's tree and never a second run of it. The row's OWN run id is the
     * request's `clientRunId` (the idempotency key), so only the parent needs a field.
     */
    parentRunId?: string;
}

/**
 * Learned Model Routing (PRD 13) — the RUN-OUTCOME write-back contract.
 *
 * `POST /llm/v1/run-outcome` is the door a NON-cloud run (on-prem host, IDE-native,
 * external SDK) uses to teach the same routing table that cloud runs teach. Both
 * halves of that door live here so they can never drift:
 *
 *   • the CLIENT builds a {@link RunOutcomeRequest} — it is the only place field
 *     names are spelled, so an on-prem host cannot invent `status` where the route
 *     reads `terminalStatus`;
 *   • the ROUTE hands the raw JSON body to {@link parseRunOutcomeRequest}, which
 *     validates and normalizes it into the {@link NormalizedRunOutcome} the scorer
 *     records.
 *
 * Pure and dependency-free: no env, no fetch, no DB. The transport (base URL,
 * bearer, retries) belongs to whoever calls it.
 *
 * The body also carries the PRD 35 §8.2 uniform outcome row (`runOutcomeTelemetry.ts`),
 * under the row's own field names.
 */

/** How a run ended. Non-'completed' scores 0 (see the api's `computeOutcomeScore`). */
type TerminalStatus = 'completed' | 'failed' | 'cancelled';
/** Where the run executed. Anything non-'cloud' has no `executions` row. */
type OutcomeSource = 'cloud' | 'onprem' | 'ide' | 'external' | 'canvas';
/**
 * The JSON body a client POSTs. `terminalStatus` wins; `success` is a friendly
 * boolean alias for callers that only know "did it work".
 */
interface RunOutcomeRequest extends RunOutcomeTelemetry {
    /** Idempotency key — ONE outcome per id. The client's own execution/run id. */
    clientRunId: string;
    /** The model the run actually used (what it locked onto, not what it asked for). */
    model: string;
    source?: OutcomeSource;
    terminalStatus?: TerminalStatus;
    /** Alias for `terminalStatus`: true → completed, false → failed. */
    success?: boolean;
    actionType?: string;
    /** The model ROLE `model` played in this run (plan · code · verify · explore · chat ·
     *  utility) — lets the router rank per role. The route validates it; unknown → dropped. */
    role?: string;
    projectId?: number | null;
    taskId?: number | null;
    merged?: boolean;
    ciGreen?: boolean;
    degraded?: boolean;
    steps?: number;
    costMc?: number;
    approved?: boolean;
    /** The run died on a provider rate limit — an AVAILABILITY signal that demotes the
     *  model without teaching the router it is low-quality. */
    rateLimited?: boolean;
    /**
     * Whether this outcome teaches the routing table. Default true. A run that is not
     * evidence about CODING models (a Creation Canvas turn) reports with `false`: its
     * telemetry row is recorded, and never folded into — or rebuilt into — the ranking.
     */
    routingSignal?: boolean;
    /**
     * The run failed because the TENANT ran out of quota/budget. Stored, and never taught to routing: it
     * says nothing about the model. The reporter that knows says so; absent = it did not.
     */
    quotaExhausted?: boolean;
}

/**
 * What a settled work run reports to learned routing — so a run in the editor teaches
 * the router the way a cloud run does: a change graded on whether it shipped, and a run
 * asked for a change that delivered none graded as the failure it was.
 *
 * Before this, only cloud runs were ever scored: an IDE run changed code, shipped it or
 * failed, and the router never heard. Now a run that changed code reports how its CODER
 * did — the model that made the edits (after an analysis→code hand-off, the coding model;
 * under a pin, the pinned one) — under the `code` role, which is exactly the evidence the
 * gateway reads when it picks the coder for the next run.
 *
 * Field names are the `POST /llm/v1/run-outcome` wire contract (`RunOutcomeRequest` in
 * `@builderforce/learned-routing`); the host owns the transport. Pure.
 */

interface BrainRunOutcome extends RunOutcomeTelemetry {
    /** Idempotency key — one outcome per run. */
    clientRunId: string;
    /** The model that made this run's code changes. */
    model: string;
    role: 'code';
    source: 'ide';
    terminalStatus: 'completed' | 'failed';
    /** The change landed on the base branch (the run's own push). */
    merged: boolean;
    /** Completed model turns — the efficiency half of the score. */
    steps: number;
    /**
     * What the run cost in millicents. Present ONLY as 0, and only when every completed turn was served by a
     * model on this machine (the hybrid local tier): that run was genuinely free and stays "priced at 0". An
     * unknown cost is ABSENT - never 0 - so a gateway or BYO run is not mistaken for a free one.
     */
    costMc?: 0;
    projectId?: number;
    /** The run failed because the TENANT ran out of quota/budget (the platform's one reading of that failure,
     *  `isTenantBudgetFailure`): stored, never taught to routing - it says nothing about the model. Present only when true. */
    quotaExhausted?: true;
    /** The run died on a provider rate limit / capacity ceiling (`isRateLimitFailure`, which already excludes a tenant
     *  budget): an AVAILABILITY fact that demotes the model without calling it a bad coder. Present only when true. */
    rateLimited?: true;
}

/**
 * STOP HOOKS — a host's say over whether a run may end.
 *
 * The loop's own end-of-run gates (`selfReviewShip.ts`, `previewReview.ts`, …) are the
 * platform's contracts. This is the seam for the WORKSPACE's: a host (the VS Code
 * extension reads them from a committed `.builderforce/hooks.json`) can hold a run that
 * is about to settle and hand it one more instruction — "update README and DONE with what
 * you completed", or "the lint you were told to keep green failed, here is its output".
 *
 * The loop owns only the BOUND and the re-prompt; what the hook says is the host's. Asked
 * every time the run is about to end, so a hook that re-checks (a failing command) gets
 * to see the run's fix — but never more than {@link MAX_STOP_HOOK_ROUNDS} times per run:
 * a command that can never pass must not keep a run alive on the tenant's money.
 *
 * Runs BEFORE the ship gate on purpose: whatever a stop hook asks for (docs, a changelog
 * line, a formatter's fixes) is part of the change, so it lands in the same commit
 * instead of being left dirty after the push.
 */
/** What the host is told about a run that is about to end. */
interface RunStopInput {
    /** The run changed code in this turn (or a resumed turn). */
    codeChanged: boolean;
    /** Workspace-relative files the run touched, in order. */
    touchedFiles: readonly string[];
    /** The user's request that started the run. */
    requestText: string;
    /** How many stop-hook re-prompts this run has already had. */
    round: number;
}
/**
 * A host's stop hook: a non-empty string holds the run and becomes its next user turn;
 * null / undefined / '' lets it settle.
 */
type RunStopHook = (input: RunStopInput) => Promise<string | null | undefined>;
/** Re-prompts one run can receive from stop hooks before it is allowed to settle. */
declare const MAX_STOP_HOOK_ROUNDS = 4;
/**
 * Ask the host's stop hook whether the run may end. Returns the nudge to re-prompt with,
 * or null to let it settle. Best-effort: a throwing hook never fails or holds the run.
 */
declare function askStopHook(hook: RunStopHook | undefined, input: RunStopInput): Promise<string | null>;

/**
 * A run with an OWNER — what makes a sub-agent a sub-agent, and nothing else.
 *
 * A delegated child is not a second kind of loop. It is an ordinary run of THIS store —
 * the same tools, gates, ticket backstop, failure-streak breaker and persistence as the
 * run that spawned it — given its own run key (its own transcript, Stop and approval
 * prompt) and this pointer back to who spawned it. Everything a child does differently
 * follows from the pointer:
 *
 *   • it lives in its OWNER'S conversation: every message it persists goes to the root
 *     chat, attributed to the child (`authoredBy`) and marked as whose sub-agent it is
 *     (`subagentOf`), so the chat reads as Owner and Agent (name), never as one voice;
 *   • its messages are progress inside someone else's work, so they are marked mid-turn
 *     (Evermind does not learn a child's report as the chat's answer);
 *   • it can itself spawn children — the pointer nests, which is all recursion needs.
 */

/** Who a child run is, and whose. */
interface RunLineage {
    /** The server chat the whole tree persists into — the top-level owner's chat. */
    rootChatId: number;
    /** The run key of the run that spawned this one (the root chat id for a top-level owner). */
    ownerKey: number;
    /** The owner's display name, as the chat shows it. */
    ownerName: string;
    /** Short handle the owner and the person address this child by (`a1`, `a2`, …). */
    handle: string;
    /** A few words naming the slice. */
    label: string;
    /** Who the child IS in the chat — a workspace agent it runs as, or a named helper. */
    agent: {
        ref: string;
        name: string;
    };
    /** 1 for a child of a top-level run, 2 for a grandchild, … */
    depth: number;
}
/** The server chat a run's rows are saved to: its owner's for a sub-agent, its own otherwise. THE one place that says so. */
declare const savedChatOf: (runKey: number, lineage?: RunLineage | null) => number;
/** Metadata key under which a child's message names its owner. */
declare const SUBAGENT_OF_META_KEY = "subagentOf";
/** What a persisted message says about the run that wrote it. */
interface SubagentOrigin {
    handle: string;
    owner: string;
    label: string;
}
/** The owner a persisted message was written for, or null for anything not a child's. */
declare function parseSubagentOrigin(msg: {
    metadata?: string | null;
}): SubagentOrigin | null;

/**
 * WHICH TOOLS FILE A TICKET on this surface — the one place that knows.
 *
 * Two vocabularies exist for the same act:
 *
 *   • SERVER (web, cloud): `builtin_tasks_create` makes a task the account owns and returns
 *     a NUMERIC id, linked to the run's chat in the same call (the host stamps the chat; see
 *     `CHAT_STAMPED_CREATE_TOOLS`); the board's resource scoping (`builtin_kanban_*`)
 *     addresses that numeric id.
 *   • LOCAL (the editor): `ticket-create` writes the DEVICE store and returns a LOCAL id (a
 *     UUID). It links the creating chat locally in the same transaction and syncs in the
 *     background, and the `builtin_kanban_*` tools (which take server ids) do not apply to it
 *     until it has synced. The editor's catalog does not even advertise the server twins.
 *
 * Neither vocabulary has a link step after a create any more.
 *
 * Every prompt, hand-off and triage check that names a create tool reads this, so none of
 * them keeps its own list of names. A surface that cannot say what it advertises gets the
 * SERVER vocabulary, which is what every surface used before the editor filed locally.
 */
declare const SERVER_TICKET_CREATE_TOOL = "builtin_tasks_create";
declare const LOCAL_TICKET_CREATE_TOOL = "ticket-create";
interface TicketToolVocabulary {
    /** The tool that creates a ticket here, or undefined when the catalog has none. */
    readonly createTool: string | undefined;
    /** The create tool is the device-local `ticket-create` (ids are local UUIDs). */
    readonly local: boolean;
    /** The `builtin_kanban_*` resource-scoping tools apply to a ticket this tool creates. */
    readonly kanbanScoping: boolean;
    /** The name a prompt should give for the create tool (the server's when none is advertised). */
    readonly createName: string;
}
/** The vocabulary of surfaces that file through the account's tools. */
declare const SERVER_TICKET_TOOLS: TicketToolVocabulary;
/** The vocabulary for the advertised tool names; the server's when `toolNames` is not given. */
declare function ticketToolVocabulary(toolNames?: Iterable<string>): TicketToolVocabulary;

/**
 * Chat MODE — "am I being asked a question, or being asked to get something done?"
 *
 * Two modes, one per conversation:
 *
 *   • `chat` — CONVERSATIONAL. The Brain reads, reasons and answers. It may look
 *     anything up, but it does not mint board work, staff it, or start runs off
 *     its own back. This is the default and the surface's resting state.
 *
 *   • `work`  — EXECUTIONAL. The Brain turns what it concludes into real work: it
 *     creates the ticket, scopes the resources, links it to the conversation,
 *     advances its status, and DISPATCHES an agent to run it. The conversation is
 *     the front end of an execution, not a discussion about one.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
 * The work-linking directive ({@link chatWorkLinkingDirective}) used to ride EVERY
 * run unconditionally — so "what does this error mean?" was answered by a model that
 * had also been instructed to open, staff and status a ticket about it. There was no
 * way to just ask a question, and no way to tell an execution apart from a chat after
 * the fact. Mode is the discriminator for both: it gates the directive at runtime and
 * it is recorded on the conversation, so usage can finally be read as
 * "conversations vs executions" rather than one undifferentiated pile.
 *
 * The value is persisted on the conversation (`brain_chats.mode`, `creation_sessions.mode`,
 * migration 0409) rather than in the browser, so the choice follows the conversation
 * across surfaces and devices — the same reasoning as `capability` (0345).
 *
 * Kept framework-free (pure strings + unions) so it is safe in every bundle: the web
 * Brain, the VS Code webview, and the shared agent loop all import from here.
 */

/** The modes a conversation can be in. Order is display order. */
declare const CHAT_MODES: readonly ["chat", "work"];
type ChatMode = (typeof CHAT_MODES)[number];
/**
 * The mode a NEW conversation opens in.
 *
 * Work, because that is what people come here to do: the measured reality is that a
 * conversation which cannot dispatch produces a plan and stops, and the user is then
 * asked to find a control they did not know existed to get the work started. Opening
 * in Work makes the product's actual promise the resting state; a user who only wants
 * to ask a question flips one switch in the composer's `/` menu.
 *
 * This is NOT the coercion fallback — see {@link RESTING_CHAT_MODE}. The two were one
 * constant, which meant "what does a new chat start as" and "what does an unreadable
 * stored value mean" could not be answered differently, and changing one silently
 * re-armed every legacy row that had never stored a mode at all.
 */
declare const NEW_CHAT_MODE: ChatMode;
/**
 * What an unset or unrecognised stored value resolves to: a conversation. A row that
 * never recorded a mode (or a client ahead of the server) must not be granted execution
 * authority by a default it never opted into.
 */
declare const RESTING_CHAT_MODE: ChatMode;
/**
 * The glyph for a mode. Decorative — the label always carries the meaning — but it
 * lives HERE, beside the mode vocabulary, because both composers render it: the web
 * `/` menu and the VS Code webview's `/` menu. A second copy in one host is how the
 * two surfaces end up showing a different icon for the same conversation state.
 */
declare const CHAT_MODE_ICON: Readonly<Record<ChatMode, string>>;
/** True for a value that is one of the known modes. */
declare function isChatMode(value: unknown): value is ChatMode;
/**
 * Coerce an inbound/stored value to a mode, falling back to {@link RESTING_CHAT_MODE}.
 * Tolerant by design: an unknown value (an older row, a client ahead of the server)
 * resolves to a conversation rather than silently granting execution authority.
 */
declare function normalizeChatMode(value: unknown): ChatMode;
/**
 * The system-prompt block for CHAT mode.
 *
 * Deliberately a positive instruction rather than only a prohibition: a model told
 * merely "do not create tickets" tends to hedge and offer to create one every turn,
 * which is the same interruption in a politer costume. This tells it what its job IS
 * — answer the question — and makes the ONE escape hatch explicit (the user asking
 * outright), so the mode is a default rather than a cage.
 */
declare function chatConversationDirective(): string;
/**
 * One agent invited into the chat, as the Work directive names it.
 *
 * Deliberately the three facts a dispatch decision needs and nothing else: the NAME the
 * human knows them by, the REF `chats.dispatch_agent` takes, and the ROLE that says
 * which work is theirs. Kept structural (no import from the chat-tickets view model) so
 * this module stays framework-free and every host can satisfy it from whatever it
 * already holds.
 */
interface ChatRosterAgent {
    ref: string;
    name: string;
    role?: string;
}
/**
 * The agent half of a chat's addressable participants, as the Work directive wants it.
 *
 * Every host that renders a recipient picker or an @-mention typeahead already holds
 * the participant list (agents AND humans, each with a ref and a display name). Rather
 * than have each of them fetch the roster a SECOND time to tell the run about it — two
 * reads of one endpoint on every chat open — they derive it from what they have. One
 * mapping, here, so the agents the user can @-mention are exactly the agents the run is
 * told it may dispatch to.
 *
 * Typed structurally (`{ kind, ref, name }`) rather than against `DirectedRecipient` so
 * this module keeps its no-dependency posture; the shapes are checked by the call sites.
 */
declare function chatRosterFromParticipants(participants: readonly {
    kind: string;
    ref: string;
    name: string;
}[] | undefined): ChatRosterAgent[];
/** What the Work directive needs to know about the surface and the chat it rides. */
interface ChatWorkDirectiveOptions {
    /** Does this run hold the workspace file tools (see `./localWorkspaceTools`)? */
    canEditHere?: boolean;
    /** Does the catalog carry `spawn_agent`, so persona delegation may be named? */
    canDelegate?: boolean;
    /** Does the catalog carry `spawn_agents`, so fan-out delegation may be named? */
    canFanOut?: boolean;
    /** The agents invited into this chat. Non-empty INVERTS the do-it-here ordering. */
    roster?: readonly ChatRosterAgent[];
    /** Which tools file a ticket on this surface (`ticketToolVocabulary`). Absent ⇒ the account's. */
    ticketTools?: TicketToolVocabulary;
}
/**
 * The system-prompt block for WORK mode: the existing chat⇄work linking contract
 * PLUS the dispatch obligation that makes the mode mean execution rather than
 * paperwork.
 *
 * The dispatch half exists because creating a well-staffed ticket and stopping is
 * indistinguishable, from the user's side, from doing nothing: the measured reality
 * is that tickets opened and never dispatched sit in backlog indefinitely. So the
 * mode's closing obligation is to REPORT the dispatch verdict truthfully — `tasks.create`
 * and `tasks.update` already return `autoRun: { dispatched, reason, detail }`, and
 * `chats.dispatch_agent` starts a run directly when autonomy declined.
 *
 * ── WHY `canEditHere` EXISTS ───────────────────────────────────────────
 * "Finish by dispatching" is the right obligation on the web Brain, which has no file
 * tools and can only get code changed by asking someone else to change it. On the IDE
 * surface it is not: that session HAS the workspace, and read as an unconditional rule
 * it sends the agent to open a ticket and hire a remote builder for a one-line fix it
 * was already looking at — measured, on a small UI defect, as a whole turn spent
 * fighting a dispatch with the file untouched at the end of it.
 *
 * So the ordering is stated where the surface actually differs, driven by whether this
 * run was given code-change tools ({@link ./localWorkspaceTools}'s `CODE_CHANGE_TOOLS`,
 * which is the same set the "a code change is always tied to a ticket" backstop reads).
 * Doing the work still ends in a ticket — recording is not optional, it is just not a
 * substitute for doing.
 *
 * ── WHY `roster` OVERRIDES THAT ORDERING ─────────────────────────────────────────
 * `canEditHere` answers "could this session make the change", which is not the same
 * question as "whose change is it". A chat with agents INVITED INTO IT has already
 * answered the second one: a human opened the Agents panel and put Bob, John and the
 * Manager in this conversation, which is the platform's only way of saying "these are
 * the people I want on this work". Read without that fact, the do-it-here rule
 * quietly overrides the staffing the human just did — measured on chat #103, where
 * three invited agents watched an IDE session make every code change itself and the
 * run's staffing summary read `1 ticket filed · 0 dispatched`, with ZERO dispatch
 * attempts: the model never asked, because nothing had told it there was anyone to ask.
 *
 * Two things follow, and they are separate. First, the roster is NAMED in the prompt,
 * because "pick a capable agent" costs a discovery tool call that the do-it-here rule
 * gives the model no reason to spend — the agents were in the chat and invisible to the
 * run. Second, when the roster is non-empty the ordering INVERTS: the invited agents own
 * the work and this session dispatches to them. The do-it-here rule survives only for a
 * chat nobody has staffed, which is the case it was written for.
 *
 * Tool names here are the ADVERTISED (`builtin_*`) names the model actually sees on
 * the gateway relay — never the catalog ids, which appear nowhere in its tool list.
 * The roster is rendered as names AND refs because the model reads the name and
 * `builtin_chats_dispatch_agent` takes the ref.
 */
declare function chatWorkDirective(chatId: number | null, opts?: ChatWorkDirectiveOptions): string;
/**
 * The system-prompt block for a mode. This is the ONE place a mode becomes model-facing
 * behaviour, so the two surfaces (web Brain, VS Code webview) and the shared agent loop
 * cannot drift on what a mode means.
 */
declare function chatModeDirective(mode: ChatMode, chatId: number | null, opts?: ChatWorkDirectiveOptions): string;

/**
 * Evermind memory hooks for the Brain run loop — the client half of "recall +
 * learn + reconcile, visible in the chat".
 *
 * A project-scoped Brain conversation now (a) RECALLS the project's learned
 * memories before answering and injects them into the prompt, and (b) surfaces
 * that its turn will be CONTRIBUTED back (and which recalled memories it
 * RECONCILES) — each as its own timeline step, the same way a Claude Code
 * `memory_recall` shows as a step. The heavy lifting (the corpus + the ranker)
 * lives server-side; the host injects a single {@link EvermindRunHooks.recall}
 * callback bound to the active chat's project, and the run loop
 * ({@link ./brainRunStore}) turns the result into the injected memory block plus
 * the recall/learn/reconcile trace events.
 *
 * The recall CONTRACT, the memory block and the reconcile rule are the Evermind
 * module's (`@seanhogg/builderforce-memory/evermind`); what lives here is the Brain's
 * own port — the hooks a host injects and the one server-backed implementation of them.
 */

/**
 * A memory-first answer that lets the run loop SKIP the paid model entirely — either
 * an exact-repeat Q&A cache hit or the project's Evermind SSM. Returned by the opt-in
 * {@link EvermindRunHooks.answer} hook; null means "memory can't answer, run the LLM".
 */
interface MemoryFirstAnswer {
    /** The answer text to adopt as the assistant turn. */
    text: string;
    /** Where it came from — drives the "no LLM" provenance/step. */
    source: 'qa-cache' | 'evermind';
    /** Evermind head version, when `source === 'evermind'`. */
    evermindVersion?: number;
    /**
     * WHICH Evermind answered (project id), when `source === 'evermind'`. A project can
     * target several heads (its own plus the IDE builds grouped under it), so without
     * this the timeline could not say which one served — and a chat whose OWN project
     * reports inference OFF could still be answered by a sibling head with no way to
     * tell. Recorded on the trace step so a memory hit is triageable.
     */
    evermindProjectId?: number;
}
/**
 * The hooks a host injects into the run loop. Bound to the active chat's project.
 * `recall` grounds the answer (RAG); the OPTIONAL `answer`/`cacheAnswer` pair adds the
 * memory-first short-circuit — answer from the project's own memory (Q&A cache or
 * Evermind) BEFORE spending a model call, and remember a fresh (question→answer) pair
 * so the next exact repeat is free. All return null / no-op when the chat isn't
 * project-scoped or memory is unavailable, so the loop simply falls through to the LLM.
 */
/** Where a run is driven from — the usage ledger's `surface` vocabulary, declared once. */
type MemorySurface = UsageSurface;
/** How a memory-first answer is asked for. */
interface MemoryAnswerOptions {
    /** Whether THIS run can call tools — see {@link EvermindRunHooks.answer}. */
    toolsAvailable: boolean;
    /** The model the run would otherwise call, for pricing a saving. */
    model?: string;
    /** A verification read (the compaction recall probe): answered, but no saving is
     *  recorded, because no model call was ever going to happen. */
    probe?: boolean;
}
/** What producing a cached answer cost — recorded with it (`project_facts.origin_*`). */
interface AnswerOriginCost {
    model: string;
    promptTokens: number;
    completionTokens: number;
}
/**
 * A file a cached answer was about. `contentHash` when the host knows it; otherwise the
 * server stamps it from its directory index at write time, and a later change to that
 * file makes the cached answer stale instead of replayable.
 */
interface AnswerFileAnchor {
    path: string;
    contentHash?: string;
}
interface EvermindRunHooks {
    /** Recall the project's learned memories most relevant to `query`. */
    recall(query: string): Promise<EvermindRecallResult | null>;
    /**
     * Try to answer `query` from memory WITHOUT the LLM; null → run the model.
     *
     * `opts.toolsAvailable` tells the resolver whether THIS run can call tools. It must
     * be honest: the Evermind SSM has no tool-calling, so when tools are available the
     * server serves only the Q&A cache (a replay of an answer a real model produced) and
     * never a fresh SSM generation — otherwise a request whose answer lives behind a tool
     * call ("which tickets are in the backlog?") gets answered from stale weights while
     * the tools that could answer it are never called.
     */
    answer?(query: string, opts: MemoryAnswerOptions): Promise<MemoryFirstAnswer | null>;
    /**
     * Remember a (question → answer) pair so an exact repeat short-circuits next time.
     * `origin` is what producing the answer cost (the run's served model + summed tokens):
     * stored with it, so each replay's saving is a recorded figure, not an estimate.
     * `fileAnchors` are the files the turn read: the server drops the cached answer once
     * one of them changes. Absent → the server-backed hooks derive them from the paths
     * the answer cites ({@link citedPathAnchors}).
     */
    cacheAnswer?(query: string, answer: string, origin?: AnswerOriginCost, fileAnchors?: AnswerFileAnchor[]): void | Promise<void>;
}
/**
 * The host's authenticated JSON transport, as a port. Both Brain hosts already have
 * one (`apiRequest` on the web, the webview's `authedFetch`); this is the intersection
 * the memory hooks need, so neither has to hand it a bespoke wrapper.
 */
type ProjectMemoryRequest = <T>(path: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}) => Promise<T>;
/**
 * The project's SERVER-side memory hooks, built once for every host.
 *
 * The three calls — recall, memory-first answer, write-through — are the same routes
 * with the same query parameters and the same "a failure is not an error, it is just
 * no memory" contract wherever the Brain runs. They were hand-written per host, and
 * the copies had drifted: the web surfaces passed only `recall` (one of them plus a
 * `learn` callback this interface has never had, so it was dead), while only the VS
 * Code webview had the memory-first pair at all. Same loop, three different memories.
 *
 * `toolsAvailable` is threaded through honestly, because the server uses it to decide
 * whether the Evermind SSM leg may run: it cannot call a tool, so on a run that could
 * fetch the real answer it must never pre-empt the model from stale weights.
 */
declare function projectMemoryHooks(projectId: number, request: ProjectMemoryRequest, 
/**
 * The chat these hooks are bound to, when the host knows it.
 *
 * Recall is TIERED on it: this conversation's own memories come first, then the
 * wider project's. Without it the server ranks project-wide, which is what made a
 * reopened chat "remember" turns from other conversations. Optional because a global
 * (project-less) chat and the non-chat callers genuinely have none — those recall
 * project-wide exactly as before.
 */
chatId?: number | null, 
/** Which surface the run is driven from — recorded on the saving a memory answer
 *  makes, so "saved" splits by editor / web / browser like "spent" does. */
surface?: MemorySurface): EvermindRunHooks;

/**
 * THE context-window resolver for a hand-off target — how many tokens the model about to
 * serve can hold, or `undefined` when nobody knows.
 *
 * A local ref (`local/<runtime>/<model>`) is answered by the runtime's own live report
 * (a probe's `contextTokens`) first, then by the shipped catalog row (`LOCAL_MODEL_CATALOG`
 * — the WebLLM 4k rows, Bonsai 32k/65k). A cloud ref is answered only by what the host
 * already knows (`sources.cloud`): `@builderforce/model-catalog` carries no window, and a
 * guessed one would shrink a 200k model's transcript for nothing. Unknown means "keep
 * today's budget" — the gateway fits a cloud request to a model that can hold it.
 */

/** Where a window may come from. Every source is optional. */
interface ModelWindowSources {
    /** Live local runtime probes (or their flattened models). A runtime's own report wins
     *  over the catalog: an Ollama model can be loaded with a different `num_ctx`. */
    probes?: readonly LocalRuntimeProbe[];
    models?: readonly LocalModel[];
    /** The host's own knowledge of a cloud model's window (a gateway catalog), if any. */
    cloud?: (ref: string) => number | undefined;
}
/** The model's context window in tokens, or undefined when unknown. */
declare function contextWindowOf(modelRef: string | undefined, sources?: ModelWindowSources): number | undefined;
/**
 * What a run lends its window-fit gate. The same sources as {@link ModelWindowSources},
 * except the probes are READ ON DEMAND: probing a local runtime is only worth doing for
 * a local target, and a run lives longer than any one probe.
 */
interface RunWindowSources {
    /** The host's own knowledge of a cloud model's window — its gateway catalog. */
    cloud?: (ref: string) => number | undefined;
    /** The live local runtimes, asked only when the target is a local ref. */
    probes?: () => readonly LocalRuntimeProbe[] | Promise<readonly LocalRuntimeProbe[]>;
}
/** {@link contextWindowOf} over a run's sources. A probe that fails leaves the catalog row. */
declare function resolveContextWindow(modelRef: string | undefined, sources?: RunWindowSources): Promise<number | undefined>;

/**
 * The ONE on-device task port (PRD 42 · Part B1).
 *
 * Utility work — a summary, a rewrite, a language check, a structured judgement — runs on
 * the device FIRST whatever model the conversation is pinned to. Every host supplies this
 * port once (web: `browserOnDeviceTasks()`, Rovr: the panel services, VS Code:
 * `modelRouting.ts`); consumers receive it and never branch on browser, vendor or API.
 *
 * Every method behaves the same way:
 *   - it returns its result, or `null` when the task cannot run here (the API is absent,
 *     the model is not ready, the input is over budget after chunking, the model refused,
 *     or its output failed validation) — `null` means "do what you did before";
 *   - it throws ONLY an `AbortError`;
 *   - it never touches the network.
 */
/** A JSON Schema document (the subset `@builderforce/json-schema` understands). */
type JsonSchema = {
    readonly [key: string]: unknown;
};
type OnDeviceTaskKind = 'summarize' | 'rewrite' | 'proofread' | 'write' | 'detectLanguage' | 'translate' | 'json';
/** The runtime that served a call — a built-in model (`browser`) or a local engine. */
type OnDeviceEngine = 'browser' | 'bfi' | 'webllm' | 'synapse' | 'ollama' | 'freetoken';
/** Who served ONE call (PRD 42 · Part F): its task kind, the engine and the bare model id. */
interface ServedBy {
    kind: OnDeviceTaskKind;
    engine: OnDeviceEngine;
    model: string;
}
/** Per-call provenance: told who served THIS call (nothing shared, so concurrent calls cannot cross). */
interface ServedOption {
    onServed?: (by: ServedBy) => void;
}
/**
 * One measured call (PRD 42 · Part F). `served`/`declined` come from the port; `replaced`
 * from a client-first caller whose device answer the server refused, so the cloud redid it.
 * A declined call has no engine. Token counts are estimates (≈4 chars each) of the call's
 * input and output, for the host's usage ledger.
 */
interface OnDeviceTaskEvent {
    kind: OnDeviceTaskKind;
    engine: OnDeviceEngine | null;
    model: string | null;
    outcome: 'served' | 'declined' | 'replaced';
    ms: number;
    promptTokens?: number;
    completionTokens?: number;
}
/** A host's sink for {@link OnDeviceTaskEvent}s. Must not throw; a throw is swallowed. */
type OnDeviceObserver = (event: OnDeviceTaskEvent) => void;
interface SummarizeOptions extends ServedOption {
    kind: 'tldr' | 'key-points' | 'transcript';
    maxWords?: number;
    context?: string;
    signal?: AbortSignal;
}
interface RewriteOptions extends ServedOption {
    tone?: 'more-formal' | 'as-is' | 'more-casual';
    length?: 'shorter' | 'as-is' | 'longer';
    instruction?: string;
    signal?: AbortSignal;
}
interface WriteOptions extends ServedOption {
    context?: string;
    length?: 'short' | 'medium' | 'long';
    signal?: AbortSignal;
}
interface TranslateOptions extends ServedOption {
    from?: string;
    to: string;
    signal?: AbortSignal;
}
interface JsonTaskOptions extends ServedOption {
    system: string;
    user: string;
    schema: JsonSchema;
    signal?: AbortSignal;
}
interface DetectedLanguage {
    lang: string;
    confidence: number;
}
interface OnDeviceTasks {
    /** Which task kinds can run right now (ready models only). Cheap; memoized like probes. */
    available(): Promise<ReadonlySet<OnDeviceTaskKind>>;
    summarize(text: string, o: SummarizeOptions): Promise<string | null>;
    rewrite(text: string, o: RewriteOptions): Promise<string | null>;
    write(task: string, o?: WriteOptions): Promise<string | null>;
    proofread(text: string, o?: {
        signal?: AbortSignal;
    } & ServedOption): Promise<string | null>;
    detectLanguage(text: string, o?: ServedOption): Promise<DetectedLanguage | null>;
    translate(text: string, o: TranslateOptions): Promise<string | null>;
    /** Structured output. The result is validated against `schema` before it is returned; invalid → null. */
    json<T>(o: JsonTaskOptions): Promise<T | null>;
}

/** What one completed run did, as the note format understands it. */
interface RunActivity {
    /** Paths the run created. Duplicates are collapsed. */
    created?: readonly string[];
    /** Paths the run modified. Duplicates are collapsed. */
    edited?: readonly string[];
    /**
     * Paths the run READ. The note lists the most-read few, so the next run in this
     * workspace sees where the last one had to look; duplicates are kept here because
     * how often a file was re-read is how much the run depended on it.
     */
    read?: readonly string[];
    /** Paths the run deleted. Duplicates are collapsed. */
    deleted?: readonly string[];
    /** Tool names the run invoked. Duplicates are collapsed. */
    tools?: readonly string[];
    /**
     * The run's own prompt — what it was asked to do. When present, the summary
     * describes THAT rather than falling back to a fixed template, so two runs
     * that both edited a test file do not read as the same "Test suite created".
     */
    prompt?: string;
}

/**
 * run-knowledge — the TOOL VOCABULARY of a run's memory.
 *
 * Short-term vs long-term memory is a memory concept and lives in
 * `@seanhogg/builderforce-memory/working`: {@link WorkingMemory} is what this run has
 * read, searched and changed (restated before every turn by its `brief`), and
 * `consolidate` / `mergeConsolidated` turn it into the per-area code map the next run
 * recalls. That package knows observations, never tool names.
 *
 * This module is the one place that maps the platform's tool names onto those
 * observations — every runtime's spelling (shared `write_file`, on-prem native
 * `write`/`create`, …) — so the editor, on-prem and the cloud engine record a run the
 * same way. {@link RunKnowledgeRecorder} is that adapter: it owns the run's
 * {@link WorkingMemory} and the tool names a run note lists.
 */

/**
 * The recorder's CONTRACT — what a loop or host hands across a package boundary. A
 * structural interface, not the class: a bundled `.d.ts` (brain-embedded's) carries its
 * own copy of a class, and two copies of a class with private fields are different
 * types, so a host's recorder could not be passed to the loop by its class.
 */
interface RunKnowledgeLog {
    setPrompt(prompt: string): void;
    record(name: string, args?: unknown): void;
    readonly isEmpty: boolean;
    readonly activity: RunActivity;
    /** The short-term brief for the next turn (`WorkingMemory.brief`), or null while not worth it. */
    brief(): string | null;
    /** The long-term code map this run consolidates into (`consolidate`), or null. */
    consolidate(opts?: ConsolidateOptions): ConsolidatedMemory | null;
}

/**
 * The deterministic-first PreFetch contract (docs/design/deterministic-prefetch.md).
 *
 * Actions are REGISTRY DATA. A host supplies one executor per action id; the gate never
 * runs a tool itself. A new tool is a registry row plus an executor, never a gate branch.
 */
type PrefetchKind = 'answer' | 'prefetch';
/** write ⇒ always a confirm chip, never auto-run, whatever p is. */
type SideEffect = 'read' | 'write';
type PrefetchSurface = 'vscode' | 'onprem' | 'cloud' | 'web';
type GateTier = 1 | 2 | 3;
type GateRoute = 'answer' | 'prefetch' | 'llm';
interface PrefetchAction {
    /** 'symbols.where-defined', 'dup.check', 'knowledge.review-dir', … */
    id: string;
    kind: PrefetchKind;
    sideEffect: SideEffect;
    surfaces: PrefetchSurface[];
    /** Explicit composer slash action (tier 1), e.g. '/dup'. */
    slash?: string;
    /** Rule match (tier 1). */
    patterns?: RegExp[];
    /** Phrasings for tiers 2–3. */
    examples: string[];
    /** Hard executor deadline (withinMs). */
    budgetMs: number;
    /** Tool detection: the action is offered only when the host reports the tool present. */
    requires?: {
        tool: string;
    };
    /** i18n key for the confirm chip / trace label. */
    labelKey: string;
}
/** Per-action logistic head state (same family as difficulty-router/head.ts). */
interface ActionHead {
    weights: number[];
    bias: number;
    n: number;
}
/** Per-action calibrated thresholds; cold start is conservative (answer 0.9). */
interface ActionThreshold {
    answer: number;
    prefetch: number;
    n: number;
}
/** One logged outcome a threshold is recalibrated from: `[p, accepted ? 1 : 0, route]`. */
type LoggedOutcome = [p: number, accepted: 0 | 1, route: 'answer' | 'prefetch'];
interface CalibrationState {
    heads: Record<string, ActionHead>;
    thresholds: Record<string, ActionThreshold>;
    /** The newest outcomes per action (bounded), which `recalibrate` derives thresholds from. */
    outcomes?: Record<string, LoggedOutcome[]>;
}
/** Outcome written back after a decision: accepted, or the user re-asked the LLM. */
interface GateOutcome {
    actionId: string;
    route: GateRoute;
    p: number;
    tier: GateTier;
    accepted: boolean;
    features: number[];
}
/** Local-SLM logprob classifier (tier 3) — Synapse/bfi-node → WebLLM → Ollama last. */
interface LogprobPort {
    /** True only when a local engine is warm; tier 3 is skipped otherwise. */
    warm(): boolean;
    /** One forward pass; returns log-probabilities per label (labels = action ids + 'needs-llm'). */
    logprobs(prompt: string, labels: string[], signal?: AbortSignal): Promise<Record<string, number>>;
}
interface GatePorts {
    /** Tools present in this workspace (memoised per workspace by the host). */
    tools?: ReadonlySet<string>;
    surface: PrefetchSurface;
    calibration?: CalibrationState;
    logprob?: LogprobPort;
    signal?: AbortSignal;
    /** Total gate budget; tier 3 is skipped if the remainder is below its cost. Default 300 ms. */
    budgetMs?: number;
}
interface PrefetchResult {
    actionId: string;
    /** ANSWER: the settled reply (markdown). PREFETCH: context for host.turnContext (volatile tail). */
    text: string;
    /** Optional chips rendered under the answer (e.g. Open in graph). */
    chips?: Array<{
        labelKey: string;
        command: string;
        args?: Record<string, unknown>;
    }>;
    /** Extra trace fields (counts, digests). */
    data?: Record<string, unknown>;
    /**
     * ANSWER actions only: how sure the executor's OWN evidence is (0–1) — e.g. the
     * knowledge index's top hit. Absent ⇒ the result is an answer whenever it is adopted.
     * Present and below the action's learned answer threshold (`thresholdOf(...).answer`)
     * ⇒ the GATE does not settle on it: {@link context} (else `text`) rides into the turn
     * as PREFETCH context instead.
     */
    confidence?: number;
    /** What rides into the turn when the gate demotes this answer to PREFETCH; default `text`. */
    context?: string;
}
interface PrefetchExecutor {
    run(request: string, signal: AbortSignal): Promise<PrefetchResult | undefined>;
    /**
     * WRITE actions: what running it would touch, in one line, read BEFORE the person is
     * asked — the confirm chip's detail (`knowledge.review-dir`: files by pack, unchanged
     * files, ≈ model calls). Read-only; undefined ⇒ the chip shows the request alone.
     */
    preview?(request: string, signal: AbortSignal): Promise<string | undefined>;
}
type PrefetchExecutors = Readonly<Record<string, PrefetchExecutor>>;
/** What brain-embedded receives from a host (`BrainRunRequest.prefetch`): the registry, its executors and the gate ports. */
interface PrefetchPort {
    registry: readonly PrefetchAction[];
    executors: PrefetchExecutors;
    ports: Omit<GatePorts, 'signal'>;
    /**
     * Brings `ports` up to date before the gate reads them — e.g. the workspace's tool
     * detection, memoised by the host, finished the first time. Bounded by the gate
     * (`PREPARE_BUDGET_MS`); a late or failed prepare leaves the ports as they are.
     */
    prepare?(signal?: AbortSignal): Promise<void>;
    /**
     * Write actions: OVERRIDE how the person is asked. Absent ⇒ the run's own confirm
     * channel (the composer's confirm chip — brain-embedded's `prefetchGate.ts`); resolves
     * true only when the person confirms. `detail` is the executor's `preview`, when it has one.
     */
    confirm?(action: PrefetchAction, request: string, detail?: string): Promise<boolean>;
    /** Outcome write-back (head update + persistence of calibration). */
    record?(outcome: GateOutcome): void;
}

/**
 * What the HOST hands a run before its first turn (PRD 35 E2 / E7), gathered in one
 * parallel wait: the recall hint (its context pack's focus files + headings), the task
 * context block, the files that block served whole, and the model preflight.
 *
 * Every part is best-effort. A part that throws costs that part, never the run — and the
 * reason is kept on the run's trace (`host.context_failed`) rather than swallowed.
 */

/** A file the host showed the model WHOLE, before the run read anything. */
interface ServedRead {
    /** Workspace-relative path, as `read_file` takes it. */
    path: string;
    /** The whole file, exactly as served. */
    content: string;
    totalLines: number;
}

/**
 * contractModel - the model half of the run contract: the transcript row, what the agent asks of a model, what comes back, and
 * the transport that answers. Split out of `contract.ts` (PRD 35 §5 rule 4); `contract.ts` re-exports every name, so no import changes.
 */

/** What a transport's preflight found. Empty `byoUnresolved` ⇒ every connected account resolves. */
interface ModelPreflightResult {
    /** `provider:reason` entries, exactly as the gateway's `x-builderforce-byo-unresolved` header spells them. */
    byoUnresolved: readonly string[];
    /** Providers whose `expired` token the transport refreshed successfully. */
    refreshed?: readonly string[];
    /** The model the run falls back to, when the transport knows it. */
    fallback?: string;
}

/** The verifier port every deterministic run gate reads (PRD 45 §4.4). */
interface VerifierPort {
    /** Fast tier, ≤ 3 s: language-server diagnostics for exactly these files. Null = unavailable. */
    diagnostics(absPaths: readonly string[]): Promise<CheckRecord | null>;
    /** Full tier for these files: owning packages' typecheck + targeted tests + repo guards. Cached by (path, hash, check). */
    full(absPaths: readonly string[]): Promise<ReadonlyMap<string, readonly CheckRecord[]>>;
}
/** The git port: the host reads the REAL commits, never the model's claims. */
interface GitPort {
    /**
     * Files in commits not yet on upstream plus the HEAD tree's bytes for each path.
     * `diff` is the text `diffHash` hashes — what the reviewer reads (OD-1); a reviewer
     * handed no diff hashes the empty string and can never match `diffHash`.
     */
    outgoing(repo: string): Promise<{
        files: OutgoingFile[];
        diffHash: string;
        baseBranch: boolean;
        diff?: string;
    }>;
}
/** The reviewer port: OD-1, one review sub-run by a model that did not author the change. */
interface ReviewerPort {
    review(input: {
        repo: string;
        diff: string;
        evidence: string;
        authorModels: readonly string[];
    }): Promise<ReviewVerdict | {
        refused: string;
    }>;
}
/**
 * What a run cell is keyed by. A CHAT's run is keyed by its chat id (a number — the
 * key every chat surface, run driver and the cross-chat {@link GlobalRunState} speak).
 * A run that is not a chat's — a canvas session's turn, hosted through
 * `startEngineRun` — takes a string key (`canvas:<sessionId>`), so it shares the store's
 * single-flight claim, Stop, confirmation gate and live snapshot without being mistaken
 * for a chat.
 */
type RunKey = number | string;
/** The surfaces a run comes in through - a telemetry label. */
type RunEntryPoint = 'vscode' | 'web' | 'rovr';
/** Streaming fn shape (matches BrainRuntime.stream). */
type BrainStreamFn = (opts: Omit<StreamChatOptions, 'transport'>, handlers?: StreamHandlers) => Promise<StreamChatResult>;
/** Persistence subset the loop needs (matches BrainPersistenceAdapter). */
interface BrainRunPersistence {
    sendMessages(chatId: number, messages: Array<{
        role: string;
        content: string;
        metadata?: string;
        eventKey?: string;
    }>): Promise<BrainMessage[]>;
    /** Optional read-back: lets a late write ask whether the chat has moved on (`continueChat.ts`'s stopped answer). */
    getMessages?(chatId: number, limit?: number): Promise<BrainMessage[]>;
}
/** Everything a single run needs, captured at start time (survives navigation). */
interface BrainRunRequest {
    resolvedSystemPrompt: string;
    /**
     * The run's record of what it did and read (`@builderforce/agent-tools`
     * `run-knowledge`). A host that commits the run's code map at the end passes its own
     * so there is ONE record per run; omitted, the loop keeps one for the per-turn ledger.
     */
    knowledge?: RunKnowledgeLog;
    tools?: BrainToolSpec[];
    model?: string;
    /** Hard-pin a deliberate user-selected model. */
    modelStrict?: boolean;
    /** Explicit routing choice when no model is pinned. */
    routingMode?: 'auto' | 'byo_pool';
    /**
     * Pick the next model to try when the current one has burned its whole stall budget
     * without emitting a single tool call — i.e. re-prompting it is spent and only a
     * DIFFERENT model can finish the request.
     *
     * The loop is deliberately surface-agnostic here: the host holds the cached
     * `/llm/v1/models` surface and answers with `nextFallbackModel(surface, tried)`, so
     * the ordering (own account + tool-calling pool first) lives in ONE shared function
     * rather than in each host. Return undefined — or omit the callback — to keep the
     * previous behaviour: stop and explain, instead of switching.
     *
     * `tried` holds every model already attempted this run, requested and resolved.
     */
    pickFallbackModel?: (tried: readonly string[]) => string | undefined;
    /**
     * Where the window-fit gate learns the window of the model a request is about to ask
     * for (`windowFit/`): the host's gateway catalog as `cloud` (`gatewayModelWindows`)
     * and its live local runtimes as `probes`. A failover onto a smaller cloud model is
     * packed for that model only when the catalog says how small it is. Omit and only the
     * shipped local catalog answers — a cloud move keeps the working budget.
     */
    windowSources?: RunWindowSources;
    /**
     * The host's on-device task port (PRD 42 · C2). The run's summaries — the compaction
     * fold and the hand-off note — ask it FIRST, whatever model the run is pinned to; on
     * `null` they run through `stream` as before. Omit and nothing changes.
     */
    onDeviceTasks?: OnDeviceTasks;
    /** `signal` is passed for a call the person's steer may interrupt (a foreground
     *  command); otherwise the host lends the call the run's own Stop. */
    runTool?: (name: string, args: unknown, signal?: AbortSignal) => Promise<unknown>;
    /**
     * The host's LIVE-CHILDREN port (the agent's `FinishPorts.liveChildren`): the block reason while sub-agents THIS run
     * started are still working, or null when none is. Bound, it holds every end of the run - the `finish` tool and a prose
     * answer alike - until their reports are in (`run/brainFinish.ts`). Unbound, the owner could end with children still
     * working, and each late report then woke it into a new run with no ask of its own (chats #60338, #61651).
     */
    liveChildren?: () => Promise<string | null>;
    /** Pure predicate: true → pause the loop for an explicit user confirmation. */
    needsConfirm?: (req: {
        name: string;
        args: unknown;
    }) => boolean;
    /**
     * Auto-answer resolver for the conversational `ask_user` tool — the counterpart to
     * {@link needsConfirm}, which only gates DISPATCHED tool calls. `ask_user` is terminal:
     * without this the run settles on the question and waits for a human click. When the
     * run is about to settle on a well-formed question AND this returns a non-null string,
     * the run treats the string as the user's answer: it persists the question as
     * narration, appends the answer as the next USER turn, and CONTINUES. Return null (or
     * omit) to let the question settle and render the card exactly as when Auto is off.
     * Hosts in Auto mode pass the shared gate's `answerQuestion`, which reads the same
     * live ref as `needsConfirm`, so a mid-run toggle is honoured.
     */
    answerQuestion?: (question: AskUserPayload) => string | null;
    /**
     * PRD 45 §4.4 — the deterministic ship-gate ports. EVERY gate is inert unless its
     * port is bound: the web Brain and the parity harness bind none and are unchanged.
     */
    verifier?: VerifierPort;
    git?: GitPort;
    reviewer?: ReviewerPort;
    /** The evidence policy the ship gates enforce — policy is data (PRD 45 §4.3). Defaults to DEFAULT_EVIDENCE_POLICY. */
    evidencePolicy?: EvidencePolicy;
    stream: BrainStreamFn;
    /**
     * `max_tokens` for this run's completions — the composer's Effort level (see
     * `effort.ts`). Absent keeps `streamChatCompletion`'s 4096 default.
     */
    maxTokens?: number;
    /**
     * Vendor-neutral reasoning intent for this run (the composer's Thinking toggle,
     * at the Effort level's intensity). Absent ⇒ no `reasoning` key on the wire.
     * Applies to the MODEL-FACING turns only — the internal transcript summarizer
     * is a mechanical compaction, never a "think harder" job.
     */
    reasoning?: ReasoningIntent;
    persistence: BrainRunPersistence;
    onActivity?: (chatId: number) => void;
    /** Seed the rich transcript from prior persisted history (first turn only). */
    seed?: ChatCompletionMessage[];
    /**
     * What earlier turns of this chat already READ and DID, as a system-prompt block
     * (`priorResearch.ts`) — the counterpart to {@link seed}, which cannot carry tool
     * results (an orphaned tool message 400s strict vendors). Applied only when the run
     * seeds its transcript from history; a transcript still in memory already holds the
     * real tool rows. Without it a "continue" after a reload started its research over.
     */
    priorResearch?: string | null;
    /** The user turn that triggered this run, appended to the transcript. */
    userTurn?: string | ContentPart[];
    /** The persisted message id behind each {@link seed} entry, in order (`transcriptSeedOf`). */
    seedIds?: number[];
    /** The persisted message id of {@link userTurn}. With {@link seedIds} it lets a fold
     *  record which persisted messages its note covers (`runFoldMarker.ts`). */
    userTurnMessageId?: number;
    /**
     * The chat's project. Enables the post-run "a code change is always tied to a
     * ticket" backstop: when an IDE run changed code but never recorded a ticket, the
     * loop mints one via `builtin_tickets_from_delta` for THIS project, linked to the
     * chat. Omit (or null) for a non-project chat / the web Brain (which has no file
     * tools, so the backstop never fires there anyway).
     */
    projectId?: number | null;
    /**
     * Project-Evermind memory hooks (bound to the active chat's project by the
     * host). When present, the loop recalls learned memories before answering,
     * injects them into the system prompt, and records recall/learn/reconcile
     * steps into the trace so the chat SHOWS the project memory being used. Omit
     * for a non-project chat (nothing memory-related happens).
     */
    evermind?: EvermindRunHooks;
    /**
     * Optional per-turn system-prompt augmentation — the LIMBIC parity seam.
     *
     * Called once at loop start (alongside Evermind recall) with the latest user
     * text; a non-empty return is appended to the system prompt with a leading
     * `\n\n`. This lets a host inject a per-turn dynamic block (e.g. a limbic /
     * affective state fetched from the gateway) that the synchronous
     * `resolvedSystemPrompt` resolver cannot produce. Best-effort: a throw is
     * swallowed and the turn proceeds without the augmentation, exactly like a
     * failed Evermind recall.
     */
    augmentSystemPrompt?: (userText: string) => Promise<string | undefined>;
    /**
     * Terms the host adds to the Evermind recall query (PRD 35 E2): the focus files the
     * request names and their top headings, from the host's context pack. Recall then
     * searches with the request PLUS the code it is about, never the bare sentence.
     * Awaited once before the first turn; a throw or an empty string recalls as before.
     */
    recallHint?: () => Promise<string | undefined>;
    /**
     * The host's per-run TASK CONTEXT (PRD 35 E2 — its context pack). Unlike
     * {@link augmentSystemPrompt}, it ALWAYS rides the volatile per-turn block after the
     * history (never the cached system prefix), whatever `b1_stable_prefix` says: it is
     * large and changes every run. Awaited once before the first turn; best-effort.
     */
    turnContext?: () => Promise<string | undefined>;
    /**
     * Files the host already SERVED the model whole in {@link turnContext} (the pack's
     * inlined focus files). Recorded as reads in the run's read coverage, so a `read_file`
     * of one is an exact repeat / covered window, not a second read. Best-effort.
     */
    servedReads?: () => Promise<readonly ServedRead[] | undefined>;
    /**
     * The host's deterministic-first PREFETCH port (`@builderforce/prefetch`): its action
     * registry, one executor per action and the gate's ports. Consulted once before the
     * first turn (`prefetchGate.ts`), ahead of the memory-first answer and outside its
     * replay gate: an ANSWER action settles the run with no model call ("where is X
     * defined?" from the symbol index); PREFETCH actions add their output to the volatile
     * per-turn block. Absent ⇒ the run proceeds as before.
     */
    prefetch?: PrefetchPort;
    /**
     * Record a model call the run AVOIDED — a PreFetch ANSWER — beside the host's usage
     * ledger (the device ledger's `deterministic` saving, priced at `model` for a median
     * turn). Omit and nothing is recorded. Best-effort.
     */
    recordAvoidedCall?: (call: AvoidedRunCall) => Promise<unknown> | void;
    /**
     * The host's MODEL PREFLIGHT (PRD 35 E7): its BYO health check, awaited once before
     * the first turn. Unresolved accounts are seeded into the run's BYO banner state and
     * recorded as `model.preflight`, so the user hears it before any work. Best-effort.
     */
    modelPreflight?: () => Promise<ModelPreflightResult | undefined>;
    /**
     * The conversation's MODE (migration 0409) — whether this run is a CONVERSATION
     * (`chat`: read, reason, answer) or an EXECUTION (`work`: create + staff + link the
     * ticket, then dispatch an agent to run it). Decides which directive is folded into
     * the system prompt; see `chatMode.ts`.
     *
     * Optional, and absent means `work`: hosts that predate the mode (the VS Code
     * webview, any embed) keep the always-execute behaviour they shipped with rather
     * than silently losing their ticket lineage.
     */
    chatMode?: ChatMode;
    /**
     * The agents INVITED INTO this chat, which is the platform's record of who the human
     * wants on this work. Folded into the WORK directive: naming them saves the model a
     * discovery call it had no reason to spend, and a non-empty roster inverts the
     * do-it-here ordering so the invited agents get dispatched rather than watched
     * (see `chatMode.ts`). Absent or empty leaves the prior behaviour exactly as it was —
     * a host that does not know the roster must not accidentally assert there is none, so
     * an UNRESOLVED roster and an EMPTY one are both simply "nobody named here".
     */
    chatRoster?: readonly ChatRosterAgent[];
    /**
     * Report a settled code-changing run's outcome to learned routing (the host POSTs it
     * to `/llm/v1/run-outcome`). Omit and nothing is reported. Best-effort: a rejection is
     * swallowed and never affects the run.
     */
    reportOutcome?: (outcome: BrainRunOutcome) => Promise<unknown>;
    /**
     * Told the uniform §8.2 record (PRD 35) of a run that made no coder grade, once, when a run ends: the entry point, the counts,
     * `routingSignal: false` (the door records it and routing never learns from it). The host posts it to the same door. It is its own port so
     * that {@link reportOutcome} keeps doing exactly what it always has: the same runs, the same `source`, the same fields. A run
     * with a grade reports through `reportOutcome` alone, the §8.2 telemetry riding on it as optional fields. One report per run.
     */
    reportRunRecord?: (record: RunOutcomeRequest) => Promise<unknown>;
    /**
     * The host's STOP HOOK (`stopHooks.ts`) — asked each time the run is about to end; a
     * returned instruction holds it for another turn (bounded per run). The VS Code host
     * feeds it from the workspace's committed `.builderforce/hooks.json`. Omit for none.
     */
    onStop?: RunStopHook;
    /**
     * The SERVER chat this run's server-addressed work names (PRD 36) — the gateway's
     * `metadata.chatId`, the model's chatId, the ticket backstops' links, the prompt-cache
     * key. Omitted ⇒ the run's chat id IS a server chat (a host whose persistence is the
     * server: the web Brain, the canvas). `null` ⇒ the chat lives only on this machine
     * and is not bound: no chat id leaves it, and the chat-scoped backstops stand down.
     * A host with a local store always passes it, bound or not.
     */
    serverChatId?: number | null;
    /**
     * The local chat's stable client id (a uuid) — rides the gateway metadata for
     * diagnostics only (`clientChatId`); the server never resolves it to a chat.
     */
    clientChatId?: string;
    /**
     * This run has an OWNER — it is a sub-agent another run spawned (`runLineage.ts`).
     * Nothing about the loop changes: the run keeps its own key (its own transcript, Stop
     * and approval prompt) while everything it persists or asks the server about goes to
     * the root chat, attributed to the child. Absent for a top-level run.
     */
    lineage?: RunLineage;
    /**
     * The model each working phase asks for when the run holds no model of its own
     * (`@builderforce/run-policy` `phaseModels`): the host's stage models instead of one
     * model pinned to the whole run. `verify` also overrides a pin, as the review model.
     */
    phaseModels?: RunStageModels;
    /**
     * Route this run's pipeline (`runStore/pipelineRoute.ts`): decided ONCE, before turn
     * 1 — `quick` starts in `code` on {@link RunPipelineSettings.quickModel} with no plan
     * phase and no verify stage; `full` is the plan → code → verify pipeline. Absent ⇒
     * the run is not routed (every run takes the full pipeline, nothing is recorded).
     */
    pipeline?: RunPipelineSettings;
    /**
     * The run's spend cap in USD (`runStore/runSpendBudget.ts`): checked before every turn
     * against what the run's calls cost so far; the run stops with a contained outcome at
     * the cap and the model is warned at 80%. Absent or 0 = no cap.
     */
    maxRunBudgetUsd?: number;
    /**
     * The surface the run came in through - the label its uniform outcome row carries. Telemetry only:
     * nothing branches on it.
     */
    entryPoint?: RunEntryPoint;
    /**
     * Told once, at run end, how the run ended and under which run id its calls were
     * recorded (`runEndOutcome.ts`) — the host stores it beside its usage ledger for the
     * pipeline route report. Also told, on the chat's NEXT request, whether a PreFetch
     * decision made in the run was accepted (`gateAccepted`, the report's gate accuracy).
     * Omit and nothing is reported. Best-effort.
     */
    recordRunOutcome?: (end: RunOutcomeReport) => Promise<unknown> | void;
}
/** One report about a run's end (`outcome`) or its PreFetch decision (`gateAccepted`). */
interface RunOutcomeReport {
    runId: string;
    outcome?: RunEndOutcome;
    /** The PreFetch decision this run made was accepted (the next request did not re-ask). */
    gateAccepted?: boolean;
}
/** A model call a PreFetch ANSWER stood in for (`recordAvoidedCall`). */
interface AvoidedRunCall {
    source: 'deterministic';
    /** The registry action that answered. */
    actionId: string;
    /** The run id (`metadata.guestTurnId`) — what the usage ledger groups a run's rows by. */
    runId?: string;
    /** The model the turn would have run on, when known. */
    model?: string;
    /** The median turn's tokens the avoided call is estimated at (`MEDIAN_TURN_TOKENS`). */
    promptTokens: number;
    completionTokens: number;
}
/** How a run ended. */
type RunEndOutcome = 'succeeded' | 'failed' | 'stopped' | 'budget-contained';
/** The host's per-phase models — absent phase ⇒ the gateway orders by role. */
type RunStageModels = Partial<Record<'plan' | 'code' | 'verify', string>>;
/** How a host wants its runs routed between the full pipeline and a quick pass. */
interface RunPipelineSettings {
    /** `auto` routes on the score; `always` keeps every run on the full pipeline. */
    routing: 'auto' | 'always';
    /** P(full) at or above which a run takes the full pipeline. Default 0.5. */
    threshold?: number;
    /** The model a quick run codes on. Absent ⇒ the code model, else the gateway's order. */
    quickModel?: string;
}

/**
 * The words a person said that are not SAVED yet - kept on the device so a reload before the save lands (a slow
 * network, a closed tab, a timeout) does not lose them. Written when the words are first queued for a run
 * (`runSteering.ts`, AFTER they are in the inbox - a storage failure never costs a steer), cleared the moment they are
 * saved (the run's `persistSteer`, a continuation's save) or ended (every Stop), and replayed when the chat is next
 * opened (`useChatTranscript`) or the app starts (`BrainProvider`): saved under the key they were queued with, so a
 * save that did land is the same row, never a second.
 *
 * WHOSE words. The journal belongs to one signed-in person in one workspace: its key carries both
 * (`bf:pendingWords:<tenant>:<user>:<chatId>`), a host names them (`setPendingWordsOwner`), and signing out removes
 * the lot (`clearPendingWords`). With no owner there is no journal - the words are still kept in memory for the
 * session. An entry also expires (`TTL_MS`) and a chat holds at most `PER_CHAT_CAP`: a device is not an archive.
 *
 * WHICH SESSION. A second tab of the same person must not answer the first tab's words: an entry is replayed only
 * when the page load that wrote it is provably gone. Every page load holds a Web Lock named for itself for as long
 * as it lives (`navigator.locks`); another load replays an entry only if no one holds that lock. Where Web Locks
 * do not exist the load writes a heartbeat instead, and an entry whose heartbeat has gone quiet is dead.
 *
 * READ OR NOT. Words the model has already drained (`markPendingWordsRead`, by the run) were read by the run that
 * lost the page: replayed, they are saved as the mid-turn rows they were (`steerMetadata`) and do not prompt a second
 * answer. Words never drained replay as an ordinary pending user turn.
 *
 * Text only: a file the words carried was uploaded under its own key already. Every storage access is guarded - a
 * private window or a blocked profile simply has no journal - and nothing here throws.
 */

/**
 * Name whose words these are (null: signed out, no journal). Hosts call it as the signed-in identity changes. The moment
 * a person is known the app has started for them: every chat they left words in is replayed, not only the one opened.
 */
declare function setPendingWordsOwner(who: {
    tenant: string | number;
    user: string | number;
} | null): void;
/** The persistence the app-start replay saves through (null: the provider unmounted). Replays at once if the owner is known. */
declare function registerPendingWordsReplay(persistence: Pick<BrainRunPersistence, 'sendMessages'> | null): void;
/** Journal the words. Returns whether they are on the device: false means a reload before the save lands loses them. */
declare function rememberPendingWords(chatId: number, eventKey: string, text: string, savedTo?: number): boolean;
/** The words with these keys were saved, or ended (a Stop): they are no longer the device's to keep. */
declare function forgetPendingWords(chatId: number, eventKeys: ReadonlyArray<string | undefined>): void;
/** The model drained these (it has read them): if the page is lost now, they replay as what they became. */
declare function markPendingWordsRead(chatId: number, eventKeys: ReadonlyArray<string | undefined>): void;
/** Sign-out: nothing a person said stays on a device they have left (every owner's journal, and the heartbeats). */
declare function clearPendingWords(): void;
/**
 * Save the words a DEAD page load left unsaved, under the keys they were queued with (idempotent), then forget them.
 * Bounded; never rejects. One replay per chat at a time (a second asker shares it). Returns how many were saved.
 */
declare function replayPendingWords(chatId: number, persistence: Pick<BrainRunPersistence, 'sendMessages'>): Promise<number>;
/** The app started: replay every chat this person left words in, not only the one that happens to be opened. */
declare function replayAllPendingWords(persistence: Pick<BrainRunPersistence, 'sendMessages'>): Promise<number>;

export { LOCAL_TICKET_CREATE_TOOL as $, ASK_USER_TOOL as A, type BrainRunPersistence as B, type ChatCompletionMessage as C, type DetectedLanguage as D, type Effort as E, type AskUserMessageLike as F, type AskUserOption as G, type AskUserPayload as H, type AskUserToolSpec as I, type JsonTaskOptions as J, type AssembledToolCall as K, type LocalFirstAccount as L, type AvoidedRunCall as M, type BrainRunOutcome as N, type OnDeviceTasks as O, type ProjectMemoryRequest as P, CHAT_MODES as Q, type RunKey as R, type StreamChatOptions as S, type TranslateOptions as T, CHAT_MODE_ICON as U, type ChatWorkDirectiveOptions as V, type WriteOptions as W, type CompletionMetadata as X, type EffortProfile as Y, type GitPort as Z, type ImageUrlContentPart as _, type BrainRunRequest as a, registerPendingWordsReplay as a$, type LocalFirstAttemptSummary as a0, MAX_STOP_HOOK_ROUNDS as a1, type MemoryAnswerOptions as a2, type MemoryFirstAnswer as a3, type MemorySurface as a4, type ModelPreflightResult as a5, type ModelWindowSources as a6, NEW_CHAT_MODE as a7, type OnDeviceEngine as a8, type OnDeviceTaskEvent as a9, chatConversationDirective as aA, chatModeDirective as aB, chatRosterFromParticipants as aC, chatWorkDirective as aD, clearPendingWords as aE, coerceAskUserPayload as aF, contextWindowOf as aG, effortProfile as aH, isChatMode as aI, isEffort as aJ, localFallbackTrace as aK, normalizeChatMode as aL, parseAskUser as aM, parseSubagentOrigin as aN, projectMemoryHooks as aO, reasoningForRun as aP, resolveContextWindow as aQ, savedChatOf as aR, selectPendingAskUser as aS, serializeAskUser as aT, setPendingWordsOwner as aU, streamChatCompletion as aV, stripAskUser as aW, summarizeLocalFirstAttempt as aX, ticketToolVocabulary as aY, forgetPendingWords as aZ, markPendingWordsRead as a_, type PendingAskUser as aa, type PrefetchResult as ab, RESTING_CHAT_MODE as ac, type ReasoningLevel as ad, RepetitionLoopError as ae, type ReviewerPort as af, type RunLineage as ag, type RunOutcomeReport as ah, type RunPipelineSettings as ai, type RunStageModels as aj, type RunStopHook as ak, type RunStopInput as al, SERVER_TICKET_CREATE_TOOL as am, SERVER_TICKET_TOOLS as an, SUBAGENT_OF_META_KEY as ao, type ServedOption as ap, type ServedRead as aq, StreamInterruptedError as ar, type SubagentOrigin as as, type TextContentPart as at, TransportError as au, type UpstreamTurnEvidence as av, type VerifierPort as aw, askStopHook as ax, askUserAnchorId as ay, askUserBlock as az, type BrainTransport as b, rememberPendingWords as b0, replayAllPendingWords as b1, replayPendingWords as b2, type BrainStreamFn as c, type RunEndOutcome as d, type CompletionUsage as e, type StreamHandlers as f, type StreamChatResult as g, type LocalFirstAttemptRecord as h, type LocalFirstAttempt as i, type LocalFirstWorkload as j, type OnDeviceObserver as k, type OnDeviceTaskKind as l, type ServedBy as m, type SummarizeOptions as n, type RewriteOptions as o, type JsonSchema as p, type EvermindRunHooks as q, type BrainToolSpec as r, type ChatMode as s, type RunWindowSources as t, type ReasoningIntent as u, type ChatRosterAgent as v, type ContentPart as w, type TicketToolVocabulary as x, ASK_USER_TOOL_SPEC as y, type AnswerOriginCost as z };
