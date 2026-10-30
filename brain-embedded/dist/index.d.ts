import * as react from 'react';
import { ReactNode, Dispatch, SetStateAction } from 'react';
import { R as RunKey, B as BrainMessage, a as BrainRunSnapshot, G as GlobalRunState, b as BrainTraceEvent, c as BrainRunPersistence, d as BrainRunRequest, e as BrainTransport, f as BrainChat, C as ChatInputAttachment, g as BrainStreamFn, S as SpendSavingsSummary, h as RunEndOutcome, i as CompletionUsage, j as ChatCompletionMessage, L as LocalFirstAccount, k as StreamChatOptions, l as StreamHandlers, m as StreamChatResult, n as LocalFirstAttemptRecord, o as LocalFirstAttempt, p as LocalFirstWorkload, P as ProjectMemoryRequest, E as Effort, q as EvermindRunHooks, r as BrainToolSpec, s as BrainModality, t as ChatMode, u as BrainRunActivity, v as RunWindowSources, w as ReasoningIntent, x as ChatRosterAgent, y as ContentPart, z as RunProgress, A as BrainDiagnostics, D as StaffingSummary, U as UsageSurface } from './pendingWords-Bbt7S360.js';
export { F as AnswerOriginCost, H as AssembledToolCall, I as AvoidedRunCall, J as BrainDiagnosticsContext, K as BrainRunOutcome, M as BrainRunPhase, N as BuildBrainTriageOptions, O as ByoUnresolvedEntry, Q as CHAT_MODES, T as CHAT_MODE_ICON, V as ChatWorkDirectiveOptions, W as CompletionMetadata, X as DispatchRefusal, Y as EffortProfile, Z as EvermindLearnOutcome, _ as EvermindLearnTarget, $ as ImageUrlContentPart, a0 as LocalFirstAttemptSummary, a1 as MAX_STOP_HOOK_ROUNDS, a2 as MemoryAnswerOptions, a3 as MemoryFirstAnswer, a4 as MemorySurface, a5 as ModelPreflightResult, a6 as ModelScore, a7 as ModelTurn, a8 as ModelWindowSources, a9 as NEW_CHAT_MODE, aa as PersonaSubagent, ab as PrefetchResult, ac as RESTING_CHAT_MODE, ad as ReasoningLevel, ae as RepeatStreak, af as RepeatedTarget, ag as RepetitionLoopError, ah as RunLineage, ai as RunOutcomeReport, aj as RunPipelineSettings, ak as RunStageModels, al as RunStopHook, am as RunStopInput, an as RunTurn, ao as STEP_MESSAGE_ROLE, ap as SUBAGENT_OF_META_KEY, aq as SavingsBreakdown, ar as SavingsBySource, as as SavingsSourceKey, at as ServedRead, au as SpendBreakdown, av as StreamInterruptedError, aw as SubagentOrigin, ax as TextContentPart, ay as ToolExposure, az as TransportError, aA as UNBACKED_TICKET_CLAIM_NOTICE, aB as UNBACKED_WRITE_CLAIM_NOTICE, aC as USAGE_SURFACES, aD as USAGE_SURFACE_HEADER, aE as UpstreamTurnEvidence, aF as accountUsedInTrace, aG as activityTarget, aH as askStopHook, aI as attachEvermindLearn, aJ as buildBrainTriageReport, aK as byoReasonHint, aL as byoUnresolvedInTrace, aM as byoUnresolvedSummary, aN as chatConversationDirective, aO as chatModeDirective, aP as chatRosterFromParticipants, aQ as chatWorkDirective, aR as clearPendingWords, aS as computeBrainDiagnostics, aT as computeRunProgress, aU as contextWindowOf, aV as describeLiveStep, aW as detectAnnouncedButUnmadeToolCall, aX as detectUnbackedTicketClaim, aY as detectUnbackedWriteClaim, aZ as effortProfile, a_ as formatBrainDiagnostics, a$ as formatBrainProvenance, b0 as formatBytes, b1 as formatDispatchRefusals, b2 as formatEvermindLearnStep, b3 as formatModelScorecard, b4 as formatModelTurnLog, b5 as formatStaffingSummary, b6 as hasEditIntent, b7 as isChatMode, b8 as isDispatchTool, b9 as isEffort, ba as isEvermindModel, bb as isFailedToolResult, bc as isMutationTool, bd as isStepMessage, be as isTicketWriteTool, bf as isUsageSurface, bg as localFallbackTrace, bh as midRunNotice, bi as modelFailoversInTrace, bj as modelScorecard, bk as modelTurnLog, bl as modelsUsedInTrace, bm as narratedUnadvertisedInTrace, bn as normalizeChatMode, bo as parseByoUnresolved, bp as parseSubagentOrigin, bq as projectMemoryHooks, br as reasoningForRun, bs as resolveContextWindow, bt as savedChatOf, bu as serverChatIdOf, bv as setPendingWordsOwner, bw as shortenTarget, bx as staffingSummaryInTrace, by as stallRecoveriesInTrace, bz as stallUnrecoveredInTrace, bA as streamChatCompletion, bB as summarizeLocalFirstAttempt, bC as toolActivity, bD as toolExposureInTrace, bE as workFiledNotStaffedVerdict } from './pendingWords-Bbt7S360.js';
import { SummaryCompletion } from '@seanhogg/builderforce-memory/working';
export { CONSOLIDATION_MARKER_PREFIX, CONSOLIDATION_META, ConsolidationMarkerMeta, HISTORY_TOKEN_BUDGET, consolidationMarkerContent, consolidationMarkerOf, consolidationMetadata, isConsolidationMarker, lastConsolidationIndex, scopeToConsolidation } from '@seanhogg/builderforce-memory/working';
import { L as LocalRuntimeId, a as LocalRuntimeProbe, b as LocalEndpoint } from './probe-BF7uUc_H.js';
import { DeltaLearnPayload, LocalSuccessOutcome } from '@seanhogg/builderforce-memory-engine';
import { L as LocalBackend, a as LocalModelUnfit, P as PageEngine, B as BfiWorkerEngineOptions, H as HfModelStore } from './bfiWorkerEngine-DOi_Ny7_.js';
export { b as BfiEngineInstance, c as BfiEngineStatic, d as BfiModelInfo, e as BfiModule, f as BfiWorkerEngine, C as ChatCompletionChunk, g as ChatCompletionsRequest, E as ENGINE_WORKER_FATAL, h as ENGINE_WORKER_IDLE_MS, i as ENGINE_WORKER_INVALIDATE, j as EngineWorker, k as EngineWorkerEndpoint, l as EngineWorkerEvents, m as EngineWorkerHandle, n as EngineWorkerOptions, o as PAGE_ENGINE_REPLY_TYPES, p as PAGE_ENGINE_REQUEST_TYPES, q as PageEngineClient, r as PageEngineClientOptions, s as PageEngineError, t as PageEnginePort, u as PageEngineReply, v as PageEngineRequest, w as PageEngineServerIo, W as WorkerLike, x as createBfiWorkerEngine, y as createEngineWorker, z as createPageEngineClient, A as isPageEngineReply, D as isPageEngineRequest, F as isWasmTrap, G as serveEngineWorker, I as servePageEngines } from './bfiWorkerEngine-DOi_Ny7_.js';
import { LimbicState } from '@seanhogg/builderforce-memory-engine/limbic';
export { LimbicState } from '@seanhogg/builderforce-memory-engine/limbic';
import { HandoffPack } from '@seanhogg/builderforce-memory/handoff';
import { EvermindRecallResult } from '@seanhogg/builderforce-memory/evermind';
export { EvermindRecallItem, EvermindRecallResult, countReconciledMemories, formatEvermindMemoryBlock } from '@seanhogg/builderforce-memory/evermind';
import { ChatErrorAction } from './chatError.js';
export { BrainRequestError, ChatErrorActionKind, LOCAL_ENGINE_FAILURE_CODES, LocalEngineFailureCode, NOT_SIGNED_IN, NO_LOCAL_MODEL, NO_SPECIFIC_MODEL, PlatformRefusedCapability, brainRequestError, chatErrorAction } from './chatError.js';

/**
 * THE INFERENCE MODE — what a person chooses about where models run, on every host
 * (the web app, Rovr, the VS Code extension). The eight platform capabilities stay as
 * ADVANCED overrides; the mode is what people see, and it derives the capabilities.
 *
 *   - `local-only` — never reaches the gateway: inference, connected features, sync and
 *     direct providers are off whatever an override says (the promise the mode makes).
 *   - `hybrid`     — local first, then the gateway's Auto route (the gateway itself puts
 *     the free tier first). A picked model runs FIRST, never hard-pinned: if it fails,
 *     the turn falls back to the local engine and then Auto. Connected features on; sync
 *     per its own setting.
 *   - `specific`   — exactly the person's pick (a cloud model, the BYO pool, Kimi Code, or
 *     one local model), hard-pinned: no local attempt, no fallback; no pick is an error
 *     (`no_specific_model`), never a silent Hybrid. Gateway inference AND direct providers on.
 *
 * A pick moves the mode with it (brain-embedded `inferenceModeForModelPick`): picking a
 * model selects Specific, so the model picked is the model that runs; Auto returns to Hybrid.
 * What each mode does with a pick is brain-embedded's `createHostModelStream`.
 *
 * Default: `hybrid` once signed in, `local-only` signed out. A host persists only the
 * person's explicit choice; an unset mode is re-derived, so signing in moves an
 * undecided person onto Hybrid and their heartbeat / assigned work / insights keep
 * working.
 *
 * Pure — no storage, no host.
 */

type InferenceMode = 'local-only' | 'hybrid' | 'specific';
/** Every mode, in the order a control lists them (the recommended one first). */
declare const INFERENCE_MODES: readonly InferenceMode[];
declare function isInferenceMode(value: unknown): value is InferenceMode;
/** The mode a person who never chose runs in. */
declare function defaultInferenceMode(context: {
    signedIn: boolean;
}): InferenceMode;

type ClientEntityId = string;
type LocalEntityType = 'project' | 'ticket' | 'chat' | 'message' | 'execution' | 'step' | 'approval' | 'audit-definition' | 'audit-run' | 'audit-finding' | 'change-set' | 'memory-fact' | 'attachment-manifest' | 'policy-snapshot' | 'remediation'
/** One model call's token usage on this device (PRD 36 run usage ledger). */
 | 'usage'
/** How one run ended on this device (succeeded / failed / stopped / budget-contained),
 *  keyed by its run id — read by the pipeline route report. Local only, never synced. */
 | 'run-outcome';
interface DestinationBinding {
    platformInstance?: string;
    accountId?: string;
    tenantId?: string;
    projectId?: string;
    repository?: string;
}
type EntityDestination = {
    kind: 'unbound';
} | ({
    kind: 'bound';
} & DestinationBinding);
interface LocalRecord<T = unknown> {
    id: ClientEntityId;
    entityType: LocalEntityType;
    schemaVersion: number;
    version: number;
    baseVersion?: number;
    destination: EntityDestination;
    occurredAt: string;
    updatedAt: string;
    deletedAt?: string;
    payload: T;
    provenance?: {
        actorId?: string;
        deviceId: string;
        source: 'local' | 'imported';
        /**
         * Trust label. `client-reported` is what a client claimed; `server-observed`
         * is what the platform saw. Optional because records written before the label
         * existed carry none, and an absent label reads as "not client-reported" —
         * it is never upgraded to one.
         */
        evidence?: 'client-reported' | 'server-observed';
        policyVersion?: string;
        auditVersion?: string;
        modelVersion?: string;
        sequence?: number;
    };
}
type JournalOperation = 'create' | 'update' | 'delete' | 'import';
interface JournalEvent<T = unknown> {
    /** Wire id — a UUID minted by the store at append; the server's idempotency key. */
    eventId: string;
    /**
     * The caller's name for this logical write (`ticket:<id>:v1`, `fact:<id>:<v>`).
     * Dedupes a double-enqueue while the event is pending. Not a wire id.
     */
    idempotencyKey?: string;
    clientEntityId: ClientEntityId;
    entityType: LocalEntityType;
    operation: JournalOperation;
    schemaVersion: number;
    localSequence: number;
    occurredAt: string;
    baseVersion?: number;
    dependsOn: string[];
    destination: EntityDestination;
    payload: T;
    payloadHash: string;
    deadLetter?: {
        reason: string;
        at: string;
    };
}
interface ServerMapping {
    destination: EntityDestination;
    entityType: LocalEntityType;
    clientEntityId: ClientEntityId;
    serverId: string;
    serverVersion: number;
}
interface SyncReceipt {
    eventId: string;
    status: 'accepted' | 'duplicate' | 'conflict' | 'rejected' | 'dependency_pending';
    receivedAt: string;
    serverId?: string;
    serverVersion?: number;
    detail?: string;
}
interface SyncConflict {
    id: string;
    clientEntityId: ClientEntityId;
    entityType: LocalEntityType;
    local: LocalRecord;
    remote: LocalRecord;
    reason: string;
    createdAt: string;
    resolvedAt?: string;
}

interface LocalFirstTransaction {
    get<T = unknown>(entityType: LocalEntityType, id: string): Promise<LocalRecord<T> | undefined>;
    list<T = unknown>(entityType?: LocalEntityType): Promise<LocalRecord<T>[]>;
    put<T>(record: LocalRecord<T>, expectedVersion?: number): Promise<void>;
    /**
     * Remove one local row. A pull tombstone calls this instead of `put`: writing
     * the row back would resurrect the entity the server deleted. Returns whether
     * a row was present. A missing row is not an error — the delete already won.
     */
    delete(entityType: LocalEntityType, id: string): Promise<boolean>;
    /**
     * Enqueue one journal event. The store MINTS the wire `eventId` (a UUID — the
     * server's `(tenant, device, event)` key). Callers name the logical write with
     * `idempotencyKey` (e.g. `ticket:<id>:v1`): a second append with a key that is
     * still pending returns the first event instead of enqueueing twice, and a
     * `dependsOn` entry naming a pending key is rewritten to that event's id.
     */
    append<T>(event: AppendJournalEvent<T>): Promise<JournalEvent<T>>;
    pending(destination?: EntityDestination): Promise<JournalEvent[]>;
    acknowledge(eventIds: readonly string[]): Promise<void>;
    putMapping(mapping: ServerMapping): Promise<void>;
    mapping(entityType: LocalEntityType, clientEntityId: string, destination: EntityDestination): Promise<ServerMapping | undefined>;
    putReceipt(receipt: SyncReceipt): Promise<void>;
    putConflict(conflict: SyncConflict): Promise<void>;
    conflicts(): Promise<SyncConflict[]>;
    setCursor(destination: EntityDestination, cursor: string | undefined): Promise<void>;
    cursor(destination: EntityDestination): Promise<string | undefined>;
}
/**
 * What `append` takes. `eventId` is optional and kept only when it is already a
 * UUID (a replayed wire event); any other value is a legacy composite id and is
 * treated as the `idempotencyKey`.
 */
type AppendJournalEvent<T = unknown> = Omit<JournalEvent<T>, 'localSequence' | 'payloadHash' | 'eventId' | 'idempotencyKey'> & {
    eventId?: string;
    idempotencyKey?: string;
    payloadHash?: string;
};
interface LocalFirstSnapshot {
    records: LocalRecord[];
    events: JournalEvent[];
    mappings: ServerMapping[];
    receipts: SyncReceipt[];
    conflicts: SyncConflict[];
    cursors: Record<string, string>;
    nextSequence: number;
}
interface LocalFirstStore {
    read<R>(work: (transaction: LocalFirstTransaction) => Promise<R>): Promise<R>;
    transact<R>(work: (transaction: LocalFirstTransaction) => Promise<R>): Promise<R>;
    export(): Promise<LocalFirstSnapshot>;
    subscribe(listener: () => void): () => void;
}

/**
 * Per-token PRICE — the input the router needs to compare models by what a call will
 * actually cost, BEFORE it is dispatched (the ledger prices it again, after, from the
 * provider's reported usage).
 *
 * Units are USD per token, the unit upstream catalogs publish, so a price book built
 * from them needs no conversion and the ledger and the router read the same number.
 */
/**
 * A LONG-CONTEXT price tier: once a request's input exceeds `aboveInputTokens`, the
 * WHOLE request (input and output) bills at these rates — how Google and Anthropic
 * both price their long-context bands. USD per token, like {@link ModelPrice}.
 */
interface PriceTier {
    aboveInputTokens: number;
    input: number;
    output: number;
}
interface ModelPrice {
    /** USD per input (prompt) token. */
    input: number;
    /** USD per output (completion) token. */
    output: number;
    /** Long-context tiers, ascending by boundary (cost PRD C9). Absent = flat price. */
    priceTiers?: readonly PriceTier[];
}

/**
 * The PRICE BOOK port — "what does this model cost per token" — and the id rules every
 * host prices a routed model by. The gateway binds it to its live provider catalog
 * (`api/.../catalogView.ts`); a device binds it to the snapshot shipped in this package
 * (`snapshotPriceBook`), so a figure priced offline and one priced by the ledger read the
 * same ids the same way. A reader of the book never knows which one it holds.
 */

interface PriceBook {
    priceOf(model: string): ModelPrice | undefined;
    /**
     * The LIST price used to value a call someone else paid for (a BYO key's spend, the
     * tokens memory kept off a call): `priceOf`, then a direct-vendor id
     * (`direct/minimax/MiniMax-M2.7`) matched to the catalog's `minimax/minimax-m2.7`.
     * Never used for billing — what the platform charges stays on `priceOf`.
     */
    listPriceOf?(model: string): ModelPrice | undefined;
}

/** The host's caps. Omitted fields take the defaults above. */
interface ImagePrepOptions {
    /** Long-edge ceiling in px. */
    maxEdge?: number;
    /** First JPEG/WebP quality tried, 0.3–1. */
    jpegQuality?: number;
}
/** What to do with one picture. */
type ImageEncodeDecision = 
/** Send the original bytes — a GIF, or an image already inside both caps. */
{
    kind: 'keep';
}
/** Draw it (scaled to fit) and encode as `mime`, walking `qualities`. `matte`: paint
 *  white under it first (JPEG has no alpha). */
 | {
    kind: 'encode';
    mime: 'image/jpeg' | 'image/webp';
    qualities: number[];
    matte: boolean;
};
interface PreparedImage {
    /** Inline `data:` URL when the image fits the budget. */
    dataUrl?: string;
    /** True when even the most-compressed encode exceeded the inline budget —
     *  the caller should upload and mint a signed URL instead. */
    tooLarge?: boolean;
    /** The re-encoded picture, when one was produced — what the caller uploads in place of
     *  the original (absent when the original was kept as it is). */
    file?: File;
}
/**
 * Prepare an image for an inline vision content part. Resolves with a `dataUrl`
 * when it fits the inline budget, `{ tooLarge: true }` when it doesn't even
 * after max compression, or `null` for non-raster / non-DOM inputs. `file` carries the
 * re-encoded picture when one was produced.
 */
declare function prepareImageDataUrl(file: File, opts?: ImagePrepOptions): Promise<PreparedImage | null>;

/**
 * The vocabulary a catalog row is described in — what a model is FOR, and the shape of
 * one generated WebLLM entry. Its own module so the generated data
 * (`webllmCatalog.generated.ts`) and the hand-written catalog (`catalog.ts`) share one
 * contract without importing each other's values.
 */
/** What a model is good at. A picker groups by it; the engines filter on it. */
declare const LOCAL_MODEL_USES: readonly ["chat", "coding", "reasoning", "math", "vision", "embedding"];
type LocalModelUse = (typeof LOCAL_MODEL_USES)[number];

/**
 * The models a PAGE engine can offer — one row per model, as DATA.
 *
 * An HTTP runtime tells the probe what it serves; a page engine serves only what the page
 * has downloaded, and what it COULD download has to be written down somewhere. This is
 * that list. The picker renders it, `localModelFit` checks it against the device, the
 * download manager reads its `source`, and each engine's probe reports the rows it finds
 * in its cache — so adding a model is one row here, never a branch in a host.
 *
 * Sizes and windows are the publishers' own: the Bonsai rows from the GGUF files on
 * Hugging Face (`prism-ml/Bonsai-<N>-gguf`, `siblings[].size`) and their model cards. The
 * WebLLM rows are GENERATED from the installed `@mlc-ai/web-llm`'s `prebuiltAppConfig`
 * (`scripts/gen-webllm-catalog.mjs` → `webllmCatalog.generated.ts`, held by a guard), so
 * a library bump is a regenerate, never a hand-edited row.
 * `tools` is true ONLY where the engine honours `tools`: every model on `bfi` (it
 * grammar-constrains the call), and on WebLLM only the builds its
 * `functionCallingModelIds` lists.
 */

/** Where a model's weights come from — the download manager's whole instruction. */
type LocalModelSource = 
/** One file the host streams from `https://huggingface.co/<repo>/resolve/main/<file>`
 *  into its own cache (the `bfi` engine loads it from there). */
{
    kind: 'hf-file';
    repo: string;
    file: string;
}
/** A WebLLM prebuilt — WebLLM downloads and caches it itself. */
 | {
    kind: 'webllm';
    modelId: string;
};
interface LocalCatalogModel {
    /** The full `local/<runtime>/<model>` ref. */
    ref: string;
    runtime: LocalRuntimeId;
    /** The bare id the engine knows. */
    model: string;
    /** Picker label — a model name, so not localized. */
    label: string;
    /** Model family, for grouping (`bonsai`, `qwen3`, `llama-3.2`, `hermes-3`). */
    family: string;
    /** Parameter count. */
    params: number;
    /** Download size in bytes (what the picker shows and Cache Storage will hold). */
    bytes: number;
    /** The window the model was TRAINED for. What an engine actually serves can be
     *  smaller — `bfi` sizes its KV cache to the device (see `kv`). */
    contextTokens: number;
    /** The attention shape `bfi` sizes its KV cache from (`BfiEngine.contextFor`), so a
     *  probe reports the context the device will SERVE, not the trained one. */
    kv?: {
        layers: number;
        kvHeads: number;
        headDim: number;
    };
    /** May take a TOOL turn on this engine. */
    tools: boolean;
    /** What the model is for — a picker groups by it, the engines filter on it. */
    uses: readonly LocalModelUse[];
    /** On the curated short list a picker shows before "All models". */
    recommended: boolean;
    source: LocalModelSource;
    requires: {
        /** Needs the WebGPU `shader-f16` feature. */
        f16?: boolean;
        /** The largest single GPU buffer binding the model needs. */
        minBufferBytes: number;
        /** GPU memory the engine reports the model needs (weights + KV + workspace). WebGPU
         *  exposes no VRAM figure, so `localModelFit` treats it as advisory. */
        vramBytes?: number;
        /** May run on the engine's CPU backend (no GPU) on a device with at least this much
         *  RAM. Absent = WebGPU only. */
        cpu?: {
            minDeviceMemoryBytes: number;
        };
    };
}

/**
 * How a picker lays the page-engine catalog out — the ONE rule every host's on-device
 * list renders (the web composer, the editor's webview, Rovr's side panel all reach it
 * through brain-ui's `LocalModelList`).
 *
 * Eighty-odd downloadable builds is a catalog, not a menu. So a picker shows the curated
 * rows first, grouped by what they are for, and keeps the rest behind "All models":
 *  - only CHAT rows are offered (`isLocalChatModel`): embedding builds feed the embedder,
 *    vision-only builds wait for image input;
 *  - a row this device cannot run is HIDDEN from the sections — a caller passes `fits`,
 *    and the hidden rows come back (behind "All models", each with its reason, and for
 *    the "nothing runs here, because …" notice);
 *  - a row the person already has (downloaded, downloading, pinned) is ALWAYS listed in
 *    its group — even when this device cannot run it, so it shows why and can still be
 *    removed — a caller passes `pinned`.
 *
 * Generic over the row type so a host's richer row (brain-embedded's `LocalModelRow`,
 * with its download state) passes through untouched. Pure.
 */

/** A picker section. `tools` gathers the rows that may take an agent (tool) turn. */
declare const LOCAL_PICKER_GROUPS: readonly ["tools", "chat", "coding", "reasoning", "math"];
type LocalPickerGroup = (typeof LOCAL_PICKER_GROUPS)[number];
type LocalPickerRow = Pick<LocalCatalogModel, 'uses' | 'recommended' | 'tools'>;
interface LocalPickerView<T> {
    /** The curated (and pinned) rows by section, in `LOCAL_PICKER_GROUPS` order; empty
     *  sections omitted. */
    groups: Array<{
        group: LocalPickerGroup;
        rows: T[];
    }>;
    /** Every other offered row, catalog order — behind "All models". */
    more: T[];
    /** Chat rows refused by `fits` that the person does not hold — listed behind "All
     *  models" with their reason, and for the "nothing runs here, because …" notice. */
    hidden: T[];
}
interface LocalPickerOptions<T> {
    /** Can this device run the row? Default: every row fits. */
    fits?: (row: T) => boolean;
    /** Lift the row out of "All models" (already downloaded, downloading, or pinned). */
    pinned?: (row: T) => boolean;
}
declare function localPickerView<T extends LocalPickerRow>(rows: readonly T[], options?: LocalPickerOptions<T>): LocalPickerView<T>;

/**
 * The visit tally behind the CIRCLING-read guard: how many times a run has gone back to
 * one target, with which argument sets, and whether something with an unknown blast
 * radius ran in between (so the next re-read is fetching news, not circling).
 *
 * One tally, two hosts: the in-memory read guard (`ReadCoverage`, the browser Brain and
 * the VS Code loop) and the durable progress detector (`ProgressDetector`, the cloud
 * loop), which persists it between steps — so its state is plain JSON.
 */
/** Visits to one target before the model is told it is circling. Two reads of a long
 *  file is ordinary (read the top, jump to the section); the THIRD is the point where a
 *  pass stops being navigation and starts being a loop. */
declare const REVISIT_NUDGE_AT = 3;
/** Visits after which the advisory escalates from a reminder to an instruction. By the
 *  fifth read of one file the gentle version has demonstrably not worked. */
declare const REVISIT_HARD_AT = 5;
interface ReadVisit {
    /** How many times this target has now been read, including this call. */
    count: number;
    /** The distinct argument sets already used against it, oldest first, capped. */
    priorArgs: string[];
    /**
     * Something with an UNKNOWN blast radius (a shell command, a merge, an undo) ran
     * between the previous read of this target and this one, so this read may well be
     * returning different bytes. The advisory stays silent for it — re-reading after a
     * build or a codemod is exactly the right move — but the COUNT still stands, so a
     * model circling one file across three `run_command`s is still caught on the next read.
     */
    mayHaveChanged: boolean;
}
/**
 * The advisory to attach to a read result once a target has been visited enough times
 * to look like circling. Null below the threshold — the overwhelming majority of reads
 * carry nothing extra.
 *
 * Written as a diagnosis plus a next move, not a scolding: a model told only "you are
 * repeating yourself" tends to repeat itself apologetically. It is told what it has
 * already been given, why looking again will not help, and which of the two things it
 * should do instead — page FORWARD through the rest of the file from the offset its
 * last result named, or act on what it has.
 */
declare function revisitAdvisory(tool: string, target: string, visit: ReadVisit): string | null;
/**
 * Attach an advisory to a tool result without disturbing its shape. Object results gain
 * a `note` field (the same channel the tools' own guidance uses, so the model meets one
 * convention rather than two); anything else is wrapped so the original value survives
 * intact under `result`.
 */
declare function withAdvisory(result: unknown, advisory: string): unknown;

/**
 * The loop-breaker for re-reading.
 *
 * Three guards, one tally:
 *
 * 1. The EXACT repeat — same tool, same arguments. The run loop answers it with a stub
 *    telling the model to reuse the earlier result.
 *
 * 2. The CIRCLING read — seven DIFFERENT `read_file` calls shuffling a window up and
 *    down one 566-line file until the tool budget is gone and the one-line change the
 *    user asked for is never made. The exact-repeat guard stays silent for all of them;
 *    the visit tally ({@link VisitTally}) is what sees it.
 *
 * 3. The COVERED window — fourteen `read_file`s at shifting offsets (1050, 1080, 1105…)
 *    that all sat inside a window the run had already returned. An overlapping window is
 *    an exact-repeat in disguise: those lines are already above. The loop stubs (or
 *    replays from cache once compaction has dropped the original) and tells the model to
 *    page FORWARD. A jump to uncovered lines, and a page past a truncated window, still run.
 *
 * All three share the one question that decides whether they are still valid: "did
 * something just change what a re-read would see?" — answered once, by {@link
 * ReadCoverage.invalidate}.
 *
 * WHICH tools change what, and what a call is ABOUT, is the host's vocabulary (its tool
 * names, its shell classifier), so it arrives as {@link ReadCoverageTraits}; the rules
 * here are the same on every host. Pure: no clock, no I/O.
 */

/** The host's tool vocabulary, as the read guard needs it. */
interface ReadCoverageTraits {
    /** What a call VISITED — its target plus the question asked of it (`scope ∋ query`). */
    visitTarget(args: unknown): string | undefined;
    /** The bare target a call names (a path, a command, a query). */
    activityTarget(args: unknown): string | undefined;
    /** Joins a scope to the question asked of it in a {@link visitTarget}. */
    questionSeparator: string;
    /** Could this call have changed ANY file, unnamed (a shell command, a tree-rewriting git tool)? */
    isUnscopedMutation(tool: string, args: unknown): boolean;
    /** A file write / edit / delete. */
    isCodeChangeTool(tool: string): boolean;
    /** A tool that acts on the local workspace (not a platform / MCP call). */
    isLocalWorkspaceTool(tool: string): boolean;
    /** A local tool that PUBLISHES work (commit / push / open a PR). */
    isRepoPublishTool(tool: string): boolean;
    /** A host read of repository STATE (branches, PRs) that a publish moves. */
    isRepoStateReadTool(tool: string): boolean;
}
/**
 * What a successful read RETURNED, kept so an exact repeat can be answered from memory —
 * the "already above you" stub stops being true the moment compaction summarizes that
 * result away. `anchor` is the transcript message the result was handed to the model in
 * (opaque here; the run loop decides whether that message is still in the working context).
 */
interface CachedRead {
    /** The tool's UNTRIMMED result, kept only for the REPLAY — which serves the requested
     *  window from it and re-trims that to the budget. Never what coverage reasons from. */
    result: unknown;
    /**
     * What the model was actually SERVED (the trimmed window, before any advisory) — the
     * only honest answer to "which lines has it seen?". Coverage reads this; absent, the
     * result is taken as served whole (a host that does not trim).
     */
    served?: unknown;
    anchor: unknown;
}
/** What {@link ReadCoverage.coveredRead} hands the loop. */
interface CoveredRead {
    /** Inclusive first line of the request (after EOF clip). */
    start: number;
    /** Inclusive last line of the request (after EOF clip). */
    end: number;
    /** The covering read's cache — replay this when compaction dropped the original. */
    cached: CachedRead | null;
    /** The note the model should read instead of another copy of those lines. */
    note: string;
}
/**
 * Per-run tally of which reads have been made, which targets they were about, and how
 * often. One instance per run; the run loop owns it and drops it when the run ends.
 */
declare class ReadCoverage$1 {
    private readonly traits;
    private readonly visits;
    /** Successful reads by `${tool}:${canonical args}` — the exact-repeat guard. */
    private readonly exact;
    constructor(traits: ReadCoverageTraits);
    private static exactKey;
    /** Was this visit ABOUT `target` — the target itself, or a question asked of it? */
    private visitedScopeIs;
    /** Has this exact read already SUCCEEDED this run, with nothing since that could have changed its answer? */
    isRepeat(tool: string, args: unknown): boolean;
    /** Keep what a SUCCESSFUL read returned, with the message that carried it. A no-op for
     *  a read that was never recorded (a failure has nothing to replay). */
    cacheResult(tool: string, args: unknown, cached: CachedRead): void;
    /** The cached result of an exact earlier read, or null when none is held. */
    cachedResult(tool: string, args: unknown): CachedRead | null;
    /**
     * Record a SUCCESSFUL read. Arms the exact-repeat guard for it, and returns the
     * resulting target visit — or null when the call names no target.
     */
    record(tool: string, args: unknown): ReadVisit | null;
    /**
     * A non-read call has run. Forget exactly the reads it could have changed — no more,
     * no less — for every guard:
     *
     * - An unscoped mutation (shell, merge, undo) forgets every cached ANSWER, and marks
     *   every target so its NEXT read is excused — but keeps the visit COUNT: the tally
     *   counts the model's behaviour, which a build in between does not change.
     * - A file write/edit/delete forgets its own target across every tool that reads it,
     *   plus every tree-wide answer; nothing about other files.
     * - A local tool that PUBLISHES work forgets the platform reads and the repo-state
     *   reads, and keeps the file reads.
     * - The remaining local tools change nothing a read observes.
     * - Anything else is a platform / MCP call: it forgets target-less platform reads.
     */
    invalidate(tool: string, args: unknown): void;
    /**
     * Answer a `read_file` whose window is already inside an earlier successful window of
     * the SAME file. Null for a jump to lines the earlier read did not return, and for a
     * page that extends past a truncated window — those still need the disk.
     */
    coveredRead(tool: string, args: unknown): CoveredRead | null;
    /**
     * Answer a `search_code` from a WIDER complete search already held (same query, an
     * ancestor scope), filtered to the narrower `path`. A derived 0 is never returned — a
     * parent's 0 may be a false negative, and the tool treats `truncated:false` as proof
     * of absence — so the narrower search must actually run.
     */
    derivedSearch(tool: string, args: unknown): Record<string, unknown> | null;
}

/** A `run_command` whose every segment only reads — `git log`, `ls`, a `for` loop of `git rev-list`. */
declare function isReadOnlyShellCall(tool: string, args: unknown): boolean;

/** Identical failures before the model is told it is repeating itself. The first retry is free. */
declare const FAILURE_NUDGE_AT = 2;
/** Identical failures after which the advisory stops asking and starts instructing. */
declare const FAILURE_HARD_AT = 3;
/** The persisted form: `[fingerprint, attempts]` pairs. */
type FailureTallyState = Array<[string, number]>;
/** Per-run tally of which exact calls have FAILED, and how often. */
declare class FailureTally {
    private readonly failures;
    constructor(state?: FailureTallyState);
    /** Record a FAILED call. Returns how many times this exact call has now failed, including this one. */
    record(tool: string, args: unknown): number;
    /** This exact call SUCCEEDED: its earlier failures were transient after all. */
    clear(tool: string, args: unknown): void;
    /** Forget every recorded failure (the run changed course). */
    reset(): void;
    snapshot(): FailureTallyState;
}
/** The error text a failed tool result carries, bounded — quoted back to the model so
 *  the advisory argues from the answer it already got. */
declare function failureReason(result: unknown): string | undefined;
/**
 * The advisory to attach to a failed tool result once the identical call has failed
 * enough times to be a loop rather than a retry. Null below the threshold.
 */
declare function repeatedFailureAdvisory(tool: string, attempts: number, reason?: string): string | null;

/**
 * Consecutive identical calls ({@link callFingerprint}) at which a back-to-back streak
 * becomes a verdict on its own. Two in a row is a retry; three is the model asking the
 * same question a third time after hearing the same answer twice, whatever the rest of
 * the run looks like. Shared by the post-hoc run report and the live guards.
 */
declare const BACK_TO_BACK_AT = 3;

/** Structural mirror of the runtime's PsychometricProfile (vector + optional skins). */
interface PsychProfile {
    vector?: Record<string, number>;
    enneagramType?: number;
    mbti?: string;
}

/**
 * Deterministic JSON — object keys sorted at every depth — for anything KEYED on a
 * value whose key order is incidental: a tool call's arguments, a cache key's request
 * fields, a trace fingerprint. Two values a caller means identically (`{path, offset}`
 * vs `{offset, path}`) must produce one string; `JSON.stringify` keeps insertion order,
 * so it cannot.
 *
 * JSON-faithful for JSON values: an object entry whose value is `undefined` is dropped
 * (as `JSON.stringify` drops it), a top-level `undefined` reads as `null`. Values JSON
 * cannot express still get a stable, distinct form instead of collapsing: a non-finite
 * number and a bigint as their string, an `Error` as its name/message/stack, bytes as
 * their numbers.
 *
 * NOT for fingerprints that are stored and later re-compared (boardsync content
 * hashes, sandbox verification stamps) — those keep `domain/shared/stableStringify`'s
 * format until their stored hashes are migrated.
 *
 * Pure and dependency-free (this package's root is imported by the Worker).
 */
declare function stableStringify(value: unknown): string;

/**
 * The confirm CHIP's wire shape (docs/design/deterministic-prefetch.md: "write actions
 * never auto-run"). A write action is confirmed through the run's ONE human-in-the-loop
 * channel — the run cell's `pendingConfirm`, answered by `resolveRunConfirm` and declined
 * by Stop — not a second channel of its own. This is the request it raises there, and
 * the reading every surface uses to render it as the PreFetch confirm chip (brain-ui's
 * `PrefetchConfirmChip`) instead of the generic tool bar.
 *
 * The request names the action (`name` = its id) so a surface that predates the chip still
 * shows a readable "Run lint.fix?" rather than nothing. Pure.
 */

/** A pending PreFetch confirmation, as a surface renders it. */
interface PrefetchConfirm {
    actionId: string;
    labelKey: string;
    request: string;
    detail?: string;
}
/** The PreFetch confirmation a pending confirm is, or null for any other (a tool call). */
declare function prefetchConfirmOf(pending: {
    name: string;
    args: unknown;
} | null | undefined): PrefetchConfirm | null;

/**
 * The claim on a chat's NEXT run - the one primitive that closes every window between "a run
 * ended" (or "a turn was handed to an idle chat") and "the next run is going".
 *
 * A continuation (`continueChat.ts`) has to save words, wait for the host's run-time parts, and only
 * then start - three awaits. Without a claim the chat looks idle across them: a person's message
 * launches a second run, a Stop is outrun, two continuations start two runs, and `startRun`'s
 * single-flight guard silently drops whichever lost. With the claim, taken SYNCHRONOUSLY before the
 * first await:
 *
 *  - the cell counts as LIVE (`isLive`), so every composer steers a person's message into the
 *    claimed run's inbox (it is read by the continuation run) instead of launching or holding it;
 *  - no other launch can take the chat (`startRun` refuses a start that does not hold the claim);
 *  - a Stop - on an idle cell too (`RunCell.stopEpoch`) - is seen at each await boundary
 *    (`claimStopped`): the saved rows stay, nothing starts, the claim is released;
 *  - a run started UNDER the claim consumes it (`beginRun`); every other exit releases it.
 */

interface RunClaim {
    /** The chat's Stop count when the claim was taken. */
    readonly epoch: number;
}

/**
 * The Brain's binding of the shared read guard (`@builderforce/run-guards`).
 *
 * The rules — exact repeat, circling read, covered window, and the one `invalidate`
 * that decides what a non-read call forgets — live once in the package, shared with the
 * cloud loop's progress detector. What is the Brain's own is its tool VOCABULARY: which
 * tools touch the local workspace, which publish, which shell commands provably only
 * read, and what a call is about. Those are bound here, so every caller keeps
 * `new ReadCoverage()`. The package's own helpers (advisories, thresholds, types) are
 * imported from `@builderforce/run-guards` directly — this file re-exports none of them.
 */

/** Per-run read guard bound to the Brain's tools. One instance per run. */
declare class ReadCoverage extends ReadCoverage$1 {
    constructor();
}

/**
 * The run store's OBSERVE-AND-CONTROL surface — everything a mounted view, a run driver
 * or a tool that waits calls on a chat's run cell: subscribe and read the snapshot,
 * Stop, clear the error, answer a confirmation, mirror a run executing elsewhere.
 * Starting a run is `startRun.ts`; the loop itself is `runLoop.ts`.
 */

/**
 * Drop all run state. For tests/teardown only — there's no per-chat eviction in
 * normal operation (transcripts are session-lived grounding, as before).
 */
declare function resetBrainRunStore(): void;
/**
 * Subscribe to ANY run-state change across all chats (a run starting, finishing,
 * or pausing on a confirm — in any chat, mounted or not). Returns an unsubscribe
 * fn. Pair with {@link getGlobalRunState} to render a cross-chat live indicator.
 */
declare function subscribeRunStore(listener: () => void): () => void;
/**
 * Which chats are live right now, split into actively-executing (`running`) and
 * paused-on-a-confirm (`awaiting`). Disjoint: a chat paused on a confirm is in
 * `awaiting` only. Recomputed from the current cells on each call — cheap (a scan
 * of the bounded cell map); callers debounce via a stable key of the two lists.
 */
declare function getGlobalRunState(): GlobalRunState;
/** Subscribe to a chat's run state. Returns an unsubscribe fn. */
declare function subscribeRun(chatId: RunKey, listener: () => void): () => void;
/**
 * The cancel signal of a chat's IN-FLIGHT run, or undefined when nothing is running.
 *
 * Exists for the same reason {@link requestRunConfirm} is callable from outside the
 * cell: work the run starts that is not the loop itself — a delegated sub-agent running
 * its own nested loop inside one tool call — must stop when the user presses Stop, and
 * the controller is created by {@link startRun}, after the host has already assembled the
 * catalog that carries that tool. So the tool reads it at CALL time, by chat.
 */
declare function runAbortSignal(chatId: RunKey): AbortSignal | undefined;
/**
 * Splice a message persisted OUTSIDE the loop into a chat's live view — a delegated
 * child's report, posted while its parent run is still going. Persisting alone put it in
 * the chat store, but the panel showed it only after a reload: mounted views merge the
 * run's `appended` buffer, and nothing had told the buffer.
 */
declare function appendRunMessage(chatId: RunKey, msg: BrainMessage): void;
/** Current snapshot (referentially stable until something changes). */
declare function getRunSnapshot(chatId: RunKey | null): BrainRunSnapshot;
declare function isRunning(chatId: RunKey | null): boolean;
/** Running, or about to be (a continuation holds the claim): the chat is not free to launch another run. */
declare function isLive(chatId: RunKey | null): boolean;
/** The accumulated execution trace for a chat (for the capture/triage report). */
declare function getRunTrace(chatId: RunKey | null): BrainTraceEvent[];
/**
 * Stop a chat's in-flight run. Aborts the streaming LLM request (which rejects
 * the in-flight `stream()` — the loop treats an aborted signal as a clean exit,
 * surfacing no error) and resolves any paused human-in-the-loop confirmation as
 * declined so a loop waiting on the gate can also unwind. Records a `stopped`
 * trace step for triage. No-op if nothing is running for this chat.
 *
 * What the model was streaming, and which model it was, are captured FIRST — a Stop
 * is pressed exactly when a model has gone wrong, and clearing the bubble used to
 * destroy the only evidence of what it did. The unwinding run persists both
 * ({@link keepStoppedTurn}); see `stoppedTurn.ts`.
 *
 * `running` flips to false when `runLoop` unwinds and `startRun`'s `finally`
 * fires; we emit here too so the Stop is reflected immediately.
 */
/**
 * A run the Stop reached while it was still setting up, before its loop started — the ONE
 * place both the conversation (`launch`) and the editor's host (`runTurn`) settle it:
 *  - the same {@link STOPPED_TURN_STEP} a mid-run Stop records, so the run journal reads it
 *    as cancelled (not completed) and the diagnostics count it as a stop;
 *  - an answer row after the person's saved turn (`stoppedBeforeStartRow`), or a reopened
 *    chat (the auto-reply on load, Retry) would start that work after all.
 * Best-effort: the run did not start either way. Resolves to the saved row, if any.
 */
declare function stopBeforeStart(runKey: RunKey, chatId: number, persistence: Pick<BrainRunPersistence, 'sendMessages'>, still?: () => boolean): Promise<BrainMessage | undefined>;
declare function stopRun(chatId: RunKey): void;
/**
 * Clear a chat's surfaced run error so the UI's error banner can be dismissed.
 * The error lives on the run cell (set when the LLM stream / tool loop threw),
 * so the hook's local `setError('')` can't reach it — this is the store-side
 * companion `clearError()` calls. No-op when there's no cell or no error.
 */
declare function clearRunError(chatId: RunKey | null): void;
/** Resolve a pending human-in-the-loop confirmation. No-op if none is pending. */
declare function resolveRunConfirm(chatId: RunKey, ok: boolean): void;
/**
 * Mirror a run that is executing in ANOTHER process into this store's cell, so every
 * local reader — the conversation hook, the timeline, `getGlobalRunState` — sees it
 * exactly as it would see an in-process run. The only writer of a cell that no local
 * loop owns; a locally running cell is never overwritten (the local loop is the
 * truth for it). `trace` is taken as sent: the remote side decides how much of its
 * bounded trace to ship (see the VS Code host's delta relay).
 */
declare function applyRemoteRun(chatId: number, snapshot: BrainRunSnapshot): void;

/**
 * A start the store refuses - a run is going, or a continuation holds the chat (`runClaim.ts`) - must
 * not drop the turn it carried. The caller has already saved the person's row and cleared their
 * composer; if nothing reads the words they vanish. So they go into the live run's inbox, which it
 * reads at its next call (interrupting the step in flight), exactly once.
 */

/** What `startRun` resolves to: the run ran to its end, or its turn joined the run that already holds the chat. */
type StartOutcome = 'ran' | 'joined';

/**
 * Starting a run — the single-flight claim on a chat's cell, the per-run reset, the
 * loop, and what a run does once it unwinds: keep what a Stop cut off, settle its ticket
 * backstops, report its coder's outcome, and hand its last step rows to the server.
 */

/**
 * Start (or no-op join) the agent loop for a chat. Single-flight per chat: if a
 * run is already in flight the call returns immediately, so a second mounted
 * Brain instance can never spawn a duplicate loop. The claim is synchronous
 * (set before any await), so two callers in the same tick can't both pass it. A start
 * made under a `RunClaim` consumes it (`beginRun`). A start that is REFUSED (a run is going, or a
 * continuation holds the chat) hands its turn to that run's inbox and resolves `'joined'` - the
 * caller's words are read once, never dropped (`refusedStart.ts`).
 */
declare function startRun(runKey: number, request: BrainRunRequest, claim?: RunClaim): Promise<StartOutcome>;

/**
 * Hosting a run that is not a chat's — the ONE run store for every agent turn in the
 * product. A chat's run (`startRun`) composes the Brain loop; a canvas turn composes the
 * canvas loop (board snapshot, proposal staging, the authoring and recovery ladders).
 * Both drive the one kernel (`@builderforce/agent-loop`); this is where the second one
 * gets the same CELL the first lives in:
 *
 *   - single-flight per key — a second start while one runs is refused, so two mounted
 *     surfaces (the Chat lens and the board dock) can never double-fire a turn;
 *   - the run outlives the component that started it (navigation, lens switches);
 *   - Stop (`stopRun`), the confirmation gate (`requestRunConfirm` / `resolveRunConfirm`,
 *     rendered by the shared ToolConfirmBar), the live trace and in-flight activity,
 *     and a thrown error's actionable verdict (`chatErrorAction`) — observed through the
 *     same snapshot (`subscribeRun` / `getRunSnapshot`) every chat surface renders.
 *
 * The engine owns its own persistence (a canvas session writes its own timeline), so
 * nothing here writes to a chat.
 */

/** What an engine reports into, and asks through, its run cell. */
interface RunEngineControl {
    /** Aborted by `stopRun(key)` — every await the engine makes should honour it. */
    readonly signal: AbortSignal;
    /** Record a completed step on the live trace. */
    trace(event: BrainTraceEvent): void;
    /** Ask the human about one tool call; resolves false on decline or Stop. */
    confirm(req: {
        name: string;
        args: unknown;
    }): Promise<boolean>;
    /** Name the turn by the id the host records it under (`snapshot.turn.id`). */
    correlate(id: string): void;
}
/** A run's body. Resolve when the turn is settled; throw to surface an error. */
type BrainRunEngine = (control: RunEngineControl) => Promise<void>;
/**
 * Start an engine-hosted run on `key`. Returns false (and runs nothing) when a run is
 * already in flight on that key. A throw that is not a Stop becomes the cell's error,
 * with its actionable verdict, and a durable trace row.
 */
declare function startEngineRun(key: RunKey, engine: BrainRunEngine): Promise<boolean>;

/**
 * WHAT A RATING IS ABOUT — the pure rule that turns "the user pressed 👎 on this
 * reply" into the two facts the learned router needs: WHICH MODEL served the turn,
 * and WHICH MCP TOOL it executed.
 *
 * "Some models are better than others at specific tasks" is only measurable if a
 * rating is filed against the task, and the task a chat turn performed is the tool
 * it called. That association is derivable from the transcript itself: the agent
 * loop persists each tool call as a durable STEP row (see `persistedSteps.ts`) that
 * sits between the user's question and the assistant's answer. Walking back from
 * the rated reply to the steps of ITS turn therefore works after a reload, unlike
 * the in-memory trace, which is empty on a freshly-opened chat.
 *
 * Pure and host-agnostic: the web Brain panel, the Canvas dock and the VS Code
 * webview all mount the same transcript and all call this, so a rating means the
 * same thing wherever it was pressed.
 */
/** The minimum message shape this rule needs — every surface's own `BrainMessage`
 *  satisfies it, so nothing has to be converted to call in. */
interface RatableMessage {
    id: number;
    role: string;
    metadata?: string | null;
}
/** Everything a rating carries beyond the thumb itself. */
interface RatedTurnContext {
    /** The model the gateway actually resolved for this reply, from its provenance.
     *  Empty when the turn predates provenance — the caller must then skip the
     *  rating rather than attribute it to a guess. */
    model: string;
    /** The MCP tool the rated turn executed, or null for a prose-only reply. */
    toolName: string | null;
}
/**
 * The tool a rated turn executed. Walks BACK from the reply over the durable step
 * rows that belong to the same turn (they sit between it and the previous
 * conversation message) and returns the LAST tool step — the one whose result the
 * reply is actually reporting on, and therefore the one being judged.
 *
 * Returns null for a turn that called nothing. That is a real and common case, and
 * a rating with no tool is still evidence about the model: "it answered badly" is a
 * verdict, and forcing it into some tool's bucket would libel that tool.
 */
declare function ratedTurnTool(messages: readonly RatableMessage[], messageId: number): string | null;
/**
 * Build the full rating context for one assistant reply. `model` comes from the
 * reply's own persisted provenance, so it is the id the gateway resolved after any
 * failover — never the model the composer happened to be showing.
 */
declare function ratedTurnContext(messages: readonly RatableMessage[], messageId: number): RatedTurnContext;
/** What a thumb tells the E5 local-success label: the verdict on chat `chatId`'s latest reply. */
interface LocalRatingVerdict {
    chatId: number;
    passed: boolean;
}
/**
 * The E5 `rating` verdict a thumb carries, or null when it carries none. Only a thumb
 * on the chat's LATEST reply judges the turn the local-success label is waiting on —
 * a press on an older reply (or clearing a thumb) says nothing about it, and the
 * deferred registry resolves by chat, so it must never be handed an older verdict.
 */
declare function localRatingVerdict(messages: readonly RatableMessage[], messageId: number, rating: 1 | -1 | 0, chatId: number | null): LocalRatingVerdict | null;
/** One viewer's thumb per message id — the shape every transcript's `ratings` prop takes. */
type MessageRatings = Record<number, 1 | -1>;
/**
 * The optimistic update a thumb press makes to that map: `0` clears the message's
 * verdict, `1`/`-1` sets it. Pure so every surface that rates a reply (the web Brain
 * panel through `useBrainConversation`, the Canvas dock) moves its thumbs the same way
 * before the best-effort write lands.
 */
declare function withRating(ratings: MessageRatings, messageId: number, rating: 1 | -1 | 0): MessageRatings;

/**
 * Chat/message persistence the host provides. Mirrors the Builderforce
 * `/api/brain` client surface; any backend conforming to these signatures works.
 */
interface BrainPersistenceAdapter {
    listChats(params?: {
        projectId?: string;
        limit?: number;
        offset?: number;
    }): Promise<BrainChat[]>;
    getChat(id: number): Promise<BrainChat>;
    createChat(body: {
        title?: string;
        originalRequest?: string | null;
        projectId?: number | null;
        capability?: string | null;
        mode?: string | null;
    }): Promise<BrainChat>;
    updateChat(id: number, body: {
        title?: string;
        originalRequest?: string | null;
        projectId?: number | null;
        visibility?: 'shared' | 'locked';
        capability?: string | null;
        mode?: string | null;
        memoryEnabled?: boolean;
        isArchived?: boolean;
    }): Promise<BrainChat>;
    deleteChat(id: number): Promise<unknown>;
    /**
     * Archive a chat — put it away rather than remove it. Distinct from
     * `deleteChat` on purpose: the local-first adapter's `deleteChat` tombstones
     * the row, and routing Archive through it is what made "archive" a destroy.
     * The server's archive happens to be the same `DELETE` route as its delete
     * (it sets `isArchived`); a local adapter archives by marking the row, not by
     * tombstoning it.
     */
    archiveChat(id: number): Promise<unknown>;
    summarizeChat(id: number): Promise<{
        summary: string;
    } | {
        error: string;
    }>;
    getMessages(chatId: number, limit?: number): Promise<BrainMessage[]>;
    /**
     * Bind a LOCAL chat to a server chat now, when signed in (PRD 36) — for a
     * server-addressed action on a chat that has not run yet (linking the ticket the chat
     * was opened for). Resolves the server id, or undefined while the chat stays local.
     * Omitted by an adapter whose chats ARE server chats.
     */
    bindChat?(chatId: number): Promise<number | undefined>;
    /** Subscribe to durable message invalidations for one chat. The callback carries
     * no data; the hook reconciles from persistence as the source of truth. */
    subscribeMessages?(chatId: number, onChanged: () => void): () => void;
    /** Advance the caller's unread high-water mark for a chat to `seq` (a message's
     * seq; omit to mark everything read). Called when a chat is OPEN/mounted so an
     * unread badge clears — on either surface, since it's the same server chat.
     * Optional: a guest/offline backend that has no unread concept simply omits it. */
    markChatRead?(chatId: number, seq?: number): Promise<unknown>;
    sendMessages(chatId: number, messages: Array<{
        role: string;
        content: string;
        metadata?: string;
        eventKey?: string;
    }>): Promise<BrainMessage[]>;
    /**
     * Record this viewer's thumb on one assistant reply (null clears it).
     *
     * `context` carries what the TRANSCRIPT knows and the server would otherwise have
     * to reconstruct — chiefly which MCP tool the rated turn executed. The server
     * joins it to the model on the reply's provenance and files a durable
     * `llm_action_ratings` row, so the press teaches the learned router which model is
     * good at which kind of work rather than only colouring a button.
     */
    setMessageFeedback(messageId: number, feedback: 'up' | 'down' | null, context?: {
        toolName?: string | null;
        /** E5: set only when the press judges the chat's LATEST reply. A host whose model
         *  stream runs in another realm (the VS Code extension host) hands it to
         *  `submitLocalTurnVerdict` there; servers ignore it. */
        localVerdict?: LocalRatingVerdict | null;
    }): Promise<unknown>;
    /**
     * Ask an invited agent participant to reply — a chat-scoped run that answers AS
     * the addressed agent and returns the posted assistant turn (attributed to it via
     * metadata.authoredBy). Called after a user directs a message to an @agent.
     * Optional: when absent, directing to an agent just posts the turn (legacy).
     */
    requestAgentReply?(chatId: number, input: {
        agentRef: string;
        agentName?: string;
    }): Promise<BrainMessage>;
    upload(file: File): Promise<{
        key: string;
        name: string;
        type: string;
    }>;
    /**
     * Record a file the model receives INLINE (a picture sent as a data URL) without sending
     * it anywhere — the attachment exists for this conversation, but no platform copy is
     * made of what the model never needs to fetch. Optional: when absent, such a file is
     * {@link upload}ed like any other (the web, whose uploads are its record).
     */
    keepLocal?(file: File): Promise<{
        key: string;
        name: string;
        type: string;
    }>;
    uploadUrl(key: string): string;
    /**
     * Mint a short-lived, signature-authenticated public URL for an uploaded
     * object so an upstream LLM provider can fetch it without the tenant token.
     * Used for the rare image too large to inline as a data URL. Optional: when
     * absent, the conversation falls back to the (auth-scoped) text link.
     */
    signedUploadUrl?(key: string): Promise<string>;
    /**
     * The model-facing text of the attachments this host can READ (text files, an editor's
     * "Add context"), already compressed (prose only) and fitted to the turn's mention
     * budget, with the keys it covered — those attachments reach the model as their text
     * instead of as a link. Null (or absent) ⇒ every attachment stays a link, which is
     * right for a host whose links the model can read (the web's uploads).
     */
    inlineAttachments?(attachments: readonly ChatInputAttachment[]): Promise<InlinedAttachments | null>;
}
/** What {@link BrainPersistenceAdapter.inlineAttachments} answers. */
interface InlinedAttachments {
    /** The fenced blocks, '' when nothing could be inlined. */
    text: string;
    /** The attachment keys `text` covers. */
    keys: string[];
}
interface BrainConfig {
    /** Auth + endpoint for the streaming gateway. */
    transport: BrainTransport;
    /** Chat/message persistence backend. */
    persistence: BrainPersistenceAdapter;
    /** Map a modality string to its default system prompt. Defaults to a generic prompt. */
    resolveSystemPrompt?: (modality: string) => string;
    /**
     * The streaming fn every Brain turn runs through. Omitted = the shared streamer over
     * {@link BrainConfig.transport}. A host supplies one to change WHERE turns run without
     * forking the hooks — builderforce.ai serves tool-free turns on the browser's own model
     * first (`createLocalFirstStream`). A call that must reach a NAMED cloud model (a model
     * comparison) uses `transport` directly and never passes through here.
     */
    stream?: BrainStreamFn;
    /** How attached pictures are prepared for a vision turn (long-edge cap, first quality).
     *  Omitted = the defaults (`imagePrep.ts`); the editor passes its `builderforce.images.*`. */
    imagePrep?: ImagePrepOptions;
}
/**
 * The streaming fn a config resolves to — the host's own, else the shared streamer over
 * its transport. The ONE resolution: BrainProvider and any surface that streams from a
 * config outside React (the canvas turn loop) read it here, so they cannot disagree on
 * where a turn runs.
 */
declare function resolveBrainStream(config: Pick<BrainConfig, 'transport' | 'stream'>): BrainStreamFn;
/** Resolved runtime: config plus a transport-bound streaming function. */
interface BrainRuntime {
    transport: BrainTransport;
    persistence: BrainPersistenceAdapter;
    resolveSystemPrompt: (modality: string) => string;
    /** Stream a completion — the config's own stream, else the configured transport. */
    stream: BrainStreamFn;
    /** {@link BrainConfig.imagePrep}, as configured. */
    imagePrep?: ImagePrepOptions;
}
declare function BrainProvider({ config, children, }: {
    config: BrainConfig;
    children: React.ReactNode;
}): react.JSX.Element;
/** Consume the resolved brain runtime. Throws if no BrainProvider is mounted. */
declare function useBrainConfig(): BrainRuntime;

interface LocalBrainPersistenceOptions {
    store: LocalFirstStore;
    deviceId: string;
    destination?: EntityDestination;
    /** Why "Consolidate" / "Fork" cannot run here — no {@link summarize} port. */
    summarizeUnavailable: string;
    /**
     * The model call a chat summary is written with (the ONE transcript summarizer,
     * `@seanhogg/builderforce-memory/working`). Omitted: summarizing reports
     * {@link summarizeUnavailable}.
     */
    summarize?: SummaryCompletion;
    /** Why a summary came back empty or failed (the model call errored). */
    summarizeFailed?: string;
    /**
     * The account destination chats bind into right now (PRD 36) — what `serverId` is
     * projected from. Omitted or undefined (signed out): every chat reads as unbound.
     */
    accountDestination?: () => EntityDestination | undefined;
    /**
     * The platform's spend for bound chats, by server id — the authoritative figure for
     * the calls the gateway served. Omitted, or failing: the device's own estimate stands.
     */
    serverSpend?: (serverIds: readonly number[]) => Promise<ReadonlyMap<number, SpendSavingsSummary>>;
    /** Bind a chat now (the host's chat identity). Omitted: the adapter offers no `bindChat`. */
    bindChat?: (chatId: number) => Promise<number | undefined>;
    /** The book a chat's own calls are priced with. Defaults to the bundled snapshot. */
    priceBook?: () => PriceBook;
    createObjectURL?: (file: File) => string;
    now?: () => Date;
    newId?: () => string;
}
declare function createLocalBrainPersistence(options: LocalBrainPersistenceOptions): BrainPersistenceAdapter;

/**
 * CHAT IDENTITY (PRD 36 §3.1) — which SERVER chat a local chat is, and the one way it
 * comes to be one.
 *
 * A local chat's `id` is a view key that never leaves the machine. It reaches the
 * platform only through a BINDING: the local store's mapping
 * `('chat', clientId, destination) → serverChatId`, written either here (bind on the
 * first run while signed in — `POST /api/brain/chats` with the title and project, never
 * the transcript) or by a sync receipt (`journal.ts`). The mapping is the one fact; a
 * chat row never stores a server id (persistence projects it as `BrainChat.serverId`).
 *
 * The destination is the ACCOUNT the chat binds into (platform + workspace), read live
 * from the host, so a chat bound in workspace A is not named in workspace B.
 */

/** What a host supplies so a local chat can be bound. */
interface ChatBindingPort {
    /** The account destination chats bind into now; undefined when signed out. */
    destination(): EntityDestination | undefined;
    /** Whether the platform policy allows a bind right now. */
    allowed(): boolean;
    /** Create the server chat — title and project only. Null when it could not be made. */
    createServerChat(input: {
        title: string;
        projectId: number | null;
    }): Promise<number | null>;
}
interface LocalChatIdentity {
    /** The bound server chat of a local chat, in the current account; undefined when unbound. */
    serverIdFor(localId: number): Promise<number | undefined>;
    /** The local chat's stable client id, or undefined when the store does not hold it. */
    clientIdFor(localId: number): Promise<string | undefined>;
    /** The local chat bound to a server chat in the current account, or undefined. */
    localIdFor(serverId: number): Promise<number | undefined>;
    /**
     * Bind a local chat when signed in and allowed: an existing binding wins, else the
     * server chat is created and mapped. Concurrent calls for one chat share one request.
     * Undefined when the chat stays unbound.
     */
    bind(localId: number): Promise<number | undefined>;
    /**
     * Record that a local chat IS an existing server chat (the host created it first).
     * False when it could not be: signed out, or the local chat is gone.
     */
    adopt(localId: number, serverId: number): Promise<boolean>;
}
declare function createLocalChatIdentity(options: {
    store: LocalFirstStore;
    deviceId: string;
    port: ChatBindingPort;
}): LocalChatIdentity;

/**
 * The PreFetch GATE's side of the run usage ledger (PRD 38) — the rows the gate leaves
 * that are not a real model call: an AVOIDED call (a PreFetch ANSWER, its saving
 * `deterministic`) and a run's end with its gate reading (`run-outcome`). Both stay on
 * this device: neither is spend the platform should import.
 */

/** One run's end, as the ledger stores it (`run-outcome` record, local only). */
interface RunOutcomeValue {
    /** The run id its usage rows carry ({@link RunUsageValue.runId}). */
    runId: string;
    clientChatId: string;
    /** Absent until the run's end is reported (a gate reading can land first). */
    outcome?: RunEndOutcome;
    /** Whether the run's PreFetch decision was accepted — the next request did not re-ask. */
    gateAccepted?: boolean;
    at: string;
}
/** A model call a PreFetch ANSWER stood in for — brain-embedded's `AvoidedRunCall`, with its chat. */
interface RecordAvoidedCallInput {
    chatId: number;
    runKey: number;
    actionId: string;
    runId?: string;
    /** The model the turn would have run on; absent ⇒ the chat's paid route. */
    model?: string;
    promptTokens: number;
    completionTokens: number;
}
/** A run's end and/or its gate reading, by its run id. */
interface RecordRunOutcomeInput {
    chatId: number;
    runId: string;
    outcome?: RunEndOutcome;
    gateAccepted?: boolean;
}

/**
 * The RUN USAGE LEDGER (PRD 36 §36.3) — one local row per model call a run made in a
 * local chat, so the chat's spend and savings are known on the device: offline, signed
 * out, and for the calls the platform never sees (a model on this machine).
 *
 * A row is priced only when read, by the ONE fold (`ledgerSpend.ts`) over the release's
 * bundled price snapshot (`snapshotPriceBook`), so the device and the api's ledger run
 * the same arithmetic. The one figure stamped at write is a local call's counterfactual
 * — what the chat's paid route would have charged for the same tokens (`paidRoute.ts`)
 * — because a local model has no price of its own to read it back from. The PreFetch
 * gate's rows (an avoided call, a run's outcome) are `gateLedger.ts`.
 *
 * Gateway calls are journaled nowhere: the gateway already logged them, so sync never
 * sends them twice. Local and direct-provider calls are journaled for sync like the
 * chat's other rows (`journal.ts`).
 */

/**
 * Where a call ran — its TRANSPORT: through the gateway, on this machine, or straight to
 * a provider. Not the run's pipeline route (`full` / `quick`), which is
 * {@link RunUsageValue.pipelineRoute}.
 */
type UsageRoute = 'gateway' | 'local' | 'byo-direct';
/** The run's pipeline route, as the ledger stores it (`@builderforce/pipeline-route`). */
type UsagePipelineRoute = 'full' | 'quick';
/** One model call's usage — the `usage` record's payload, and the sync wire shape. */
interface RunUsageValue {
    clientEventId: string;
    clientChatId: string;
    /** The run's local key (diagnostics; never resolved off the device). */
    runKey: number;
    model: string;
    /** The call's transport (see {@link UsageRoute}) — not its pipeline route. */
    route: UsageRoute;
    mode?: 'chat' | 'work';
    /** What kind of call it was (plan / code / verify / explore / chat / utility). */
    role?: string;
    /** The run's pipeline route and the router's score, when the run was routed. */
    pipelineRoute?: UsagePipelineRoute;
    routeScore?: number;
    /** How the PreFetch gate left the run's turn (`metadata.gateRoute`) — the route
     *  report's gate column. An ANSWERED turn is its `deterministic` row instead. */
    gateRoute?: 'prefetch' | 'llm';
    /** The run (one user submit) the call belongs to — what the route report groups by.
     *  A chat's runs share its {@link runKey}, so the key alone cannot tell them apart. */
    runId?: string;
    promptTokens: number;
    completionTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    /** `local_model`: a call on this machine. `deterministic`: a call AVOIDED — a PreFetch
     *  ANSWER (`recordAvoided`); zero real tokens, a median turn saved. */
    savingsSource?: 'local_model' | 'deterministic';
    /** The PreFetch action that answered a `deterministic` row. */
    answeredBy?: string;
    savedPrompt?: number;
    savedCompletion?: number;
    /** A local call's counterfactual at list, in millicents (stamped at write). */
    savedCostMc?: number;
    recallPrompt?: number;
    at: string;
}
interface RecordRunUsageInput {
    /** The chat's local view key. */
    chatId: number;
    runKey: number;
    model: string;
    route: UsageRoute;
    usage: CompletionUsage | undefined;
    mode?: 'chat' | 'work';
    role?: string;
    pipelineRoute?: UsagePipelineRoute;
    routeScore?: number;
    gateRoute?: 'prefetch' | 'llm';
    runId?: string;
}
interface RunUsageLedgerOptions {
    store: LocalFirstStore;
    deviceId: string;
    /** The book local calls are valued with. Defaults to the bundled snapshot. */
    book?: () => PriceBook;
    now?: () => Date;
    newId?: () => string;
}
interface RunUsageLedger {
    /** Record one call. A call with no usage, or in a chat this store does not hold, is skipped. */
    record(input: RecordRunUsageInput): Promise<void>;
    /**
     * Record an AVOIDED call: a row with zero real tokens whose saving (`deterministic`,
     * estimated) is the turn's tokens priced at `model`, else the chat's paid route. Kept on
     * this device — never journaled, so a sync can never import it as a real call.
     */
    recordAvoided(input: RecordAvoidedCallInput): Promise<void>;
    /** Record how a run ended, once, by its run id. Never journaled: it is this device's
     *  own reading of its runs, not spend. A chat this store does not hold is skipped. */
    recordOutcome(input: RecordRunOutcomeInput): Promise<void>;
}
declare function createRunUsageLedger(options: RunUsageLedgerOptions): RunUsageLedger;
/**
 * A run's streamer that records every call it made into the ledger — the ONE seam each
 * local-first surface wraps its transport with (the panel's run host, the native chat
 * participant), so no call a run makes, compaction included, is left off the chat's
 * spend. Recording is fire-and-forget: a ledger write never holds or fails a turn.
 */
declare function withRunUsage(stream: BrainStreamFn, ledger: RunUsageLedger, context: {
    chatId: number;
    runKey: number;
    mode?: 'chat' | 'work';
}, onError?: (error: unknown) => void): BrainStreamFn;

/**
 * The pipeline router — does this request need the FULL pipeline (plan → code →
 * verify), or will a QUICK single coding pass do?
 *
 * Every run used to take the full pipeline: an analysis phase that reads the code and
 * hands off, a coding phase, and a verify stage that reviews the change on a different
 * model. For "fix the typo in the README" that is three model tiers and two hand-offs
 * spent on one edit. The router reads the request ONCE, before turn 1, and scores how
 * likely it is to need the whole pipeline.
 *
 * The score is a logistic over a few lexical features, with the weights as data
 * ({@link ROUTE_WEIGHTS}) so they can be tuned — or replaced by a fitted head — without
 * touching a host. `score` is P(full pipeline needed); at or above the threshold the run
 * goes `full`, below it `quick`. `mode: 'always'` keeps every run on the full pipeline
 * (the score is still computed and recorded, so the route report can show what auto
 * WOULD have done), and the words "full pipeline" in the request force it.
 *
 * PURE — no I/O, no env, no clock. The action type is the caller's (the shared lexical
 * classifier in `@builderforce/workload`), so this package depends on nothing.
 */
type PipelineRoute = 'full' | 'quick';
/** The default threshold: a coin. */
declare const DEFAULT_ROUTE_THRESHOLD = 0.5;

/**
 * The route report's arithmetic — what the router did over a window of runs, and
 * whether its threshold should move. Pure: a host folds its own ledger into
 * {@link RouteRunRecord}s (one per run) and renders the {@link RouteReport}.
 *
 * MISROUTE PROXY. Nothing labels a quick run "should have been full", so the report
 * uses what the person did next: a quick run followed, in the same conversation and
 * within {@link RERUN_WINDOW_MS}, by a FULL run (they asked again, often with "full
 * pipeline"), or a quick run the host recorded as failed. Both say the quick pass did
 * not finish the job.
 */

/** One run, as the report reads it. */
interface RouteRunRecord {
    route: PipelineRoute;
    /** The router's score; null for a run recorded without one. */
    score: number | null;
    /** What the run's calls cost, in millicents; null when any call's price is unknown (unknown, never a partial sum). */
    costMc: number | null;
    /** The conversation the run belongs to — what "re-run" is grouped by. */
    conversation: string;
    /** When the run's first call was made (ISO-8601). */
    startedAt: string;
    /** The host knows the run failed. Absent ⇒ unknown, and only the re-run proxy applies. */
    failed?: boolean;
}
interface RouteTotals {
    runs: number;
    /** Millicents over the runs that have a known cost; the runs that do not are counted in `unpricedRuns`. */
    costMc: number;
    /** How many of `runs` have an unknown cost. Absent when every run is priced. */
    unpricedRuns?: number;
    /** Mean score over the runs that carry one; null when none does. */
    avgScore: number | null;
}
interface ScoreBin {
    /** Inclusive lower edge. */
    from: number;
    /** Exclusive upper edge (1 is inclusive for the last bin). */
    to: number;
    full: number;
    quick: number;
}
interface RouteReport {
    runs: number;
    byRoute: Record<PipelineRoute, RouteTotals>;
    histogram: ScoreBin[];
    /** Quick runs the proxy calls misrouted, and their share of all quick runs. */
    misroutes: number;
    misrouteRate: number | null;
    threshold: number;
    /** The threshold the evidence points to, or null when it says keep the current one.
     *  A number, never a sentence: each host words (and localizes) it itself. */
    suggestedThreshold: number | null;
}
/** The whole report over `runs` at the current `threshold`. */
declare function summarizeRouteRuns(runs: readonly RouteRunRecord[], opts?: {
    threshold?: number;
    rerunWindowMs?: number;
}): RouteReport;

/**
 * The run usage ledger as the ROUTE REPORT reads it — this device's routed runs over a
 * window, one {@link RouteRunRecord} per run, priced with the one device cost rule
 * (`callCost.ts`). The report's arithmetic is `@builderforce/pipeline-route`'s; the host
 * renders it (VS Code: `BuilderForce: Pipeline Route Report`).
 *
 * A run is one user submit: its calls share {@link RunUsageValue.runId}. A row from
 * before the run id was stamped falls back to its chat and run key. How the run ended
 * is its `run-outcome` record, written once at run end under the same id.
 *
 * The report's GATE column (docs/design/deterministic-prefetch.md) reads the same rows:
 * an ANSWERED run is its `deterministic` row (`answeredBy`), every other gated run's calls
 * carry `gateRoute` (`prefetch` / `llm`), and whether the decision was accepted is the
 * run-outcome record's `gateAccepted` — no other store.
 */

/** This device's usage rows written at or after `since`, oldest first. */
declare function usageRowsSince(store: LocalFirstStore, deviceId: string, since: Date): Promise<RunUsageValue[]>;
/** How this device's runs since `since` ended, by run id (`recordOutcome`). */
declare function runOutcomesSince(store: LocalFirstStore, deviceId: string, since: Date): Promise<Map<string, RunEndOutcome>>;
/**
 * The routed runs among `rows` (oldest first): route, score, cost and start per run.
 * `outcomes` (from {@link runOutcomesSince}) marks a run that FAILED, which the report's
 * misroute proxy counts for a quick run; a run with no recorded outcome is unknown.
 */
declare function routeRunRecords(rows: readonly RunUsageValue[], book?: PriceBook, outcomes?: ReadonlyMap<string, RunEndOutcome>): RouteRunRecord[];
/** Whether each gated run's decision was accepted, by run id (`recordOutcome` `gateAccepted`). */
declare function gateAcceptedSince(store: LocalFirstStore, deviceId: string, since: Date): Promise<Map<string, boolean>>;
/** One gate route's runs and how many of its judged decisions were accepted. */
interface GateRouteStats {
    runs: number;
    /** Runs whose next request has said whether the decision was accepted. */
    judged: number;
    accepted: number;
}
/** The pipeline route report's gate column: the answer / prefetch / llm split, with accuracy. */
interface GateReport {
    /** Runs the gate decided. */
    runs: number;
    answer: GateRouteStats;
    prefetch: GateRouteStats;
    llm: {
        runs: number;
    };
    /** ANSWER runs per action, most first (ties by id). */
    answeredBy: Array<{
        actionId: string;
        runs: number;
    }>;
    /** The estimated saving of the answered runs, in millicents. */
    savedCostMc: number;
}
/** The gate column over `rows` (any order); `accepted` from {@link gateAcceptedSince}. */
declare function summarizeGateRuns(rows: readonly RunUsageValue[], accepted?: ReadonlyMap<string, boolean>): GateReport;

/**
 * What ONE model call cost, priced on the device — the figure a run's USD budget
 * accrues (`runStore/runSpendBudget.ts`) and the route report sums from the run usage
 * ledger (`routeLedger.ts`). The rule is `@builderforce/spend-contract`'s
 * `computeCostMillicents` over the release's bundled price book, so the device and the
 * api's ledger price a call with the same arithmetic.
 *
 * It is the device's ONE cost rule for a call, keyed by the call's TRANSPORT route
 * (`UsageRoute`, the ledger row's `route`): the run budget, the route report and the
 * chat spend panel's slices (`ledgerSpend.ts` `sliceOf`) all price through it.
 *
 *   - `local` — served on this machine: costs nothing.
 *   - `gateway` — what the platform bills: the catalog price (`priceOf`).
 *   - `byo-direct` — a provider the person keys directly, valued at LIST
 *     (`listPriceOf`, which also resolves `direct/<vendor>/<model>` ids): it is their own
 *     money, so it counts toward a budget and the spend total. The spend panel still
 *     shows it as "your key", never as platform spend (`isOwnKeySpend`).
 *
 * A route left out is read from the model id, as the stream would (`usageRouteOf`).
 */

/** One call's token counts, as the stream or the ledger reports them. */
interface CallTokens {
    prompt: number;
    completion: number;
    cacheRead?: number;
    cacheCreation?: number;
}
/**
 * The call's cost in millicents: 0 for a call on the device, the priced figure otherwise, and UNDEFINED
 * when the call is not on the device and no price is known for it (a model the book does not carry, a
 * hosted model with no registry alias, a call with no model). Unknown is not free: every caller carries it
 * as unknown — the spend cap flags it, the ledger reports the tokens as unpriced, the route report shows it
 * as unpriced.
 */
declare function callCostOrUnknown(model: string | undefined, tokens: CallTokens, book?: PriceBook, route?: UsageRoute): number | undefined;

/**
 * SYNC ON ENABLE, the chat slice (PRD 36 §36.4) — hand this device's local chats to the
 * account once the person has turned sync on.
 *
 * A chat written offline lives in the unbound partition, which the coordinator never
 * sends. This moves every unbound chat, message and usage row of this device into the
 * account's destination and replaces its offline journal with ONE import per row
 * (`journal.ts`): the server receives the chat's history as it is now, not as a replay
 * of every edit it went through — so a chat that was bound by sign-in is adopted rather
 * than duplicated, and a retry is the same import, deduplicated by the server.
 *
 * Gateway usage rows move with their chat but are never sent: the gateway logged them.
 * Idempotent: a second pass finds nothing unbound.
 */

/** Move this device's unbound chat rows into `destination`. Returns how many chats moved. */
declare function bindChatHistoryForSync(store: LocalFirstStore, deviceId: string, destination: EntityDestination): Promise<number>;

/**
 * Untaken tool call — detection + recovery, shared by every agent loop.
 *
 * Recovery has two halves and BOTH live in this file: the re-prompt budget with its
 * user-facing notices, and the MODEL FAILOVER section at the bottom. They were split
 * across two packages once — the selector lived in a React package — and the server
 * reply loop, unable to import it, hand-rolled its own and shipped a failover branch
 * that could not run. See {@link chooseStallFailover}.
 *
 * The failure it fixes: a turn ends with `stopReason: stop` and ZERO tool calls while
 * tools were available, and a loop that treats "no tool calls" as "done" hands the user
 * words instead of a result. It wears five faces, all of them observed in production and
 * all of them a model-behaviour class rather than a vendor bug:
 *
 *   1. the PROMISE — `"I'll search the codebase for the handler."`
 *   2. the PSEUDO-CALL — `"run tool builtin_chats_list_tickets with chatId is 85"`
 *   3. the MISSING-DATA CLAIM — `"The required tools have not returned results yet."`
 *   4. the BLANK TURN — nothing at all: no call, no words.
 *   5. the HANDOFF — `"Now run `pnpm type-check`, then commit and push."` (`handoff.ts`)
 *   6. the PERMISSION MENU — `"Would you like me to: open PRs? cancel the tickets?"`
 *      (`permissionMenu.ts`)
 *
 * The third is the one that reads like an answer, and it is why the manager's
 * accountability chat shipped "I have no data" to a person asking it to account for a
 * dead board (project 11 / chat 86, 2026-07-28: 7 turns, 102 tools, 0 calls). The
 * fourth is the one that reads like a blip, and it is why the same chat answered a
 * 400 saying "this usually clears on a retry" four days running (2026-07-31). The
 * fifth is the one that reads like a FINISHED answer — it is well written, correct,
 * and complete except for the part where somebody has to do it — and it is the shape
 * a coding agent in the user's own workspace fails with most: it edits the files, then
 * writes out the verification and the commit for the user to run. Every other detector
 * here is first-person by construction and scores it a clean finish.
 *
 * The sixth is the one that reads like GOOD MANNERS. It does the reading, writes a
 * correct report, and closes by offering to do the work — so the user, who asked for
 * that work one message earlier, spends a turn granting permission that was implicit in
 * the request. It defeats every detector above at once: too long to be empty, too
 * deferential to be a promise, too well-sourced to be a missing-data claim, and it names
 * platform actions rather than shell commands so the handoff gate's "is a command within
 * reach" test never fires.
 *
 * Deliberately zero-dependency, framework-free and free of Node builtins: the Brain
 * run loop imports this into a BROWSER bundle (VS Code webview / Next.js client)
 * while the on-prem + cloud agent loop imports it into Node and the Worker.
 */

/**
 * Every advertised tool identifier appearing in `text`, de-duplicated, in order.
 *
 * Two callers, one pattern — which is the point of putting it here. The stall
 * detector below uses it to recognise a call written as prose; the per-turn tool
 * SELECTOR uses it to find the tools a system prompt instructs the model to call, so
 * a relevance filter can never drop a tool the prompt just promised. Those two must
 * agree on what a tool name looks like, or the loop recovers from a stall the
 * selector caused.
 */
declare function toolNamesMentionedIn(text: string): string[];
/**
 * Does this reply PROMISE a tool call rather than make one?
 *
 * A false positive costs one extra model turn; a false negative strands the user
 * holding a promise — so the bias runs toward catching the stall.
 */
declare function announcesUntakenAction(text: string): boolean;
/**
 * Every CATALOG-style tool id in `text` (`manager.digest`), de-duplicated, in order —
 * the counterpart to {@link toolNamesMentionedIn}, which finds the ADVERTISED form.
 *
 * The pair is a DIAGNOSIS, not a curiosity, and it is the distinction a shipped report
 * got wrong. A stalled reply naming `manager.digest` was told to call a string the model
 * never had (the prompt / persisted-persona name mismatch, fixed by migration 0379). A
 * stalled reply naming `builtin_manager_digest` was told correctly and could not comply —
 * the tool list is fine and the MODEL is the problem. Identical transcripts, opposite
 * fixes; a report that asserts the first while the evidence says the second sends the
 * reader to re-audit prompts and migrations that were already right.
 */
declare function catalogToolNamesMentionedIn(text: string): string[];
/**
 * Does this reply blame MISSING TOOL DATA on a turn that called nothing?
 *
 * Exported alongside {@link announcesUntakenAction} because the two are different
 * failure shapes with the same remedy, and a caller reporting WHY it re-prompted
 * should be able to tell them apart.
 */
declare function claimsMissingToolData(text: string): boolean;
/**
 * The gateway model surface, as `/llm/v1/models` returns it and both browser hosts
 * cache it. Structurally a superset of what `classifyModelFunding` takes, so one
 * cached object feeds both. A SERVER caller composes the same shape from the pool
 * constants it already has (see `BrainService.agentReply`).
 */
interface ModelFallbackSurface {
    /** The plan pool — every model this tenant may select. */
    data?: Array<{
        id?: string;
    }>;
    /** The curated tool-calling / coding subset of the pool. */
    codingModels?: string[];
    /** Models reachable through the tenant's OWN connected accounts (BYO). */
    byo?: {
        models?: Array<{
            id?: string;
            vendor?: string;
        }>;
    };
}
/**
 * The next model to try, or undefined when nothing untried is left.
 *
 * Preference order, and why:
 *  1. **BYO ∩ coding pool** — the tenant's own connected account (so the retry costs
 *     nothing against the plan allowance) AND curated for tool calling, which is the
 *     capability that just failed. Best on both axes.
 *  2. **Remaining BYO** — another connected account, before the shared free pool. A
 *     stall on BYO Grok that falls straight onto a shared coder surfaces as
 *     `shared_byo_unused` even though Claude/Codex/etc. were connected and free to
 *     try; preferring BYO here keeps the retry on the tenant's own keys.
 *  3. **Coding pool** — curated for tool calling, plan-funded (shared).
 *  4. **Rest of the plan pool.**
 *
 * A caller driving an AGENTIC turn should leave `data` unset: tier 4 is the general
 * plan pool, and falling a tool-loop onto a non-coder produces a run that flails and
 * ships nothing (the same reasoning as the gateway's coding-only backstop chain).
 *
 * `tried` holds every model already attempted this run, including the original pin.
 * A caller that pinned nothing (gateway auto-select) should pass its resolved model,
 * so the failover cannot hand back the model that just failed.
 */
declare function nextFallbackModel(surface: ModelFallbackSurface | null | undefined, tried: readonly string[]): string | undefined;

/**
 * The model hand-off policy for ONE agent run, as a pure reducer.
 *
 * Every agent loop answers the same four questions before and after each turn: what
 * kind of call is this (plan, code, verify — or chat when no tools are on offer), which
 * model does it ask for and how strictly, which models must it route around, and when a
 * model is spent, who takes over. Those answers lived inline in the browser Brain's run
 * store, and each other host (the cloud durable and container loops, the server
 * addressed reply, the canvas, on-prem) carried its own partial copy — which is how one
 * loop retried a broken model on eighteen separate turns and another enforced a
 * failover budget over a failover that never happened.
 *
 * Here they are one state machine. A host asks {@link nextTurn} what to request, makes
 * the call, and reports what happened with {@link reduceRunPolicy}; the reduced state's
 * `outcome` says what the host must DO about it (re-ask, retry, fail, continue on a new
 * model). Traces, nudges, persistence and dispatch stay with the host. No I/O, no
 * clocks; the only foreign code that runs is a host-supplied fallback `pick`. The state
 * is plain JSON, so a host that runs one step per invocation (the cloud durable loop,
 * the container `llm` op) persists it between steps as it is.
 */

/** What the host must do about the event it just reported. */
type RunPolicyOutcome = {
    kind: 'none';
}
/** The plan turn reached for a code change: discard it and re-ask THIS turn as `code`
 *  (with `coderHandoffBrief`). */
 | {
    kind: 'reask_as_coder';
}
/** `hand_off` accepted — every later turn is `code`. */
 | {
    kind: 'handed_off';
}
/** `hand_off` after the plan was already handed off — answer the call with an error. */
 | {
    kind: 'hand_off_rejected';
}
/** A transport failure the policy routes around: re-ask this turn now. `broken` is the
 *  model left out for the rest of the run; `released` names a dropped pin/lock. */
 | {
    kind: 'retry_turn';
    broken?: string;
    released?: string;
    status?: number;
}
/** A transport failure the policy does not route around: the turn fails. */
 | {
    kind: 'fail_turn';
}
/** The spent model was swapped; the host re-prompts on `to`. */
 | {
    kind: 'failed_over';
    from: string | undefined;
    to: string;
    attempt: number;
    of: number;
}
/** Nothing untried within budget — the run stops and says so. */
 | {
    kind: 'failover_exhausted';
    tried: readonly string[];
};
/** How a request failed in transport — the host classifies, the policy decides. */
type TransportFailureKind = 
/** The model broke AFTER the gateway committed to it (in-band error, dropped stream). */
'interrupted'
/** The gateway was reached and the request failed (reset, timeout, HTTP status). */
 | 'transport'
/** The gateway was never reached — already retried with backoff by the transport. */
 | 'unreachable';
type RunPolicyEvent = 
/** The turn answered. `model` is what the gateway RESOLVED, when it said; `acted` —
 *  the turn called tools — makes that model a proven failover candidate. */
{
    type: 'turn_succeeded';
    model?: string;
    acted?: boolean;
}
/** The turn's tool calls include a code change (the implicit plan→code re-ask). */
 | {
    type: 'code_change_attempted';
}
/** The model called `hand_off` (planning ends explicitly). */
 | {
    type: 'hand_off';
}
/** The analysis budget was spent and the forced hand-off turn still did not hand off:
 *  planning ends anyway, so the coding role takes the next turn. */
 | {
    type: 'plan_budget_spent';
}
/** The host made this turn the hand-off (`hand_off` alone, a call required). */
 | {
    type: 'hand_off_forced';
}
/** The host made this coding turn the change (the change tools alone, a call required). */
 | {
    type: 'change_forced';
}
/** The run moved on to verifying its change. */
 | {
    type: 'verify_started';
}
/**
 * The model burned its whole stall budget. `resolvedModel` names what answered (the
 * only id on an auto-select turn); `pick` is the host's own fallback picker, `surface`
 * the gateway model surface — `pick` wins when both are present, neither ⇒ no failover
 * (unless the run prefers a proven model and has one).
 */
 | {
    type: 'stalled';
    resolvedModel?: string;
    surface?: ModelFallbackSurface | null;
    pick?: (tried: readonly string[]) => string | undefined;
} | {
    type: 'transport_failed';
    kind: TransportFailureKind;
    model?: string;
    status?: number;
}
/**
 * The verifier cascade (cost PRD D1) moved the run one model tier up after a unit of
 * work failed its verifier, or back down to the unit's base once one passed. The next
 * turn asks for `to` strictly — a soft hint could be shadowed by the gateway's seed —
 * and the model it leaves is recorded as tried, so a later stall failover does not
 * pick it again (only the cascade's own de-escalation returns to it).
 */
 | {
    type: 'escalated';
    to: string;
};

/**
 * The analysis→code hand-off, as it appears on the wire and as the coder is told it.
 *
 * When an auto-routed run's planning turn reaches for its first code change, the loop
 * discards that turn and re-asks the SAME turn, from the same transcript, with role
 * `code` (the `code_change_attempted` event in `./policy.ts` decides when). Every host
 * that plans before it codes makes that re-ask, so both halves of it live here rather
 * than in whichever loop happened to write them first (the browser Brain's run store).
 * Pure.
 */
/**
 * A request with role `code` straight after one with role `plan` is the re-ask — a
 * run's role only ever moves from plan to code there.
 *
 * Exported so a scripted gateway can recognise the re-ask and replay the current step
 * instead of advancing its script: a real coding model, handed the same transcript,
 * makes the same move.
 */
declare function isCoderReask(role: string | undefined, previousRole: string | undefined): boolean;

/**
 * THE classification of a failed completion for the run policy.
 *
 * Every browser agent loop (the Brain run store, the Creation Canvas) catches the same
 * errors from `streamChatCompletion` and must tell `@builderforce/run-policy` the same
 * thing about them. That translation used to be written once per host, and the hosts
 * drifted: the run store routed an in-band "Upstream error … overloaded" frame around
 * the broken model while the canvas rethrew it and showed the vendor's sentence as its
 * answer (2026-10-17, ui 2026.10.52). One function, so a new failure shape reaches
 * every loop at once.
 *
 * Pure: the host reports the event and acts on the outcome (its own traces, re-asks and
 * transcript handling stay with it).
 */

/** The policy event a provider failure is reported as. */
type ProviderFailureEvent = Extract<RunPolicyEvent, {
    type: 'transport_failed';
}>;
/**
 * The run-policy event for `error`, or null when it is not a provider/transport failure
 * (a refusal, a bug, a user Stop) and must surface as it is.
 *
 *  - The model broke AFTER the gateway committed to it — an in-band error frame, a
 *    dropped or silent stream, a repetition loop, a gateway that never answered —
 *    `interrupted`, naming the model to route around when the stream knew it.
 *  - The gateway was reached and the request reset or timed out — `transport`.
 *  - The gateway was never reached through every backoff retry — `unreachable`.
 *  - The gateway ANSWERED with an HTTP status (`BrainRequestError`) — `transport` with
 *    that status, exactly as the server loops report a failed response, so a 413 / 429 /
 *    503 releases a pin and a 5xx retries on the cascade in the browser too. A refusal of
 *    the REQUEST itself (auth, entitlement, a bad body — run-policy's own line,
 *    `isRequestRefusalStatus`) is not the model's failure and surfaces as it is; a 400 is
 *    still reported, because from a declining backend it is a decline the policy releases.
 */
declare function providerFailureEvent(error: unknown): ProviderFailureEvent | null;

/**
 * The timeline steps the Brain run loop records when `@builderforce/run-policy` moves
 * the run — a role hand-off, a model failover, a turn retried around a broken model.
 *
 * The policy decides; this module only SAYS what it decided, in the labels and wording
 * the triage and diagnostics readers already key on (`llm.role_handoff`,
 * `loop.model_failover`, `llm.stream_interrupted`, `llm.transport_error`, and the
 * `llm.complete` error a failed completion records). Kept out of
 * `brainRunStore.ts` so the loop reads as "report the event, act on the outcome" rather
 * than carrying the prose of every outcome inline. Pure: the caller stamps `ts`.
 */

/** A turn re-asked after a transport failure the policy routes around. */
declare function transportRetryTrace(ts: string, step: number, outcome: Extract<RunPolicyOutcome, {
    kind: 'retry_turn';
}>, message: string): BrainTraceEvent;
/**
 * A completion that FAILED — the `llm.complete` error step every browser loop records
 * before it routes around the failure or surfaces it. `model` is the model that broke
 * (what the stream named, else the one asked for); under auto-routing that is `default`.
 * The result keeps the error's class, so triage can tell an interruption from a reset.
 */
declare function providerFailureTrace(ts: string, step: number, model: string | undefined, error: unknown, durationMs?: number): BrainTraceEvent;

/**
 * The REASON behind a network failure, read off its `cause` chain — and what to do
 * about the one kind that is always safe to retry.
 *
 * Node's fetch (undici) throws `TypeError('fetch failed')` and a broken body read
 * throws `TypeError('terminated')` — both say nothing on their own. What went wrong
 * lives in `cause`: `UND_ERR_HEADERS_TIMEOUT`, `ECONNRESET`, `ENOTFOUND`,
 * `UND_ERR_SOCKET: other side closed`, a TLS failure, or an `AggregateError` with one
 * entry per address tried. Reporting only the outer message turned every one of those
 * into the same "fetch failed: fetch failed" on the timeline, with nothing to act on.
 *
 * Output is the outer message followed by each distinct cause, code first:
 * `fetch failed ← UND_ERR_HEADERS_TIMEOUT: Headers Timeout Error`.
 */
declare function describeNetworkError(e: unknown): string;
/**
 * Did this request fail before a connection was ever opened?
 *
 * Then no byte reached the server, so sending it again is safe whatever it does —
 * a write included. That is what a network drop on the user's side looks like
 * (chat #141/#142: `connect ETIMEDOUT` on every Cloudflare address at once, in every
 * run in the same second). `ETIMEDOUT` counts only on the `connect` syscall: the same
 * code on an open socket means the request may already be in flight.
 */
declare function isConnectFailure(e: unknown): boolean;
/**
 * Pauses between attempts when the connection could not be opened: about half a minute
 * in all, long enough to ride out a Wi-Fi or VPN drop, short enough that a machine that
 * is really offline hears so.
 */
declare const CONNECT_RETRY_DELAYS_MS: readonly number[];
interface ConnectRetryOptions {
    signal?: AbortSignal;
    delaysMs?: readonly number[];
    /** Told before each wait — the caller's chance to say the run is waiting on the network. */
    onRetry?: (attempt: number, delayMs: number, reason: string) => void;
}
/**
 * Run `send`, and send again with backoff while the connection cannot be opened. Any
 * other failure — a reset mid-request, a timeout on an open socket, an HTTP error — is
 * rethrown at once: the request may have arrived, and only the caller knows whether
 * repeating it is safe. A Stop during a wait rejects with the abort reason.
 */
declare function retryOnConnectFailure<T>(send: () => Promise<T>, opts?: ConnectRetryOptions): Promise<T>;

/**
 * The SHARED streamer pointed at a runtime on the user's own machine — pinned, or LOCAL
 * FIRST with failover to the cloud gateway.
 *
 * Every client that runs the Brain loop on the user's machine (the VS Code extension
 * host, the Chrome extension's service worker) drives the same `streamChatCompletion`,
 * so the binding of `@builderforce/local-inference` to it lives here, once: the URL
 * rewrite, the endpoint's own token, commit-on-first-delta, and the fail-fast that keeps
 * a dead localhost runtime from riding the gateway's connect-retry. Host-neutral: `fetch`
 * and the probed runtimes are injected; nothing here touches Node, `vscode` or `chrome`.
 *
 * All runtimes speak the OpenAI wire format, which is why the whole adaptation is a URL
 * rewrite plus the endpoint's token — the agent loop, tool-call protocol and error
 * mapping are exactly the ones a gateway turn uses.
 */

/** The `fetch` a host lends the local path (the global in every host by default). */
type LocalFetch = (input: string, init: RequestInit) => Promise<Response>;
/** A Brain streaming fn — structurally `BrainStreamFn`, restated to keep this module
 *  off the run store's import graph. */
type StreamFn$1 = (opts: Omit<StreamChatOptions, 'transport'>, handlers?: StreamHandlers) => Promise<StreamChatResult>;
/**
 * The transport that points the shared streamer at a local runtime.
 *
 * `getToken` returns the endpoint's own credential or null. Null is the on-device case
 * and is load-bearing: the streamer omits `Authorization` for a null token, so a
 * signed-out client can still run a local turn.
 *
 * `failFast` is for a local-first attempt. The streamer re-sends a request whose
 * connection never opened for about half a minute (`retryOnConnectFailure` — right for
 * the gateway over a flaky network), but a localhost runtime that refuses the connection
 * is NOT running, and the cloud fallback is waiting. So the refusal is re-thrown as a
 * plain error — deliberately with NO `cause`, because the retry walks the cause chain
 * for a connect-failure code and would find it there.
 *
 * The body is the plain OpenAI one (`wire: 'openai'`): no gateway-only field reaches a
 * runtime. `runtime`, when known, lets the registry's `providerSampling` drop the
 * temperature for a provider that picks it per model (Kimi Code).
 */
declare function localTransport(endpoint: LocalEndpoint, fetchImpl?: LocalFetch, options?: {
    failFast?: boolean;
    runtime?: LocalRuntimeId;
}): BrainTransport;
/**
 * Packs a call for the LOCAL model about to take it — a host builds one with brain-
 * embedded's `createHandoffFit` (the `@seanhogg/builderforce-memory/handoff` packer).
 * `contextTokens` is the target's window when known (its runtime's report, else the
 * shipped catalog row); a fit given no window returns the messages untouched.
 * `conversation` is the call's conversation (`StreamChatOptions.conversationKey`): a fit
 * that remembers its last pack keeps one per conversation, so two chats on one local
 * model never reuse each other's pack.
 */
type LocalAttemptFit = (messages: ChatCompletionMessage[], target: {
    ref: string;
    contextTokens?: number;
    tools?: readonly unknown[];
    maxTokens?: number;
    conversation?: number;
}) => Promise<ChatCompletionMessage[]>;
/** Where a pinned local stream may send a call that names a DIFFERENT model. */
interface LocalStreamRoute {
    /** The pin's full `local/<runtime>/<model>` ref — reported as the serving model. */
    ref?: string;
    /** The runtimes as probed, so a failover to another local model finds its endpoint. */
    probes?: readonly LocalRuntimeProbe[];
    /** The gateway stream, so a failover to a cloud model reaches it (null signed out). */
    cloud?: StreamFn$1 | null;
    /** Packs each call for the local model taking it. */
    fit?: LocalAttemptFit;
}
/**
 * The streaming fn for a PINNED local model — the local twin of a gateway stream. The
 * loop pins the full `local/<runtime>/<model>` ref, but the runtime knows only its bare
 * id, so `model` is overridden with it. Gateway-only fields (`strict`, `routingMode`,
 * `metadata`) ride through; the runtimes ignore them rather than reject them.
 *
 * A call that names a DIFFERENT model (a run-policy failover, a coder re-ask) goes where
 * that model runs — another probed local runtime, the pin's own runtime under another
 * id, or the gateway — instead of silently landing on the pin. Only a model with
 * nowhere to go (a cloud ref signed out, an unknown local ref) stays on the pin.
 */
declare function createLocalStream(endpoint: LocalEndpoint, model: string, fetchImpl?: LocalFetch, route?: LocalStreamRoute): StreamFn$1;
/**
 * Read a call into what the local-first plan needs, through THE workload profile — so a
 * client sizes a call exactly the way the gateway and the model router do.
 */
declare function localFirstWorkload(call: {
    messages: readonly unknown[];
    tools?: readonly unknown[];
    role?: string;
    maxTokens?: number;
}): LocalFirstWorkload;
/**
 * Whether a call is OPEN to local-first. Any model choice — an explicit pick, a
 * project's or role's pin, a configured default — names what the user wants and wins
 * outright, and so does an explicit "use my connected accounts" (`byo_pool`); only "let
 * the gateway route" may be served on this device first. The ONE statement of the rule:
 * the editor's route and the web app's stream both read it.
 */
declare function localFirstApplies(call: {
    model?: string;
    routingMode?: 'auto' | 'byo_pool';
}): boolean;
/** What {@link createLocalFirstStream} needs from its host. */
interface LocalFirstStreamInput {
    /** The runtimes as probed WITH capabilities (`createLocalRuntimeProber({ capabilities: true })`). */
    probes: readonly LocalRuntimeProbe[];
    /** Connected accounts this host calls itself (Kimi), tried after the device and before
     *  the cloud — Hybrid only (`createHostModelStream`). */
    accounts?: readonly LocalFirstAccount[];
    /** The gateway stream, or null when signed out (local-only). */
    cloud: StreamFn$1 | null;
    /** Lent to the local attempts; the global `fetch` by default. */
    fetch?: LocalFetch;
    /** Each settled attempt, as it settles — a host's log hook. The same attempts also
     *  ride on the result as `localFirst` for the run's trace. */
    onAttempt?: (record: LocalFirstAttemptRecord) => void;
    /**
     * Packs the call for each LOCAL attempt's window; the cloud attempt keeps the original
     * messages. With a fit, a local model is planned on the call's irreducible core — the
     * system message(s) + the latest user turn + tools — rather than its whole transcript,
     * since the fit is what makes the rest fit.
     */
    fit?: LocalAttemptFit;
    /**
     * The sentinel thrown when nothing can serve a call — `not_signed_in` (the default) or,
     * for a person sign-in would not help (Local only, or signed in with the cloud route
     * unavailable), `no_local_model`. `createHostModelStream` decides which.
     */
    noModel?: string;
    /**
     * Consulted once per call with the plan, before any attempt runs; returns the plan to
     * run. Hybrid's `run.local-success` predictor drops the local attempts here when it is
     * confident they would fail (`createHostModelStream`). Absent = the plan as made.
     */
    gate?: (plan: LocalFirstAttempt[], call: Omit<StreamChatOptions, 'transport'>) => Promise<LocalFirstAttempt[]>;
}
/**
 * LOCAL FIRST, failover to the gateway — one streaming fn the agent loop drives exactly
 * like the gateway's.
 *
 * The plan is made PER CALL, because what a call needs is only known then: a tool turn
 * goes only to a model whose runtime says it can take tools, so one run can answer its
 * plain turns locally and hand its tool turns to the cloud. A local attempt that fails
 * before the user saw any output (runtime down, HTTP error, empty answer) falls over
 * invisibly; one that already streamed owns the turn; a Stop is never failed over.
 *
 * The served attempt shows as `resolvedModel` (`local/<runtime>/<model>` for a local
 * answer) and every attempt rides on `result.localFirst`, from which the run loop
 * records `llm.local_fallback`. Signed out with nothing local that fits, it throws
 * `not_signed_in` — the contract a gateway route without a credential already has.
 */
declare function createLocalFirstStream(input: LocalFirstStreamInput): StreamFn$1;
/** The message shape a non-streaming local call puts on the wire — structural, because it
 *  only ever JSON-serializes it (hosts hold differently-typed message arrays). */
interface LocalChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: unknown;
    tool_calls?: unknown;
    tool_call_id?: string;
}
/**
 * A non-streaming completion against a local runtime (a summarizer, a scanner). Returns
 * the assistant text ('' when none) and throws on a non-OK response.
 */
declare function completeLocal(endpoint: LocalEndpoint, model: string, messages: readonly LocalChatMessage[], signal?: AbortSignal, fetchImpl?: LocalFetch): Promise<string>;
/**
 * LOCAL FIRST for a non-streaming completion — the twin of {@link createLocalFirstStream}.
 * Nothing streams, so nothing commits: any local failure or empty answer falls over to
 * `cloud`, the host's own gateway completion (null when signed out). Throws
 * `not_signed_in` when nothing local fits and there is no cloud.
 */
declare function completeLocalFirst(input: {
    probes: readonly LocalRuntimeProbe[];
    messages: readonly LocalChatMessage[];
    cloud: (() => Promise<string>) | null;
    signal?: AbortSignal;
    fetch?: LocalFetch;
    onAttempt?: (record: LocalFirstAttemptRecord) => void;
    /** As {@link LocalFirstStreamInput.noModel}. */
    noModel?: string;
}): Promise<string>;

/**
 * The `run.local-success` head FEDERATES: each signed-in Hybrid host trains its head on
 * its own routed turns (`localSuccessRouter.ts`), sends what a refit learned to its
 * project's Evermind coordinator as a head delta, and starts from the fleet's merged
 * head instead of a cold start. Operator decision (2026-10-20, the engine's
 * `docs/ml-task-catalog.md` §6): heads ride the EXISTING delta wire
 * (`target: ml:run.local-success`) and merge by the engine's eval-gated FedAvg
 * (`mergeMlHeadDeltas`) — no second wire, no second merge.
 *
 * This module is the client half's ONE port ({@link LocalSuccessFederation}, injected
 * alongside the `LocalSuccessStore` through `createHostModelStream`), the shared HTTP
 * adapter every host builds it from ({@link createLocalSuccessFederation} over the
 * host's own authed JSON request), and the pure rules the router applies:
 *
 *  - WHO sends: only a turn that may federate — Hybrid, signed in, with a project
 *    (`localSuccessScope`). Anonymous, Local only and Specific never reach the port.
 *  - WHEN (the throttle): a refit whose held-out loss improved on the previous head and
 *    beats a coin, at least {@link FEDERATE_MIN_NEW_OUTCOMES} new outcomes AND
 *    {@link FEDERATE_MIN_INTERVAL_MS} after the last push. The head is 20 floats, so the
 *    bound is about the coordinator's merge rate, not bandwidth: one push per device per
 *    hour at most, and only once a meaningful slice of new evidence arrived.
 *  - WHAT: the diff of the trained head against the fleet head it was warm-started
 *    from (`buildMlHeadDelta`), weighted by its sample count, plus its held-out tail as
 *    scaled feature rows — the coordinator's merge gate scores candidates on those
 *    (the turn features are counts and ratios; no text ever leaves the device).
 *  - ADOPTION: a pulled fleet head becomes the base every refit warm-starts from, and
 *    REPLACES the serving head when the local one is cold, untrusted, or worse.
 *
 * Fire-and-forget throughout: a push or pull that fails never affects a turn.
 */

type MaybePromise$2<T> = T | Promise<T>;
/** The project's merged head, as the coordinator serves it. */
interface LocalSuccessFleetHead {
    /** The merged version (0 = nothing merged yet: the all-zero head). */
    version: number;
    params: number[];
    /** Held-out loss of this version on the fleet's eval pool (null when never scored). */
    evalLoss: number | null;
}
/** One held-out row: the engine-scaled features, the class index, the label weight. */
interface LocalSuccessHoldoutRow {
    x: number[];
    y: number;
    w?: number;
}
/** A head delta on the delta wire, plus the held-out rows the merge gate scores on. */
interface LocalSuccessContribution extends DeltaLearnPayload {
    holdout: LocalSuccessHoldoutRow[];
}
/**
 * The host's federation transport — the ONE port, injected alongside the store. Each
 * host builds it from its own authed transport with {@link createLocalSuccessFederation}.
 */
interface LocalSuccessFederation {
    /** Send a head contribution to `projectId`'s coordinator. Rejects on refusal. */
    push(projectId: number, contribution: LocalSuccessContribution): Promise<void>;
    /** `projectId`'s merged head; null when it has none yet. Rejects when the read failed. */
    pull(projectId: number): Promise<LocalSuccessFleetHead | null>;
    /**
     * The project a turn federates with when the call names none (Rovr's chats carry no
     * project; its Settings → project is the one memory stands behind). Absent = only a
     * call's own project.
     */
    project?(): MaybePromise$2<number | null | undefined>;
}
/** The fleet head a device's refits start from, as persisted in its snapshot. */
interface FleetBase extends LocalSuccessFleetHead {
    projectId: number;
    /** When it was pulled (ms epoch) — {@link FLEET_REFRESH_MS} after, the next turn re-pulls. */
    pulledAt: number;
}
/**
 * The port over a host's authed JSON transport — the same `ProjectMemoryRequest` the
 * project memory hooks take (`apiRequest` on the web, `bfApiRequest` in the editor,
 * Rovr's `portRequest`). The routes are the project Evermind's: the delta door
 * (`POST …/evermind/learn`, which routes a head target to its own merge) and the head
 * read (`GET …/evermind/ml-head`). Under the web's Local only both are refused by the
 * request gate (`/api/projects/*\/evermind` is a connected feature carrying content).
 */
declare function createLocalSuccessFederation(request: ProjectMemoryRequest, opts?: {
    project?: () => MaybePromise$2<number | null | undefined>;
}): LocalSuccessFederation;

/**
 * The `run.local-success` predictor Hybrid consults before a local attempt — trained on
 * this device from this device's own routed turns, and persisted through ONE port the
 * host lends ({@link LocalSuccessStore}: browser storage on the web and in Rovr, the
 * extension's global storage in VS Code).
 *
 * Everything ML here is the engine's (`@seanhogg/builderforce-memory-engine` ML task
 * catalog): the task row and its feature scaling (`LOCAL_SUCCESS_TASK`), the labelling of
 * an outcome — cloud fallbacks included, per the operator's "learns from the cloud"
 * decision (`localSuccessExamples`) — the ONE trainer (`trainMlTask`) and the ONE runner
 * (`runMlTask`). This module only keeps the history, decides when the answer is trusted
 * enough to act on, and persists.
 *
 * Cold start is today's behaviour: until the task has trained (its `minSamples`) AND the
 * fitted head beats a coin on its held-out tail, every turn tries local.
 */

type MaybePromise$1<T> = T | Promise<T>;
/** The host's persistence for the predictor — the ONE port, injected into `createHostModelStream`. */
interface LocalSuccessStore {
    /** The stored snapshot, or undefined when none (validated here; a bad value reads as none). */
    load(): MaybePromise$1<unknown>;
    save(snapshot: LocalSuccessSnapshot): MaybePromise$1<void>;
}
/** One routed turn, as stored: the engine's outcome plus which local model it was about. */
interface StoredLocalSuccessOutcome extends LocalSuccessOutcome {
    ref: string;
    at: number;
}
interface LocalSuccessSnapshot {
    v: 1;
    /** Oldest first, bounded at {@link LOCAL_SUCCESS_HISTORY}. */
    outcomes: StoredLocalSuccessOutcome[];
    /** The trained head (logistic weights + biases), when the task has trained. */
    head?: {
        params: number[];
        holdoutLoss: number | null;
        samples: number;
    };
    /**
     * The project's merged fleet head this device last pulled — every refit warm-starts
     * from it, and a push is diffed against it (`localSuccessFederation.ts`).
     */
    fleet?: FleetBase;
    /** When this device last pushed a head delta (ms epoch) — the federation throttle. */
    pushedAt?: number;
}
/** Skip local only when the predictor says it FAILS with more confidence than this. */
declare const LOCAL_SKIP_CONFIDENCE = 0.8;
/**
 * Of the turns the predictor would skip, the share still tried locally. Without it a
 * skipped turn only ever teaches through the cloud (a success there says nothing about
 * local), so a head that learned "fails" could never unlearn it.
 */
declare const LOCAL_SKIP_EXPLORE = 0.1;
/** A tuning value: fixed, or read per turn (a host setting the person can change live). */
type LocalSuccessTunable = number | (() => number | undefined);
/** The host's tuning of WHEN a confident "fails" verdict skips local — the editor's
 *  `builderforce.localModels.skipConfidence` / `.explore` settings. */
interface LocalSuccessTuning {
    /** Skip local only when P(fails) exceeds this; default {@link LOCAL_SKIP_CONFIDENCE}. */
    skipConfidence?: LocalSuccessTunable;
    /** Of the turns that would skip, the share still tried locally; default {@link LOCAL_SKIP_EXPLORE}. */
    explore?: LocalSuccessTunable;
}
/**
 * A {@link LocalSuccessStore} over `localStorage` (the web app; any page with Web
 * Storage). Guarded: a blocked or partitioned store reads as empty and saves nothing.
 */
declare function webStorageLocalSuccessStore(key?: string): LocalSuccessStore;

/**
 * THE routing step every host runs before a Brain call — pinned model, pinned local
 * runtime, or LOCAL FIRST with failover to the gateway — composed once.
 *
 * The web app, Rovr (the Chrome side panel) and the VS Code extension host each used to
 * write this step themselves around `createLocalStream` / `createLocalFirstStream`, each
 * with its own hand-off fit, and they drifted: one re-checked `localFirstApplies` the
 * local-first stream already reads, one hard-pinned a picked gateway model the others did
 * not. A host now supplies only what differs between hosts — where its pin comes from,
 * how a local pin resolves to an endpoint, what it probes, its gateway stream and fetch —
 * and gets the one streaming fn back.
 *
 * THE PICK is the person's explicit model choice: the host's own pin, else a model the
 * call names STRICTLY (`modelStrict` is how a host whose picker rides on the call — the
 * web app's selection, the editor's `modelState` — marks the person's pick). A model the
 * call names without it (a run-policy failover, a project pin) is not the pick and keeps
 * the flags its caller gave it.
 *
 * The INFERENCE MODE (`@builderforce/local-first`) decides what the pick means — the four
 * rows the operator set:
 *
 *  - **Local only** never builds a cloud stream: any pick that does not run ON THIS
 *    DEVICE — a gateway model, or a locally dispatched but hosted runtime (the registry's
 *    `onDevice: false`, e.g. Kimi Code) — whether the host's or one the call names, is set
 *    aside so the turn routes onto this device, and with nothing local it fails
 *    `no_local_model`.
 *  - **Hybrid, no pick (Auto):** local first, then the gateway — the probed runtimes
 *    through `createLocalFirstStream`, which owns which calls are open to local-first
 *    (`localFirstApplies`) and the invisible failover; with nothing probed, the gateway.
 *    A connected subscription this host calls itself (`accounts` — Kimi, which refuses our
 *    cloud) is tried after this device and before the gateway, the way the gateway leads
 *    with the tenant's other connected accounts.
 *    With a `localSuccess` store, the engine's `run.local-success` predictor is consulted
 *    before the local attempt — skipped when it is confident the turn would fail there —
 *    and every outcome (local served, local failed → gateway, skipped) trains it. Only
 *    here: Local only has no alternative to local, and Specific makes no local attempt.
 *    With a `localSuccessFederation` too, a SIGNED-IN turn with a project also shares
 *    what the head learned and starts from the fleet's merged head
 *    (`localSuccess/localSuccessFederation.ts`) — never anonymous, Local only or Specific.
 *  - **Hybrid with a pick:** the pick FIRST, never hard-pinned (no `modelStrict`); if it
 *    fails before the person saw any output AND the failure is transport-class (see
 *    {@link isFallbackFailure}: the gateway unreachable, a 5xx, a timeout before any
 *    output, the local engine failing), the turn falls back to Auto — the local engine,
 *    then the gateway — and the host is told (`onFallback`) so the person sees "your pick
 *    failed; answered with Auto", never a silent swap. A refusal the person can act on
 *    (401, 402, 403, a BYO-key error, a plan limit — any 4xx) is TERMINAL: it surfaces so
 *    the shared remedy banner offers the fix. Signed out a gateway pick has nowhere to
 *    run, so the turn goes straight to Auto.
 *  - **Specific with a pick:** exactly that route, hard-pinned (`modelStrict`) — no local
 *    attempt and no fallback. "Use my connected accounts" (`routingMode: 'byo_pool'`) is
 *    a pick of the BYO pool: exactly the pool, at the gateway.
 *  - **Specific with no pick:** fails `no_specific_model` — never a silent Hybrid.
 *
 * When no model can serve a turn, the error says WHY: `not_signed_in` only for a person
 * who is signed out and could sign in to fix it; a signed-in person whose cloud route is
 * unavailable, or anyone on Local only, gets `no_local_model` — never a sign-in prompt.
 */

/** A Brain streaming fn — structurally `BrainStreamFn`, restated to keep this module off
 *  the run store's import graph (as `localFirstTransport` does). */
type StreamFn = (opts: Omit<StreamChatOptions, 'transport'>, handlers?: StreamHandlers) => Promise<StreamChatResult>;
type MaybePromise<T> = T | Promise<T>;
/** Where a local pin runs: its endpoint and the bare id the runtime knows. */
interface HostLocalPin {
    endpoint: LocalEndpoint;
    model: string;
}
interface HostModelStreamInput {
    /**
     * The host's own pick, read per call (so a pick applies from the next turn): a
     * `local/…` ref or a gateway model id; null/absent = no host pin, and a model the call
     * names strictly is the pick (see the module comment).
     */
    pinned?: () => MaybePromise<string | null | undefined>;
    /**
     * Resolves a local ref to where it runs, or null when this host cannot serve it (the
     * call then routes automatically). Default: {@link pageRuntimePin} — a model running in
     * this page's engines.
     */
    localPin?: (ref: string) => HostLocalPin | null | undefined;
    /** The runtimes to try local-first, probed WITH capabilities; absent = gateway only. */
    probes?: () => Promise<readonly LocalRuntimeProbe[]>;
    /**
     * The connected accounts this host calls itself (Kimi), read per Hybrid Auto call — never
     * prompting; an account that is not connected is simply absent. Absent = none (the web
     * app, which cannot reach Kimi).
     */
    accounts?: () => Promise<readonly LocalFirstAccount[]>;
    /** The gateway stream for this call, or null signed out. */
    cloud: () => MaybePromise<StreamFn | null>;
    /** The local fetch (page engines' shim, the editor's bridge…); the global by default. */
    fetch?: LocalFetch;
    /** Packs each local call for its model's window; the shared hand-off packer by default. */
    fit?: LocalAttemptFit;
    /** Each settled local-first attempt — a host's log hook. */
    onAttempt?: (record: LocalFirstAttemptRecord) => void;
    /** The person's inference mode, read per call; absent = `hybrid` (the gateway allowed). */
    mode?: () => MaybePromise<InferenceMode>;
    /**
     * Whether the person is signed in, read per call — decides which error a turn nothing
     * can serve fails with (see the module comment). Absent = signed in exactly when
     * `cloud` returned a stream.
     */
    signedIn?: () => MaybePromise<boolean>;
    /**
     * Hybrid's pick failed (transport-class, before any output) and the turn was answered
     * with Auto instead. Every host shows the one-line notice ("Your pick X failed;
     * answered with Auto") — a fallback is never silent.
     */
    onFallback?: (event: ModelFallbackEvent) => void;
    /**
     * Where this host persists the `run.local-success` predictor (browser storage on the
     * web and in Rovr, the extension's global storage in VS Code). Absent = no predictor:
     * Hybrid always tries local first, as before. See `localSuccess/localSuccessRouter.ts`.
     */
    localSuccess?: LocalSuccessStore;
    /**
     * When the predictor's "fails" verdict skips local (the editor's
     * `builderforce.localModels.skipConfidence` / `.explore`); getters are read per turn.
     * Absent = the defaults (`LOCAL_SKIP_CONFIDENCE`, `LOCAL_SKIP_EXPLORE`).
     */
    localSuccessTuning?: LocalSuccessTuning;
    /**
     * How this host federates that predictor's head with its project's fleet (its own
     * authed transport, built with `createLocalSuccessFederation`). Absent = the head
     * stays on this device. Used only with `localSuccess`, on a signed-in Hybrid turn.
     */
    localSuccessFederation?: LocalSuccessFederation;
}
/** What {@link HostModelStreamInput.onFallback} is told: the pick that failed, and why. */
interface ModelFallbackEvent {
    /** The picked model ref (`local/…` or a gateway id). */
    from: string;
    /** The failure's message — for a log line; the notice names only the model. */
    reason: string;
}
/** The ONE host routing step: see the module comment for the rows it decides. */
declare function createHostModelStream(input: HostModelStreamInput): StreamFn;
/**
 * Whether a failed pick may fall back to Auto: TRANSPORT-CLASS failures only — nothing the
 * person could fix by acting on the error.
 *
 *  - a local pick's engine failing (any error from this device's runtime);
 *  - the gateway unreachable (`TransportError` — the connection never opened);
 *  - a timeout before any output (`StreamInterruptedError`, which `pickThenAuto` only
 *    sees uncommitted);
 *  - a 5xx from the gateway.
 *
 * Everything else is TERMINAL — a 401 (sign in again), 402 / plan limit (upgrade), 403, a
 * BYO-key error, any other 4xx — so the shared remedy banner offers the fix instead of a
 * different model quietly answering.
 */
declare function isFallbackFailure(err: unknown, local: boolean): boolean;

/**
 * Per-reply model/account provenance — the durable "which LLM, and whose account,
 * produced this turn" signal shown as a small chip under an assistant message.
 *
 * Motivation: a SUCCESSFUL Brain turn used to reveal nothing about how it was
 * served, so "why didn't it use my paid Claude?" was invisible until a turn came
 * back empty (the only case the diagnostic note fired). This attaches the resolved
 * model + whether the tenant's OWN connected frontier account served it — or the
 * shared pool did despite a connected account existing — to every assistant turn,
 * so the confirmation is always on screen.
 *
 * Single source of truth for the convention, shared by the writers (server-side
 * `agentReply` metadata + the streaming gateway's `x-builderforce-account` header,
 * captured client-side and persisted) and the renderer (the BrainTimeline chip).
 * The `account` string values are the wire contract with the server — the api's
 * `classifyReplyAccount()` MUST emit these exact literals.
 */
/** The metadata key under which a message's provenance rides. */
declare const PROVENANCE_META_KEY = "provenance";
/**
 * Which account served a completed turn:
 * - `own`               — the tenant's OWN connected frontier account (a Claude
 *                         subscription or a BYO vendor key) served it; the platform
 *                         paid nothing and the user is on the model they connected.
 * - `shared`            — the shared model pool served it AND the tenant has no
 *                         connected account (nothing else was possible).
 * - `shared_byo_unused` — the shared pool served it EVEN THOUGH the tenant has a
 *                         connected account — the case worth flagging inline
 *                         ("your connected account wasn't used for this turn").
 */
type ProvenanceAccount = 'own' | 'shared' | 'shared_byo_unused';
/** Durable provenance for one assistant turn. */
interface MessageProvenance {
    /** The model the gateway ACTUALLY used (resolved, post-failover). */
    model: string;
    /**
     * Which account served it — see {@link ProvenanceAccount}. OPTIONAL: the
     * gateway reports it via `x-builderforce-account`, which an older gateway (or a
     * CORS setup that doesn't expose the header) omits. Requiring it used to drop
     * the whole record, so a turn's MODEL — the thing users most need when output
     * quality collapses — went unreported too. Absent = "model known, account not".
     */
    account?: ProvenanceAccount;
    /** Vendor that owns `model` (e.g. `anthropic`), when known — names the account
     *  in tooltips ("your connected Claude account"). */
    vendor?: string;
    /** Present when the project's own self-learning Evermind generated this reply's
     *  final prose (opt-in inference). `version` is the Evermind head the turn ran on.
     *  Absent for turns served by a frontier/pool model — so the "🧠 Evermind vN" chip
     *  shows ONLY when the learned model actually spoke. */
    evermind?: {
        version: number;
    };
    /**
     * What the surface ASKED for when it differed from {@link model} (gateway failover /
     * downgrade). Absent on a turn that got exactly what it requested — so a copied
     * transcript can stamp `## BuilderForce · actual (requested X)` only when the two
     * disagree. Optional: older turns never carried it.
     */
    requestedModel?: string;
}
/** The wire's account literal, or undefined for anything else — the one reading of it,
 *  for the stream header on the way in and a persisted blob on the way out. */
declare function asProvenanceAccount(value: unknown): ProvenanceAccount | undefined;
/** True when a turn ran on the shared pool despite a connected account existing —
 *  the only state the chip flags inline. Shared by the chip and any host that
 *  wants to nudge the user to check their connection. */
declare function isConnectedAccountUnused(prov: MessageProvenance | null | undefined): boolean;
/** Parse a message's persisted provenance, or `null` when it carries none (older
 *  turns). The MODEL is the only required field — a turn whose gateway didn't
 *  report an account still names the model that answered. Defensive: a malformed
 *  blob yields `null` rather than throwing. */
declare function parseMessageProvenance(msg: {
    metadata?: string | null;
}): MessageProvenance | null;
/**
 * The model that most recently ANSWERED in this conversation — the newest message
 * carrying provenance. A composer labelled from the requested model alone reads
 * "Builderforce Free" under auto while a connected Qwen or Grok is doing the work;
 * this is what the label should say once anything has actually answered. `undefined`
 * before the first served reply, so the caller falls back to the requested model.
 */
declare function lastServedModel(messages: readonly {
    metadata?: string | null;
}[]): string | undefined;
/**
 * Merge a provenance object into a message's metadata (preserving any other keys,
 * e.g. `authoredBy` on an agent's reply). Returns a serialized string, or
 * `undefined` when there is nothing to store — ready to hand to
 * `persistence.sendMessages`. Mirrors `withDirectedMetadata`.
 */
declare function withProvenanceMetadata(provenance: MessageProvenance | null | undefined, base?: Record<string, unknown>): string | undefined;
/**
 * Markdown heading for one assistant turn in a copied transcript.
 *
 * Without this every block is just `## BuilderForce`, so a multi-model run looks like
 * one voice and the aggregate "Models used" / "Per model" lines are the only attribution.
 * Prefer the resolved model id from persisted provenance; when the turn was downgraded,
 * append `(requested …)` so failover is visible on the block itself.
 */
declare function formatAssistantTranscriptHeading(assistantName: string, message: {
    metadata?: string | null;
}): string;

/**
 * WHAT THE USER IS TOLD RAN THEIR TURN — the one rule, shared by every surface.
 *
 * A turn served by BuilderForce's own routed pool IS the product the user signed up
 * for: "Builderforce Free" or "Builderforce PRO". Which upstream model the cascade
 * happened to land on (`minimaxai/minimax-m3`, `@cf/zai-org/glm-4.7-flash`, …) is an
 * implementation detail of that product — it changes per turn, per vendor outage, per
 * cooldown, and the user on a routed plan has no control over it. Naming it in the UI
 * only ever raises a question they cannot act on ("why did I get Minimax?").
 *
 * The id is NOT hidden from us. It still rides every `llm_usage_log` row, every
 * execution trace, the provenance metadata on the message, and the "Copy diagnostics"
 * report — the places where WE need to know exactly which model served a turn. This
 * module governs the DISPLAY layer only.
 *
 * It is shown to the user in exactly the two cases where the choice is theirs:
 *   • the turn ran on their OWN connected account (BYO) — it is their model, on their
 *     key, and naming it is the whole point of connecting it; or
 *   • they are entitled to pick a model at all (a paid plan, or a connected provider),
 *     in which case the catalog is theirs to browse and pin.
 *
 * Everyone else — the free plan and the anonymous canvas — sees the product name.
 *
 * Lives in brain-embedded (not a UI package) because four surfaces have to agree on
 * it: the shared `/` composer menu, the per-reply provenance chip in the transcript,
 * the VS Code host's `Change model` QuickPick, and the public `/models` catalog page.
 */

/** The two BuilderForce routing products. A turn with no explicit pin runs on one of
 *  them, and that PRODUCT is what the user sees named. */
type RoutedProduct = 'free' | 'pro';
/**
 * The user-facing names of our two routing products. THE single source — the composer
 * menu, the provenance chip and the public `/models` catalog all read these, so the
 * product can never be called three different things in three places.
 *
 * Brand tokens, deliberately NOT localized (see the i18n rule for brand names).
 */
declare const BUILDERFORCE_PRODUCT_NAME: Readonly<Record<RoutedProduct, string>>;
/**
 * What this viewer is allowed to see about model identity.
 *
 * `product`   — which routing product funds their unpinned turns.
 * `canChoose` — may they pick a model at all (paid plan OR a connected provider)?
 *               This is the SAME gate the gateway enforces on a strict pin, so the
 *               label a user reads and the choice they are offered agree by construction.
 */
interface ModelIdentityContext {
    product: RoutedProduct;
    canChoose: boolean;
}
/**
 * The safe default: a free, choice-less viewer. Deliberately the FALLBACK for a host
 * that has not wired an identity yet, so the failure mode of forgetting is "masked",
 * never "leaked". A host that is wired always passes its own.
 */
declare const DEFAULT_MODEL_IDENTITY: ModelIdentityContext;
/** The product name for this viewer — "Builderforce Free" / "Builderforce PRO". */
declare function productModelName(identity: ModelIdentityContext | null | undefined): string;
/** Which product a plan funds. One mapping, so "paid ⇒ PRO" is not re-decided per host. */
declare function productForPlan(isPaid: boolean): RoutedProduct;
/** True when `model` is a user-configured ref (Evermind head / saved LLM config)
 *  rather than an upstream catalog id. */
declare function isUserConfiguredModelRef(model: string | null | undefined): boolean;
/**
 * THE decision: may this viewer be shown the raw model id, or do they get the product
 * name? See the module header for the rule. `account` is the turn's provenance account
 * when known — a turn served by the tenant's OWN connected account always names its
 * model, because that model is the thing they connected.
 */
declare function revealsModelId(identity: ModelIdentityContext | null | undefined, account?: ProvenanceAccount): boolean;
/**
 * The name to PUT ON SCREEN for `model`. Returns the model id when this viewer owns the
 * choice (see {@link revealsModelId}) or when the ref names something they configured
 * themselves; otherwise the routing product's name.
 *
 * Every surface that renders a model to a user goes through this — the composer menu,
 * the provenance chip, the QuickPick — so a masked plan cannot leak an upstream id
 * through whichever surface was written last.
 */
declare function displayModelName(model: string | null | undefined, identity: ModelIdentityContext | null | undefined, opts?: {
    account?: ProvenanceAccount;
}): string;

/**
 * THE local model store — the ONE API the picker drives for every on-device model a page
 * engine can run, whichever engine and whichever cache holds it.
 *
 * Each catalog row's `source` picks the backend: an `hf-file` model streams into our own
 * Cache Storage bucket (`hfModelStore`); a `webllm` model goes through WebLLM's own cache
 * APIs. The picker never sees the difference: it lists rows with a state (`absent`,
 * `downloading`, `ready`, `unsupported`), starts and cancels downloads, removes models
 * and subscribes to changes. A finished download or a removal invalidates the engines'
 * memoized probes, so the very next turn can be served by the new model.
 *
 * Downloads start only here (PRD 34 §3.4) — a chat turn never downloads.
 */

type LocalModelState = 'absent' | 'downloading' | 'ready' | 'unsupported';
type LocalModelRow = LocalCatalogModel & {
    state: LocalModelState;
    /** Where it runs on this device (the fit's choice), when it can: `webgpu` or the
     *  engine's `cpu`. The picker labels `bfi` rows by it. */
    backend?: LocalBackend;
    /** 0..1 while `downloading`. */
    progress?: number;
    /** Why it is `unsupported`: a fit code, or `engine_unavailable` when this host does not
     *  carry the engine. */
    reason?: LocalModelUnfit | 'engine_unavailable';
    /** An `unsupported` row whose bytes are still cached here — listed, and removable. */
    downloaded?: boolean;
};
interface LocalModelStore {
    listLocalModels(): Promise<LocalModelRow[]>;
    /** Start (or join) a download. Rejects with the failure; the row returns to `absent`. */
    download(ref: string, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<void>;
    remove(ref: string): Promise<void>;
    /** Notified on every state or progress change; returns the unsubscribe. */
    subscribe(listener: () => void): () => void;
}
/**
 * A {@link LocalModelStore} that reaches the real one only when first used — the picker's
 * port in a host whose engines must stay off first paint (the web composer imports them
 * lazily; the editor's webview builds them on first use). `store` is asked per call and
 * memoized by the host; `subscribe` attaches once it resolves, and an unsubscribe that
 * lands first wins, so a listener is never left attached.
 */
declare function deferredLocalModelStore(store: () => LocalModelStore | Promise<LocalModelStore>): LocalModelStore;

/**
 * WHICH MODELS a chat surface may offer, in WHAT ORDER, and WHO PAYS for each —
 * the model-choice domain, with no UI in it.
 *
 * It lives here rather than in the React UI package because three very different
 * surfaces have to agree on it: the shared `/` composer menu (web + VS Code
 * webview), and the VS Code extension HOST's `Change model` QuickPick, which runs
 * in the Node extension process and cannot import React. When each owned its own
 * list they drifted on grouping order, on how a connected provider was named, and
 * on the sentence that told the user who was being billed.
 */

/** The gateway pin that expands to a project's CURRENT Evermind head at call time.
 *  Mirrors `PROJECT_EVERMIND_MODEL_PREFIX` on the gateway (api/.../projectEvermind.ts). */
declare const PROJECT_EVERMIND_MODEL_PREFIX = "project_evermind:";
/** What the user picked. `auto` lets the gateway route; `byo_pool` walks the
 *  tenant's connected accounts in their configured priority order; `model` is a
 *  strict pin. */
type ChatModelSelection = {
    mode: 'auto';
} | {
    mode: 'byo_pool';
} | {
    mode: 'model';
    model: string;
};
/**
 * The per-turn `routingMode` a selection sends. Only "your keys" is an explicit choice;
 * `auto` sends NOTHING, so the gateway applies the person's account preference (free
 * tier first, connected accounts first, or inferred from them — api `fundingOrder.ts`)
 * instead of a client default overriding it.
 */
declare function routingModeForSelection(selection: ChatModelSelection): 'byo_pool' | undefined;
/** The selectable model surface, grouped by WHO PAYS (see {@link ModelCategory}). */
interface ChatModelOptions {
    /** Tenant-defined named LLM configs (`tenant_model:<slug>`). */
    configured?: Array<{
        id: string;
        label: string;
    }>;
    /** Models served by a runtime on the user's OWN machine (`local/<runtime>/<model>`).
     *  `runtime` is the display name of what serves it (Ollama, FreeToken). */
    local?: Array<{
        id: string;
        label: string;
        runtime: string;
    }>;
    /** Models the tenant's own connected provider accounts can serve. */
    byo: Array<{
        id: string;
        vendor: string;
        cost?: string;
    }>;
    /**
     * `false` where the host cannot carry "your connected accounts" (`routingMode:
     * 'byo_pool'`) to the gateway — Rovr pins one model string — so the pool row is not
     * offered as a choice the host would quietly turn into Auto. Default: offered.
     */
    byoPool?: boolean;
    free: Array<string | {
        id: string;
        cost?: string;
    }>;
    plan: Array<string | {
        id: string;
        cost?: string;
    }>;
    paid: Array<string | {
        id: string;
        cost?: string;
    }>;
}
/** Funding tier of a model row — the axis the list is grouped and filtered by. */
type ModelCategory = 'auto' | 'local' | 'byo' | 'free' | 'plan' | 'paid' | 'configured';
/** One row in the model list. `detail` is the funding sentence for that row. */
interface ModelItem {
    key: string;
    label: string;
    detail: string;
    category: ModelCategory;
    selection: ChatModelSelection;
}
/**
 * The strings a model list needs. Hosts pass their own localized bundle (the web
 * app via next-intl, the VS Code surfaces via `vscode.l10n`); the English defaults
 * keep the list readable unmapped. The composer menu's own chrome extends this
 * (see `PromptOptionsLabels` in brain-ui).
 */
interface ModelChoiceLabels {
    categoryAuto: string;
    categoryByo: string;
    categoryFree: string;
    categoryPlan: string;
    categoryPaid: string;
    categoryConfigured: string;
    /** Group name for models served by a runtime on this machine. */
    categoryLocal: string;
    /** The funding sentence for the routed row. Its NAME comes from the product
     *  ({@link BUILDERFORCE_PRODUCT_NAME}), not from a label — a brand token is not
     *  translated, and the tier it states must match what the gateway actually funds. */
    autoDetail: string;
    poolLabel: string;
    poolDetail: string;
    freeDetail: string;
    planDetail: string;
    paidDetail: string;
    /** Per-model premium price line. `{input}` / `{output}` are the formatted
     *  per-1M-token rates (see {@link premiumCostLabel}). */
    paidCostDetail: string;
    /** `{vendor}` is substituted with the connected provider's display name. */
    byoDetail: string;
    configuredDetail: string;
    /** Funding sentence for an on-device row. `{runtime}` is the serving runtime's name. */
    localDetail: string;
    /** Display name for a `project_evermind:<id>` pin (the raw pin is not a model name). */
    evermindLabel: string;
    /** Funding line for a `project_evermind:<id>` pin (a plan feature, not a catalog model). */
    evermindDetail: string;
}
declare const DEFAULT_MODEL_CHOICE_LABELS: ModelChoiceLabels;
declare function byoVendorLabel(vendor: string): string;
/** A gateway per-token rate as the per-1M-token price every surface quotes. */
declare function perMillionUsd(rate: number): string;
/**
 * What a premium (metered) model costs, formatted from the gateway's per-token
 * rates against the host's localized `paidCostDetail` line. For a host with an
 * ICU formatter (the web app) prefer interpolating {@link perMillionUsd} through
 * it; this is the plain-substitution path for hosts without one.
 */
declare function premiumCostLabel(pricing: {
    prompt: number;
    completion: number;
}, template: string): string;
/** The categories, in display order. Only the populated ones are ever offered. */
declare const MODEL_CATEGORIES: ModelCategory[];
declare function modelCategoryLabel(category: ModelCategory, labels: ModelChoiceLabels): string;
/**
 * Every selectable route, ordered by what it COSTS the user: BuilderForce
 * collections (free → plan → paid) lead, then the tenant's own connected
 * accounts (BYO pool + its models, in the server-supplied provider priority
 * order), then saved workspace LLM configs. A model already listed in a cheaper
 * group is never repeated.
 *
 * On-device models lead the whole list: they spend nothing, need no account, and run
 * on hardware the user has already paid for, so nothing on the list is cheaper.
 *
 * `identity` names the ROUTED row after the product that actually funds it —
 * "Builderforce Free" / "Builderforce PRO" rather than a bare "Auto" — because that
 * is the thing the user bought and the only honest answer to "what am I running on?"
 * when the gateway picks per turn. Omit it and the row degrades to the free product
 * (see {@link DEFAULT_MODEL_IDENTITY}: the safe default is masked, never leaked).
 */
declare function buildModelItems(options: ChatModelOptions, labels: ModelChoiceLabels, identity?: ModelIdentityContext): ModelItem[];
/**
 * The options with every DOWNLOADED page-engine model (the picker's local model store
 * rows in state `ready`) joined to the on-device group — so a model fetched into this
 * browser is a row like any other: listed under All, searchable, and named as the model
 * in use once pinned. Rows already present (an HTTP runtime serving the same ref) are
 * left as they are; the builder never repeats an id.
 */
declare function withReadyPageModels(options: ChatModelOptions, rows: readonly LocalModelRow[] | null | undefined): ChatModelOptions;
/** The key identifying the active row (matches {@link ModelItem.key}). */
declare function activeModelKey(selection: ChatModelSelection): string;
/** Search + category narrowing. Matches label, funding detail, and category name. */
declare function filterModelItems(items: ModelItem[], labels: ModelChoiceLabels, query: string, category: 'all' | ModelCategory): ModelItem[];
/**
 * What is ACTUALLY running the next turn, said in one line: the pinned model, the
 * BYO pool, or — under `auto` — the routing PRODUCT that funds it.
 *
 * `effective` (what the host resolved an `auto` turn to) is honoured only when it names
 * something the user owns: a project-Evermind head, a saved workspace LLM config, or —
 * for a viewer entitled to pick models at all — a catalog id. On a routed plan the
 * answer is the product, not the upstream model the cascade happened to reach for; see
 * `modelIdentity.ts` for why. This is the fix for a free-plan composer that announced
 * "minimaxai/minimax-m3" beside a menu that would not let the user change it.
 */
declare function modelInUse(selection: ChatModelSelection, items: ModelItem[], labels: ModelChoiceLabels, effective?: string, identity?: ModelIdentityContext): {
    name: string;
    detail: string;
};

/**
 * THE mode a model pick implies — so the model a person picks is the model that runs, on
 * every host and from every picker (the `/` menu, the editor's QuickPick, Kimi connect).
 *
 * Hybrid only TRIES a pick (`createHostModelStream`: never hard-pinned, so the gateway may
 * fail it over and the turn falls back to Auto), and Local only sets aside any pick that
 * leaves the device. A pick left under either read as "picked Kimi, got MiniMax" while the
 * mode control still showed the old mode. So a pick moves the mode with it:
 *
 *   - a model or "your connected accounts" ⇒ Specific (hard-pinned, no fallback);
 *   - Auto while on Specific ⇒ Hybrid (Specific with nothing picked is `no_specific_model`);
 *   - an ON-DEVICE pick under Local only keeps Local only — it already runs as picked.
 *     On-device is the registry's `onDevice` (`runsOnDevice`), the same rule the stream
 *     applies, so a Kimi Code pick (local grammar, hosted) is NOT on-device;
 *   - UNDECIDED Local only (the person never chose; for an anonymous web visitor that
 *     question is the Hybrid opt-in) is never lifted by a pick: the first-run question
 *     still holds the next turn and asks.
 *
 * Returns the mode to switch to, or null when the mode in force already honours the pick.
 * Pure — the host applies it through its own mode setter.
 */

declare function inferenceModeForModelPick(current: InferenceMode, selection: ChatModelSelection, options?: {
    undecided?: boolean;
}): InferenceMode | null;

/**
 * THE hand-off from the routing step to a host's UI when Hybrid's pick failed and the
 * turn was answered with Auto (`createHostModelStream`'s `onFallback`). The stream runs
 * where the host builds it (a config module, the extension host, Rovr's worker), not
 * inside the component that shows the notice, so the event crosses through a channel:
 * the stream's `onFallback` is the channel's `report`, and the surface subscribes.
 *
 * One channel per host; it keeps the latest event until dismissed, so a notice raised
 * before the surface mounted is still shown.
 */

interface ModelFallbackChannel {
    /** Pass as `createHostModelStream({ onFallback })`. */
    report: (event: ModelFallbackEvent) => void;
    /** Called on every report and on `clear`. */
    subscribe: (listener: () => void) => () => void;
    /** The latest undismissed event, or null. */
    latest: () => ModelFallbackEvent | null;
    /** Dismiss the notice. */
    clear: () => void;
}
declare function createModelFallbackChannel(): ModelFallbackChannel;
/** The notice's one line: the host's localized template with its `{model}` token filled. */
declare function modelFallbackText(template: string, event: Pick<ModelFallbackEvent, 'from'>): string;
/** English default — every host passes its own localized template. */
declare const DEFAULT_MODEL_FALLBACK_TEMPLATE = "Your pick {model} failed; answered with Auto.";

/**
 * E5 — the VERIFIED local label (cost lever `e5_verified_local_label`).
 *
 * The transport label says a local turn "succeeded" when the local model served (no
 * throw, a non-empty answer). That teaches the `run.local-success` predictor that a
 * served-but-wrong answer is a success. With the lever on and a verdict supplied, the
 * label is served AND the verdict passed; with no verdict (it never came, or timed out)
 * the transport label stands — today's behaviour.
 *
 * WHERE A BRAIN TURN'S VERDICT COMES FROM. A local answer is settled before anyone has
 * judged it, so the router's record is DEFERRED by turn ({@link createDeferredLocalRecords})
 * and resolved by the first of:
 *   - `retry`       — the next call in the same chat re-sends the SAME user message with
 *                     nothing after it (regenerate / resend): failed;
 *   - `tool_schema` — the next call is the same submit's next tool-loop iteration and a
 *                     tool result for this turn's calls is the agent loop's
 *                     malformed/truncated-arguments refusal (`@builderforce/agent-loop`
 *                     `MALFORMED_CALL_RESULT` / `TRUNCATED_CALL_RESULT`): failed;
 *   - `tool_ok`     — that next iteration carries this turn's tool results, none refused: passed;
 *   - `continued`   — the next call in the chat is a different user message (the person
 *                     moved on rather than retrying): passed;
 *   - `rating`      — a host reports an explicit thumb on the chat's latest reply
 *                     ({@link submitLocalTurnVerdict});
 *   - the timeout   — {@link LOCAL_VERDICT_TIMEOUT_MS}: the transport label.
 * Everything is read on this device from the calls themselves — no model call, no network.
 */

/**
 * An explicit verdict on chat `chatId`'s latest local reply (a host's thumbs-down /
 * thumbs-up). A no-op when that reply is not waiting — recorded already, or not local.
 */
declare function submitLocalTurnVerdict(chatId: number, passed: boolean): boolean;

/**
 * The per-turn AFFECT block, appraised on this device — never a platform call.
 *
 * Every Brain host folds a fresh affect block into each turn's system prompt: the
 * limbic state after appraising THIS turn's text, seeded from the person's personality
 * ("personality = setpoints, limbic = dynamics"). Until 2026-10-21 each host POSTed the
 * text to `/api/limbic/block` per turn — a platform round-trip for a pure, deterministic
 * computation, which an anonymous or offline person could not make at all.
 *
 * The appraisal is Evermind's own limbic (`@seanhogg/builderforce-memory-engine/limbic`,
 * the dependency-free half; registered as `limbic.affect` in the ML task catalog, whose
 * heuristic regions are the trainable head's teacher and always-available answer), and
 * the personality projection is the shared psychometric vocabulary
 * (`@builderforce/agent-tools` `limbicTraits`). Both are composed here once, so the web
 * app, Rovr and the VS Code extension appraise a turn identically.
 *
 * The STATIC personality tone (`personaBlock`) is a separate, session-cached concern —
 * this module only renders the dynamic layer.
 */

/**
 * The resting limbic state a personality relaxes toward — the seed every turn's
 * appraisal starts from. Neutral when there is no profile.
 */
declare function personalitySetpoints(profile: PsychProfile | null | undefined): LimbicState;
/**
 * The dynamic affect block for one turn: `text` appraised from `setpoints` (a
 * personality's resting state — {@link personalitySetpoints}; neutral when absent).
 * '' for an empty turn and at rest, so a no-op turn adds nothing to the prompt.
 */
declare function turnAffectBlock(text: string, setpoints?: LimbicState | null): string;

/**
 * The Brain's binding of the ONE transcript summarizer (`summarizeTranscript`,
 * `@seanhogg/builderforce-memory/working`) onto its streaming transport. The prompt,
 * rendering and budget are the memory package's; this only turns the run's stream into
 * the summarizer's completion port, so a compaction fold, a hand-off note and a chat
 * "Consolidate" all compress through the same call.
 */

/**
 * The slice of the run's streaming transport the summarizer uses — typed structurally so
 * this module does not depend on the run store (`BrainStreamFn` satisfies it).
 */
type SummaryStreamFn = (opts: Omit<StreamChatOptions, 'transport'>) => Promise<Pick<StreamChatResult, 'text'>>;
/** The summarizer's completion over the run's stream: one no-tools, no-reasoning call.
 *  A note is a UTILITY completion, never the run's full output ceiling or thinking depth.
 *
 *  `reasoning: off` is a request, not a guarantee: MiniMax and Kimi still think inline,
 *  and chat #5739's every fold note was "<think>We need produce memory compression…" —
 *  the note budget spent deliberating, the facts it should have carried lost, and the run
 *  re-reading what it had folded. The note is the ANSWER alone, never the markup. A reply
 *  that is nothing but reasoning (or a block the output ceiling cut off) keeps that
 *  reasoning's TEXT, untagged: it usually holds the facts, and an empty note would make
 *  the window re-run this whole call on every turn, since a failed fold is not memoized. */
declare function streamSummaryCompletion(stream: SummaryStreamFn, model: string | undefined): SummaryCompletion;

/**
 * The Brain's binding of `@seanhogg/builderforce-memory/handoff` — fit a working
 * transcript into the window of the model about to serve it (PRD 34 §3.4). This folder
 * is the WINDOW FIT: it re-packs the transcript for a smaller (or different) model. It is
 * not the plan→code role hand-off (`@builderforce/run-policy`) nor the `hand_off` tool
 * (`planHandoff.ts`), which decide WHO serves — this only makes the request fit them.
 *
 * The packer is the memory package's; this module only supplies what is the Brain's:
 *
 *   - `summarize` — the run's own middle summarizer (`summarizeMiddle`, the one auto-
 *     compaction folds with), so a hand-off note reads like a compaction note;
 *   - `recall` — the run's Evermind recall for the latest directive, rendered by
 *     `formatEvermindMemoryBlock` exactly as the pre-turn recall is;
 *   - the budget inputs — the advertised tool schemas and the request's output reserve,
 *     sized by the shared `@builderforce/run-policy` helpers every host packs with, and
 *     (cost PRD C9) the `to` model's long-context price boundary;
 *   - the `llm.handoff` trace, through the caller's hook.
 *
 * {@link createHandoffFit} wraps it as the per-attempt `fit` a local-first host lends
 * `createLocalFirstStream` (its public name is kept: every host lends it by that name).
 */

/** The `llm.handoff` trace payload. */
interface WindowFitTrace {
    from?: string;
    to: string;
    dropped: number;
    summarized: boolean;
    recalled: boolean;
    estimatedTokens: number;
    fits: boolean;
}
/** The summarizer the note may use: the run's stream, the model that writes it, Stop. */
interface WindowFitSummarizer {
    stream: SummaryStreamFn;
    model?: string;
    signal?: AbortSignal;
}
/** An Evermind recall — structurally `EvermindRunHooks['recall']`. */
type WindowFitRecall = (query: string) => Promise<EvermindRecallResult | null>;
interface PackForModelInput {
    messages: ChatCompletionMessage[];
    /** The model about to serve (its ref), and the one that served last. */
    to: string;
    from?: string;
    /** The `to` model's context window, in tokens. */
    contextTokens: number;
    /** The tool schemas this request advertises. */
    tools?: readonly unknown[];
    /** The request's `max_tokens` — held back for the reply. */
    maxTokens?: number;
    summarizer?: WindowFitSummarizer;
    recall?: WindowFitRecall;
    timeoutMs?: number;
    onTrace?: (trace: WindowFitTrace) => void;
}
interface PackForModelResult {
    messages: ChatCompletionMessage[];
    pack: HandoffPack;
}
/** Estimated tokens the advertised tool schemas cost, by the packer's own estimate. */
declare function toolSchemaTokens(tools: readonly unknown[] | undefined): number;
/** Pack `messages` for the `to` model's window. Never throws for a failing summarizer
 *  or recall — the packer falls through to the next note source. */
declare function packForModel(input: PackForModelInput): Promise<PackForModelResult>;
/** What a host may lend {@link createHandoffFit}. */
interface HandoffFitOptions {
    summarizer?: WindowFitSummarizer;
    recall?: WindowFitRecall;
    timeoutMs?: number;
    onTrace?: (trace: WindowFitTrace) => void;
}
/**
 * The per-attempt `fit` for `createLocalFirstStream`: pack the call for the local model
 * about to take it. A target whose window is unknown gets the messages untouched. The
 * last pack per (conversation, model, window) is memoised (`packMemo.ts`) and reused —
 * the turns since appended — until it overflows, so a local model is not re-packed and
 * re-summarized on every call of a conversation. Keyed by the CONVERSATION too: the fit
 * is one per host process, and two chats on one local model must not overwrite each
 * other's pack. At most {@link HANDOFF_FIT_MEMOS} are kept, least recently used first out.
 */
declare function createHandoffFit(options?: HandoffFitOptions): LocalAttemptFit;

/**
 * Chrome's built-in model, reached through the Prompt API — the ONE detection of it.
 *
 * The Brain's local-first path (the in-page engine in `browserEngine.ts`) asks three
 * questions of it — is the surface there at all, is the model ready, and how does a
 * stream of output become deltas — and they are answered here once, structurally typed so
 * no host depends on an ambient DOM lib that may not have caught up with the API yet.
 *
 * The current surface is the `LanguageModel` global (Chrome 138+); older builds exposed
 * `self.ai.languageModel` with a `capabilities()` probe instead of `availability()`. Both
 * are read, and both answers normalise to the current vocabulary.
 */
/** One message of a session's seeded conversation. */
interface PromptApiMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
/** A live session — minimal structural typing of what the hosts call. */
interface PromptApiSession {
    prompt(input: string, opts?: {
        signal?: AbortSignal;
    }): Promise<string>;
    promptStreaming(input: string, opts?: {
        signal?: AbortSignal;
    }): ReadableStream<string>;
    /** Forks the conversation, PRESERVING the original session's initial prompts —
     *  it takes only `{ signal }`, so it can never install a different system
     *  prompt. Changing the system prompt therefore requires a fresh `create()`. */
    clone(opts?: {
        signal?: AbortSignal;
    }): Promise<PromptApiSession>;
    destroy(): void;
    readonly inputUsage?: number;
    readonly inputQuota?: number;
    /** Legacy (pre-138) name of the session's token budget. */
    readonly maxTokens?: number;
    /** Tokens `input` would add to the session (138+). */
    measureInputUsage?(input: string, opts?: {
        signal?: AbortSignal;
    }): Promise<number>;
    /** Legacy (pre-138) token accounting; guarded because newer builds drop it. */
    countPromptTokens?(input: string): Promise<number>;
}
/** The current availability vocabulary. */
type PromptApiAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
interface PromptApiFactory {
    availability?(): Promise<PromptApiAvailability | 'readily'>;
    /** Legacy (pre-138) readiness probe. */
    capabilities?(): Promise<{
        available?: 'readily' | 'after-download' | 'no';
    }>;
    create(opts?: {
        temperature?: number;
        topK?: number;
        initialPrompts?: PromptApiMessage[];
        signal?: AbortSignal;
        monitor?: (m: EventTarget) => void;
    }): Promise<PromptApiSession>;
}
/** Resolve the Prompt API factory across the current global (`LanguageModel`) and
 *  the legacy `self.ai.languageModel` surface, or null when the browser lacks it. */
declare function promptApiFactory(): PromptApiFactory | null;
/** True when this browser exposes the built-in Prompt API surface at all.
 *  (Actual model availability is async — see {@link promptApiAvailability}.) */
declare function hasPromptApi(): boolean;
/**
 * What the browser says about its model, in the current vocabulary. Asking NEVER starts
 * a download — only `create()` does — so a router may ask freely. Any failure reads as
 * `unavailable`.
 */
declare function promptApiAvailability(factory?: PromptApiFactory | null): Promise<PromptApiAvailability>;
/** The session's input budget in tokens, under either generation's name. */
declare function promptApiInputQuota(session: PromptApiSession): number | undefined;
/** Tokens `input` would add to the session, or undefined when the build cannot say. */
declare function promptApiMeasure(session: PromptApiSession, input: string, signal?: AbortSignal): Promise<number | undefined>;
/**
 * The deltas of a `promptStreaming` stream. Chrome ≥138 yields incremental deltas; older
 * builds yielded the full cumulative string — normalised here so a consumer never
 * double-counts. Releases the reader however iteration ends.
 */
declare function promptStreamDeltas(stream: ReadableStream<string>): AsyncGenerator<string>;

/**
 * The browser's OWN model as a local-first runtime — Chrome's built-in model (Gemini
 * Nano) behind the Prompt API, as one {@link PageEngine}.
 *
 * Nothing about local-first changes for it. The registry knows it as the `browser`
 * runtime (`reach: 'page'`, so no HTTP prober ever contacts it); {@link promptApiEngine}
 * reports its one model the way an HTTP probe reports a runtime's catalog, and answers a
 * chat completion as OpenAI chunks that the ONE page shim (`pageEnginesFetch`) serves as
 * SSE. The shared streamer drives it exactly like Ollama: same plan (a tool turn never
 * goes to it — the Prompt API has no tool-call protocol), same failover (a refusal, an
 * oversized prompt or an unavailable model is thrown before the first chunk, so the
 * gateway answers invisibly), same Stop.
 *
 * Readiness is asked WITHOUT starting a download: a model that is `downloadable` or
 * `downloading` is not offered — a chat turn must never be the thing that pulls a
 * multi-gigabyte model onto someone's machine.
 */

/** The id the browser engine's one model goes by (`local/browser/gemini-nano`). */
declare const BROWSER_ENGINE_MODEL = "gemini-nano";
/** The window assumed when the browser will not say (Gemini Nano's smallest shipped
 *  input quota, rounded down) — conservative, so the plan sends a long call to the cloud
 *  rather than discovering the overflow at the engine. */
declare const BROWSER_ENGINE_FALLBACK_CONTEXT_TOKENS = 4096;
/** The browser runtime's probe (null when the model is not ready) and its reset. */
type BrowserEngineProber = Pick<PageEngine, 'probe' | 'invalidate'>;
/**
 * A memoizing prober for the browser engine. The input quota, once learned, is kept for
 * the prober's lifetime (it is a property of the installed model).
 */
declare function createBrowserEngineProber(config?: {
    ttlMs?: number;
    now?: () => number;
}): BrowserEngineProber;
/** The request messages as the Prompt API takes them: a seeded conversation plus the
 *  prompt — or why this request cannot be served here. */
declare function toPromptApiTurn(messages: unknown): {
    initialPrompts: PromptApiMessage[];
    prompt: string;
} | {
    error: string;
};

/**
 * THE fetch shim for every in-page engine — one `fetch` that answers
 * `POST <engine root>/v1/chat/completions` from the matching {@link PageEngine} and
 * passes every other request to the host's own fetch.
 *
 * Lent to `createLocalFirstStream` (or `completeLocalFirst`) as the local fetch, it makes
 * a page engine indistinguishable from Ollama to the shared streamer: the same OpenAI
 * SSE, the same failover and the same Stop. Three rules carry that:
 *
 *  - the FIRST chunk is pulled before the 200 is answered, so a refusal or a failure at
 *    the engine is a non-2xx the failover can still route around — nothing reached the
 *    user yet;
 *  - a failure AFTER the first chunk is an in-band `error` frame: the turn is committed,
 *    so the streamer reports an interruption rather than failing over;
 *  - an abort is re-thrown, never answered — a Stop is not a refusal.
 *
 * A non-streaming request is answered as one JSON completion folded from the same chunks.
 */

/**
 * A `fetch` that answers each engine's chat route in the page and passes every other
 * request to `base` — the HTTP runtimes keep reaching their servers through it.
 */
declare function pageEnginesFetch(engines: readonly PageEngine[], base?: LocalFetch): LocalFetch;
/** Every engine's probe, concurrently, keeping the ones with something to serve. An
 *  engine's probe never rejects — its failure is handled (and reported) in
 *  `memoizedProbe` — so one engine's failure cannot sink the others'. */
declare function probePageEngines(engines: readonly PageEngine[], options?: {
    fresh?: boolean;
}): Promise<LocalRuntimeProbe[]>;

/**
 * Every page engine a host carries, composed ONCE — so the web app, Rovr and the editor's
 * webview do not each wire the same three engines, cache and store.
 *
 * What a host supplies is only what differs between hosts: how to start its `bfi` Web
 * Worker (`bfiWorker` — a worker module calling `runBfiWorker()`, plus the wasm URLs;
 * every host passes one, and absent = the `bfi` engine is not offered and its catalog
 * rows read `engine_unavailable`) and an optional WebLLM worker. `bfi` never runs on the
 * page's own thread (`bfiWorkerEngine.ts`). What it gets back is the probe and
 * fetch the local-first stream takes, and the model store the picker drives.
 */

interface PageEngineSet {
    engines: readonly PageEngine[];
    /** The picker's ONE API over every engine's downloads. */
    store: LocalModelStore;
    /** Every engine with something to serve. Memoized per engine; never downloads. */
    probe(options?: {
        fresh?: boolean;
    }): Promise<LocalRuntimeProbe[]>;
    /** The local fetch: page engines answered in the page, everything else via `base`. */
    fetch(base?: LocalFetch): LocalFetch;
}
interface PageEngineSetOptions {
    /** `bfi` in a dedicated Web Worker (every host: the web app, Rovr, the editor's
     *  webview — which also passes `backends: ['webgpu']`, its host's CPU `peerSupport` and
     *  `relayStore`). Absent = no `bfi` engine here. */
    bfiWorker?: Omit<BfiWorkerEngineOptions, 'store'>;
    /** Where `hf-file` models are stored; default this origin's Cache Storage. The editor
     *  webview passes the extension host's file cache, so a model is downloaded once. */
    hf?: HfModelStore;
    /** A module worker running WebLLM's `WebWorkerMLCEngineHandler`; absent = in-page. */
    webllmWorkerUrl?: string | URL;
}
declare function createPageEngineSet(options?: PageEngineSetOptions): PageEngineSet;

/**
 * What this page's WebGPU adapter offers, read WITHOUT creating a device — the support
 * record `localModelFit` checks a catalog model against. The WebLLM engine and the model
 * store's picker rows read it; `bfi` answers the same record itself
 * (`BfiEngine.support()`). Structurally typed: the DOM lib does not carry WebGPU yet.
 */

/**
 * Whether this browser exposes WebGPU at all — synchronous, requests no adapter, so it is
 * safe during render. The ONE feature check for every on-device surface in a host (the
 * semantic cache's embedder, voice, training badges); what the adapter can actually do is
 * {@link webGpuSupport}'s question.
 */
declare function hasWebGPU(): boolean;

/**
 * Is a pinned ref a PAGE-runtime model (`local/{bfi,webllm,browser}/<model>`), and where
 * is its root? Decided by the registry's `reach`, never by comparing runtime ids.
 *
 * A page runtime has no URL anyone configures: its root is the registry's non-routable
 * `http://<runtime>.local`, answered by the page engines' ONE fetch shim. So a page pin
 * needs nothing from a host's settings: it is `createHostModelStream`'s default local-pin
 * resolution, handed to the ONE pinned-local path (`createLocalStream`) with the fetch
 * that reaches the engines (the page's own `pageEnginesFetch` on the web and in Rovr; the
 * postMessage bridge's in the editor). That path packs each call for the pinned model's
 * window (the catalog's `contextTokens`) exactly as for any local pin.
 */

interface PageRuntimePin {
    provider: LocalRuntimeId;
    /** The bare id the engine knows. */
    model: string;
    /** The runtime's in-page root — what the shim answers. */
    endpoint: LocalEndpoint;
}
/** The pin when `ref` names a model on a PAGE runtime; null for anything else (a gateway
 *  id, an HTTP runtime's model, nothing). */
declare function pageRuntimePin(ref: string | undefined): PageRuntimePin | null;

/**
 * ONE reading of an OpenAI-compatible `finish_reason`.
 *
 * A turn that ends without tool calls is not automatically a turn where the model
 * chose to speak. Two stop reasons mean the opposite — the model was INTERRUPTED
 * mid-output — and they need the opposite recovery from a normal empty answer:
 *
 *  - TRUNCATED: the response hit the output-token ceiling. Vendors spell this
 *    `length` (OpenAI-compatible), `max_tokens` (Anthropic) and `MAX_TOKENS`
 *    (Google). A tool call cut off here never reaches the caller at all, because
 *    its JSON arguments are incomplete — which is exactly how a canvas turn that
 *    was authoring a real artifact appears as "the model just didn't call a tool".
 *  - MALFORMED_TOOL_CALL: the model tried to call a tool and emitted arguments the
 *    provider could not parse (Gemini's `MALFORMED_FUNCTION_CALL`). Also an
 *    attempted action, not a spoken answer.
 *
 * Vendors are compared case-insensitively and by normalised shape so a new spelling
 * of the same condition does not silently degrade to "the model answered".
 */
type TurnInterruption = 'truncated' | 'malformed-tool-call';
/** The reason this turn was cut short, or `null` when it ended on its own terms. */
declare function turnInterruption(finishReason: string | null | undefined): TurnInterruption | null;
/** The response hit the output-token ceiling — its text and any tool call are incomplete. */
declare function isTruncatedTurn(finishReason: string | null | undefined): boolean;
/** The model attempted a tool call the provider could not parse. */
declare function isMalformedToolCall(finishReason: string | null | undefined): boolean;

/**
 * composerDirectives — the ONE compiler from the composer's toggles (Effort,
 * Browse-the-web) to the extra system-prompt directives a turn carries.
 *
 * ## Why it lives here
 *
 * There were two copies: `frontend/src/lib/brain/platformPrompt.ts` and a module-private
 * one inside `clients/vscode/webview/src/App.tsx`. They had already drifted three ways,
 * and each drift is a behaviour difference a user can feel:
 *
 *  1. **Effort prose vs. real params.** The web copy hardcoded the two effort sentences;
 *     the VS Code copy derived them from {@link effortProfile}, the same table that sets
 *     `max_tokens` and `reasoning.level`. Hardcoded prose can contradict the params it is
 *     supposed to describe. This version always derives.
 *  2. **A "think step by step" sentence.** The web copy still emitted it even though the
 *     same component sends a structured `reasoning.level` on the wire — two mechanisms for
 *     one intent, the weaker one invisible in the request. Dropped: Thinking is a real
 *     field ({@link reasoningForRun}), not a sentence.
 *  3. **A web-fetch tool name that does not exist.** One copy said `` `fetch_url` ``, the
 *     other `` `web.fetch` ``. The tool is advertised to the model as
 *     {@link WEB_FETCH_TOOL_NAME}. Naming a tool the model was never given is the exact
 *     documented failure that `api/scripts/check-prompt-tool-names.mjs` exists to stop —
 *     the model narrates a call it cannot make and the turn "succeeds". Both copies were
 *     wrong; this one is right, in one place.
 *
 * Pure, host-agnostic, no React: the two surfaces call this and render nothing of their
 * own.
 */

/**
 * The name the platform's web-fetch tool is ADVERTISED to the model under.
 *
 * The catalog id is `web.fetch`; the gateway advertises every builtin as
 * `builtin_<id with non-alphanumerics → _>` (api `toolNaming.ts` `advertisedName`). A
 * prompt must name the ADVERTISED name — a prompt naming the catalog id hands the model a
 * string that appears nowhere in its tool list, and the model responds by describing the
 * call instead of making it, with no error anywhere in the loop.
 */
declare const WEB_FETCH_TOOL_NAME = "builtin_web_fetch";
/** The composer toggles that compile into prompt directives. */
interface ComposerDirectiveOptions {
    /** Effort level; `balanced` (or absent) is neutral and contributes nothing. */
    effort?: Effort;
    /** Whether the "Browse the web" toggle is on for this turn. */
    web?: boolean;
}
/**
 * Compile the composer toggles into extra system-prompt directives, folded into the
 * Brain's ambient system context so a toggle actually changes how the next turn runs.
 *
 * Returns `''` when nothing is set — the neutral default, which must add no text at all
 * so a default turn's prompt is byte-identical to one from before the feature existed.
 * Blocks are joined with a blank line so each directive reads as its own instruction.
 */
declare function buildComposerDirectives(o: ComposerDirectiveOptions): string;

/**
 * useToolConfirmationGate — the ONE human-in-the-loop approval gate for the Brain.
 *
 * ## The subtlety this exists to preserve
 *
 * `needsConfirm` is captured ONCE, at run start, by the tool loop. So the flag it reads
 * must be a REF, not captured state: with plain state the callback the run is holding
 * keeps the value it had when the run began, and a user who ticks "auto-approve" mid-run
 * is prompted for every remaining tool call anyway — the reported "I checked the box and
 * still got three prompts" bug. The ref is the source of truth; the returned
 * `autoApprove` state exists only to drive the toggle's own rendering.
 *
 * That is exactly the kind of non-obvious invariant that does not survive being
 * hand-copied, and it was hand-copied: the web `BrainPanel` and the VS Code webview each
 * had their own ~25-line version. They had already drifted — the predicate's operands
 * were in opposite order, and only one of them persisted the setting — so the same
 * product decision ("does auto-approve stick between sessions?") was answered differently
 * on each surface by accident rather than on purpose.
 *
 * ## What is shared and what is injected
 *
 * The GATE LOGIC is shared: ref-backed liveness, the `mutating && !autoApprove` predicate,
 * and a referentially stable `needsConfirm`. PERSISTENCE is injected, because it is a real
 * per-host decision — a browser has `localStorage` scoped to the user's profile, a VS Code
 * webview's storage is partitioned and may be blocked outright. A host that passes no
 * `persistence` simply starts from `defaultOn` each session, which is a policy, not a
 * missing feature.
 */
/** Reads and writes the persisted auto-approve preference for one host. */
interface ToolConfirmationPersistence {
    /** Current stored preference, or `undefined` when nothing has been stored. */
    read(): boolean | undefined;
    /** Persist the preference. Must never throw — storage can be blocked. */
    write(on: boolean): void;
}
interface ToolConfirmationGateOptions {
    /**
     * Does this call mutate anything? Supplied by the host's tool registry — normally
     * `isMutating` from `useBrainActions()`. A throwing predicate must be treated as
     * mutating by its implementation (fail safe), which `BrainActionsContext` already does.
     */
    isMutating: (name: string, args: unknown) => boolean;
    /** Where to persist the preference. Omit for a session-only gate. */
    persistence?: ToolConfirmationPersistence;
    /** Value used when nothing is persisted yet. Defaults to `false` (always confirm). */
    defaultOn?: boolean;
}
interface ToolConfirmationGate {
    /** Whether auto-approve is on — for rendering the toggle ONLY, never for the gate. */
    autoApprove: boolean;
    /** Flip auto-approve. Takes effect immediately, including for a run already in flight. */
    setAutoApprove: (on: boolean) => void;
    /**
     * The predicate handed to `useBrainConversation({ needsConfirm })`. Referentially
     * stable across auto-approve changes — deliberately, so toggling it does not tear down
     * and restart the conversation.
     */
    needsConfirm: (req: {
        name: string;
        args: unknown;
    }) => boolean;
}
declare function useToolConfirmationGate(options: ToolConfirmationGateOptions): ToolConfirmationGate;
/**
 * A `localStorage`-backed {@link ToolConfirmationPersistence}, guarded so a blocked or
 * partitioned store degrades to "not persisted" instead of throwing during render.
 * `'1'`/`'0'` rather than JSON so an existing stored value keeps its meaning.
 */
declare function localStorageConfirmationPersistence(key: string): ToolConfirmationPersistence;

/**
 * Attachments on the way IN to a turn — the two steps `useBrainConversation` used to do
 * inline, kept here so that hook does not grow:
 *
 *   • {@link prepareAttachment}: a picked / dropped / pasted file becomes a pending
 *     attachment. A picture is prepared FIRST (`imagePrep.ts`) so the re-encoded copy —
 *     not the full-size original — is what gets uploaded; a picture too large to inline
 *     is handed over by a signed URL. A host that cannot give it one says so with an
 *     {@link AttachmentRefusedError}, which reaches the person instead of a dead link.
 *   • {@link attachmentTurnContent}: the model-visible content of a turn. Pictures become
 *     `image_url` vision parts; attachments the host can READ (`inlineAttachments` — the
 *     editor's text files and "Add context") become fenced text under the mention budget;
 *     anything else stays a link. With neither, it is exactly the display text.
 */

/** A text file larger than this is never read to be inlined (it would be cut to the
 *  mention budget anyway): a host uploads it, or leaves it to a tool. */
declare const MAX_INLINE_TEXT_BYTES = 2000000;
/**
 * A host's refusal to make an attachment model-readable, worded for the person (e.g. a
 * large picture while signed out). Thrown by an adapter; {@link prepareAttachment} lets
 * it through where any other failure falls back to the text link.
 */
declare class AttachmentRefusedError extends Error {
    constructor(message: string);
}

/**
 * The platform's two URLs for an uploaded Brain file — ONE spelling for every client
 * that names one (the web's REST adapter, the editor host's upload):
 *
 *   • `brainUploadUrl` — the tenant-authenticated read (`GET /api/brain/uploads/:key`),
 *     which is also the link a turn names an attachment by (the key is what
 *     `builtin_attachments_read` takes);
 *   • `signedBrainFileUrl` — the short-lived public read an upstream LLM fetches
 *     (`/api/brain-files/:key?exp&sig`, signed at `POST /api/brain/uploads/sign`).
 */
/** The authenticated read URL of an uploaded file. */
declare function brainUploadUrl(baseUrl: string, key: string): string;
/** The signed public read URL of an uploaded file, from the signing endpoint's answer. */
declare function signedBrainFileUrl(baseUrl: string, key: string, signed: {
    exp: number;
    sig: string;
}): string;
/** The signing endpoint (POST `{ key }` → `{ exp, sig }`). */
declare const BRAIN_UPLOAD_SIGN_PATH = "/api/brain/uploads/sign";
/** The upload endpoint (multipart, field `file` → `{ key, name, type }`). */
declare const BRAIN_UPLOAD_PATH = "/api/brain/upload";

/**
 * ON-DEVICE memory for the shared Brain — a memory tier that answers from the user's
 * own machine, with no server in the path at all.
 *
 * WHAT WAS MISSING. `evermindMemory.ts` describes memory hooks whose "heavy lifting
 * lives server-side": recall, the Q&A cache and the Evermind SSM are all HTTP calls
 * bound to a project. The in-browser SSM — the WebGPU Mamba runtime the app already
 * ships for the agent-publish stack — was never reachable from the Brain, so a repeat
 * question always cost a round trip even when the answer was already sitting in the
 * tab that asked it. That is the "on-device inference isn't in the shared Brain" gap.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT. It is a SEMANTIC ANSWER CACHE keyed by an
 * on-device embedding: a question close enough to one this browser already answered
 * replays that answer, locally. It is NOT a second Evermind and it does not generate:
 * the in-browser SSM is an embedder here, not a chat model, and a tier that invented
 * answers from small local weights would be strictly worse than the model it pre-empts.
 * So a hit is reported as `qa-cache` — the honest provenance, the same one the server's
 * exact-repeat cache reports — and the timeline says a cached answer served, never that
 * a local model wrote one.
 *
 * WHY IT IS SAFE TO PUT IN FRONT. The threshold is the whole argument. The server's
 * Q&A cache replays on an EXACT repeat; a semantic cache at its usual 0.92 would replay
 * on a paraphrase, and "which tickets are in the backlog?" asked twice about different
 * boards is a paraphrase. {@link ON_DEVICE_ANSWER_THRESHOLD} is therefore set at
 * near-identity, making this a restatement cache rather than a similarity cache.
 *
 * Pure and transport-agnostic, like the rest of this package: the STORE is injected, so
 * this module is safe in every bundle including ones with no GPU story at all. The
 * binding that turns the port into a real SSM runtime lives next door, in
 * `onDeviceStore.ts` — that is the one host-facing loader, and it is what keeps two
 * projects from sharing an answer.
 */

/**
 * The on-device answer store, as a port. Structurally satisfied by the
 * `SemanticCache` in `@seanhogg/builderforce-memory`, which `onDeviceStore.ts` builds
 * and the hosts inject — declared here as a shape so the hooks take no dependency on
 * the runtime.
 */
interface OnDeviceAnswerStore {
    /** Best stored answer for a semantically-similar prior question, or undefined. */
    lookup(query: string): Promise<{
        response: string;
        score: number;
    } | undefined>;
    /** Remember a (question → answer) pair. */
    store(query: string, response: string): Promise<void>;
}
/**
 * Cosine similarity at/above which a stored local answer is replayed.
 *
 * Deliberately far above the 0.92 the response cache uses for cloud completions. That
 * cache is protecting a bill; this one is answering a person, and the cost of being
 * wrong is not a wasted call but a confidently stale answer to a question nobody
 * re-asked. At this threshold a hit means "you asked this again", not "you asked
 * something like this".
 */
declare const ON_DEVICE_ANSWER_THRESHOLD = 0.985;
/**
 * Build the on-device half of the Brain's memory hooks from a lazily-loaded store.
 *
 * `load` is called at most once per turn and may return null forever (no WebGPU, no
 * SSM assets, a runtime that cannot spawn a worker) — every hook then answers "I have
 * nothing", which is exactly what makes this safe to place in front of the server tier.
 * Nothing here throws: a memory tier that can fail a turn is worse than no memory tier.
 */
declare function onDeviceMemoryHooks(load: () => Promise<OnDeviceAnswerStore | null>): Pick<EvermindRunHooks, 'answer' | 'cacheAnswer'>;
/**
 * Layer memory hooks into one set, nearest-first.
 *
 * The layers are tiers, and the order IS the policy: ask the cheapest, most local
 * source first and fall through. `recall` comes from the first layer that has one
 * (grounding is the project corpus's job — a local answer cache has no corpus to
 * ground with). `answer` walks the layers until one answers. `cacheAnswer` writes to
 * ALL of them, because a turn the server remembers should also be the turn this
 * browser can replay offline, and vice versa.
 *
 * Returns undefined when no layer supplies anything, so a host can pass the result
 * straight through to the run loop's optional `evermind` prop.
 */
declare function composeEvermindHooks(...layers: (Partial<EvermindRunHooks> | null | undefined)[]): EvermindRunHooks | undefined;

/**
 * The HOST-FACING loader for the on-device answer store — the piece that binds
 * {@link OnDeviceAnswerStore} to a real SSM runtime.
 *
 * WHY THIS MOVED HERE. The store builder was `frontend/src/lib/semantic-cache.ts`, which
 * meant only the web app could reach it: Rovr (Chrome, WebGPU) was locked out of a tier
 * it could run, and the only sane next step — a Node WebGPU store for the editor — was
 * impossible while the builder sat behind the frontend's `@/` alias. Nothing in it is
 * host-specific: `SSM` + `SemanticCache` are the same classes everywhere.
 *
 * TWO THINGS THIS GETS RIGHT THAT THE SINGLE GLOBAL CACHE DID NOT.
 *
 * 1. **The store is partitioned by scope.** The store used to be memoised under one
 *    global key, so a near-identical question asked in project B could replay an answer
 *    cached from project A — and "which tickets are in the backlog?" is the case where
 *    that hurts most, because it matches itself across every board. Each scope now gets
 *    its OWN `SemanticCache` instance, so partitioning is by construction rather than by
 *    a key somebody has to remember to pass.
 *
 * 2. **The EXPENSIVE half is shared, the CHEAP half is partitioned.** The SSM runtime
 *    (model assets, a worker) is memoised ONCE per tab and its `embed` is handed to every
 *    per-scope cache. Partitioning costs one empty array per scope, not one model load
 *    per scope — the naive "key the whole builder by project" fix would have loaded the
 *    embedder once per project the person ever opened.
 *
 * Gracefully optional, same contract as before: no WebGPU, no SSM assets, or a runtime
 * that cannot spawn a worker ⇒ `null` forever, and the loop falls through to the server
 * tier. Nothing here throws.
 */

/**
 * The scope a store is partitioned by. A project id is the normal case; a host that has
 * no project (a signed-out surface) passes its own stable token so its answers still
 * never land in a project's partition.
 */
type OnDeviceStoreScope = string | number;
/**
 * The on-device answer store for ONE scope, memoised per scope for the life of the tab.
 *
 * Returns null — never throws — when the device cannot run the embedder, so a caller can
 * hand the result straight to `onDeviceMemoryHooks`. Two scopes never share entries: each
 * gets its own `SemanticCache`, whose entries live in an in-process array and die with
 * the tab. There is deliberately no L2 here — a shared backend would put a server back
 * into a tier whose whole point is answering without one, and would duplicate the
 * server-side Q&A cache the Brain already consults on the next tier down.
 */
declare function loadOnDeviceAnswerStore(scope: OnDeviceStoreScope): Promise<OnDeviceAnswerStore | null>;
/** Drop every memoised store and the shared embedder — tests only. */
declare function resetOnDeviceStoresForTests(): void;

/** A capability a consumer exposes to the Brain (the MCP extension unit). */
interface BrainAction<A = unknown, R = unknown> {
    /** Globally-unique, flat snake_case (no dots) so it round-trips through the gateway. */
    name: string;
    description: string;
    /** JSON Schema for the action arguments (becomes the tool's `function.parameters`). */
    parameters: Record<string, unknown>;
    /**
     * Whether running this action changes state — drives the host's
     * confirm-before-mutate gate (see `useBrainConversation`'s `confirmTool`).
     * Use a predicate when mutation depends on the args (e.g. a dispatcher tool
     * that proxies both reads and writes). Defaults to read-only (no gate).
     */
    mutates?: boolean | ((args: A) => boolean);
    run(args: A): Promise<R> | R;
}
interface BrainActionsContextValue {
    /** Tool specs for every currently-registered action (for the model). */
    toolSpecs: BrainToolSpec[];
    /** Execute a registered action by name. Returns a recoverable error object for unknown tools. */
    runTool(name: string, args: unknown): Promise<unknown>;
    /** Whether the named action would mutate state for these args (false if unknown). */
    isMutating(name: string, args: unknown): boolean;
    /** Register a batch of actions; returns an unregister function. (Used by the hook.) */
    register(actions: BrainAction[]): () => void;
}
declare function BrainActionsProvider({ children }: {
    children: React.ReactNode;
}): react.JSX.Element;
/** Consume the registry (used by the Brain panel/conversation hook). */
declare function useBrainActions(): BrainActionsContextValue;
/**
 * Register page actions for as long as the calling component is mounted.
 *
 * The array does NOT have to be referentially stable. It used to — the contract
 * was a comment asking callers to `useMemo`, and one caller that did not (a
 * `useComponentLabel()` that returned a fresh function every render, feeding
 * `WidgetBrainBridge`'s memo) froze every navigation on the site. A contract a
 * caller can silently break, whose breach takes down the whole app, belongs in
 * the primitive instead: registration is keyed on the action NAMES, and the
 * handlers are read through a ref, so re-running with an equivalent array is
 * free and the registry never churns.
 *
 * If no provider is present (e.g. a route without the Brain) this is a no-op, so
 * pages can call it unconditionally.
 */
declare function useRegisterBrainActions(actions: BrainAction[]): void;

/**
 * The gateway MCP catalog — fetching it, and turning it into callable actions.
 *
 * A tenant registers MCP servers in the portal; the gateway advertises their tools at
 * `GET /llm/v1/mcp/tools` and relays calls at `POST /llm/v1/mcp/call` (server-to-server,
 * so the MCP secret never reaches the client). This is the whole of that logic, with NO
 * React in it.
 *
 * It lives apart from {@link useMcpExtensions} — which is now a thin hook over it —
 * because the catalog is the single largest determinant of whether the Brain can answer
 * anything at all, and it therefore has to be reachable from places React is not: the
 * headless VS Code probe that reproduces a chat run from a terminal, and the offline
 * scenario harness that asserts on what a run was offered. Two copies of "how do we
 * build the tool list" would be two copies of the thing most worth testing.
 */

/** One tool as the gateway advertises it. */
interface McpToolEntry {
    extensionId: string;
    tool: string;
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    /** Whether the tool writes. Drives the confirm-before-mutate gate. Undefined
     *  (external MCP servers don't advertise it) ⇒ treated as mutating (fail safe). */
    mutates?: boolean;
}
/** What a tool call resolved to — handed to the caller's `onToolResult`. */
interface McpToolResultInfo {
    /** Flat advertised name the model called (e.g. `builtin_tasks_create`). */
    name: string;
    /** Owning server's tool name + extension id (the relay coordinates). */
    tool: string;
    extensionId: string;
    /** Whether the tool writes (advertised mutates, fail-safe true). */
    mutating: boolean;
    /** True when the relay call succeeded (no transport error / `{error}` result). */
    ok: boolean;
}
/**
 * Fetch the tenant's advertised MCP tools.
 *
 * THROWS on any failure rather than resolving to an empty list. That is deliberate: a
 * silent empty catalog leaves the Brain with zero data tools, so every answer degrades
 * to "I don't have that data" — indistinguishable, from the outside, from a weak model.
 * Callers record the reason (the hook publishes it to `mcpToolStatus`; the probe prints
 * it) so a zero is always explained.
 *
 * @param skipExtensionIds extensions the host already registers natively, so the Brain
 * doesn't get the same capability twice.
 */
declare function fetchMcpToolEntries(transport: Pick<BrainTransport, 'baseUrl' | 'getToken'>, skipExtensionIds?: readonly string[]): Promise<McpToolEntry[]>;
/**
 * Turn advertised catalog entries into {@link BrainAction}s whose `run()` posts the call
 * through the gateway relay. Pure over its inputs (module-level create-dedupe aside), so
 * the React hook, the headless probe and the offline harness all produce byte-identical
 * tool behaviour.
 */
declare function mcpActionsFrom(entries: readonly McpToolEntry[], transport: Pick<BrainTransport, 'baseUrl' | 'getToken'>, onToolResult?: (info: McpToolResultInfo) => void): BrainAction[];

interface UseMcpExtensionsOptions {
    /**
     * Extension ids to drop from the fetched tool list. A host that already
     * registers some of the gateway's tools natively (e.g. first-party platform
     * actions exposed under a `builtin` extension) passes those ids here so the
     * Brain doesn't get the same capability twice.
     */
    skipExtensionIds?: string[];
    /**
     * Called after every relay tool call resolves. Lets the host react to writes —
     * e.g. dispatch a "brain data changed" event so the page rendering that domain
     * refetches live instead of going stale. Replaces the per-cap announce wrapper
     * the app used to apply in its native manifest, so catalog tools refresh the UI
     * the same way. Kept generic (no app types) so the package stays portable.
     */
    onToolResult?: (info: McpToolResultInfo) => void;
    /**
     * Where the PLATFORM lives, when that is not where completions go.
     *
     * `config.transport` answers two different questions that used to have one answer:
     * which endpoint streams the model, and which endpoint serves the tool catalogue. A
     * host that runs the model on the user's own machine splits them — the completion goes
     * to a local runtime, while projects, tasks and OKRs still live on the gateway. Left
     * conflated, pinning an on-device model pointed the catalogue fetch at the local
     * runtime, which serves no such route: the Brain silently lost every platform tool and
     * answered "I don't have that data" with an empty trace.
     *
     * Omit it and the model transport is used, which is correct for every host that has
     * only one endpoint.
     */
    transport?: BrainTransport;
}
declare function useMcpExtensions(options?: UseMcpExtensionsOptions): {
    loading: boolean;
    toolCount: number;
    error: string | null;
};

/**
 * The one conversion from a registered {@link BrainAction} to the OpenAI `tools[]` entry
 * the model is shown.
 *
 * It lived inline in the React actions registry, which was fine while the registry was
 * the only thing that ever needed it. It no longer is: a headless runner (the VS Code
 * probe, the offline scenario harness) assembles the same action list and must advertise
 * it identically — a second copy of this mapping would be a second definition of what
 * the model can see, which is the single fact those runners exist to reproduce.
 *
 * Type-only import of `BrainAction`, so nothing here pulls React into a Node process.
 */

/** Advertise these actions to the model. Order is preserved. */
declare function toolSpecsFor(actions: readonly BrainAction[]): BrainToolSpec[];

/**
 * Streaming parser for tool calls a model writes inline in its *text* output.
 *
 * Some models (and weaker gateway-routed ones) don't emit native OpenAI
 * `tool_calls` deltas — they write the call into the content stream as markup.
 * There is no single convention, so this handles every dialect seen in the wild:
 *
 *   <tool_call>delete_task<arg_key>id</arg_key><arg_value>75</arg_value></tool_call>
 *   <function_call>{"name":"delete_task","arguments":{"id":75}}</function_call>
 *   <tool_use>delete_task {"id":75}</tool_use>
 *   <invoke name="delete_task"><parameter name="id">75</parameter></invoke>
 *   <function=delete_task>{"id":75}</function>
 *   <xai:function_call name="delete_task"><parameter name="id">75</parameter></xai:function_call>
 *   <|"0":{"name":"delete_task","arguments":{"id":75}}, "1":{…} ?>
 *
 * Left untouched that markup (a) renders as literal tags in the chat bubble — the
 * "garbled reply" symptom — and (b), worse, means the call NEVER executes, because
 * the agent loop only runs structured `toolCalls`. This filter lifts every dialect
 * into the same `AssembledToolCall` shape the native path produces AND strips the
 * markup from the visible text so only clean narration reaches the UI.
 *
 * It is a streaming filter: deltas arrive in arbitrary chunks (a tag can split
 * across two reads), so it holds back any text that is — or might be the start of —
 * an opening tag, emitting only text that is safe to display.
 *
 * Deliberately NOT handled: a bare ```json fenced block. A fenced block is far more
 * often legitimate content (the model showing the user a payload) than a call, and
 * swallowing those would eat real answers.
 */
/** A tool call lifted out of text, in the native `AssembledToolCall` shape. */
interface ParsedXmlToolCall {
    id: string;
    name: string;
    /** Raw JSON argument string (parse with `JSON.parse`). */
    args: string;
    /** For a tag-style body: each argument's TEXT as written (before `args` read it as a
     *  number / JSON), so `typeXmlToolArgs` can type it against the tool's schema. */
    rawArgs?: Record<string, string>;
}
/**
 * Stateful streaming filter. Feed `push(delta)`; it returns the clean text safe
 * to display now (markup withheld). Call `flush()` once at end-of-stream.
 */
declare class XmlToolCallFilter {
    private buf;
    private inside;
    private insideName;
    private innerBuf;
    private clean;
    private calls;
    private seq;
    /** Close the call currently being accumulated and record it. A dialect whose name
     *  is optional in the open tag falls back to reading the name from the body. */
    private commit;
    /** Feed a content delta; returns clean (markup-free) text to emit now. */
    push(delta: string): string;
    /** End of stream: flush held-back text and close any unterminated call. */
    flush(): string;
    /** The full clean text accumulated so far. */
    cleanText(): string;
    /** Tool calls lifted out of the text. */
    toolCalls(): ParsedXmlToolCall[];
}
/** One-shot convenience for non-streamed content (the no-reader fallback). */
declare function extractXmlToolCalls(raw: string): {
    text: string;
    toolCalls: ParsedXmlToolCall[];
};

interface BrainPageContext {
    /**
     * Active project, when the current page PINS the Brain to one project (the
     * IDE). Pinning also switches the docked Brain to that project's modality
     * coding persona and scopes its chats — so non-IDE pages that merely want the
     * Brain to be *aware* of the project they're viewing should set
     * `viewingProjectId` instead (it keeps the platform co-pilot persona).
     */
    projectId: number | null;
    /**
     * The project the user is currently looking at (e.g. the Tasks board scoped to
     * `?project=14`). Unlike `projectId`, this does NOT change the persona or pin
     * chats — it only tells the Brain to use this project as the default for
     * project-scoped actions when the user doesn't name one.
     */
    viewingProjectId: number | null;
    /** Active modality — drives the Brain's system prompt/persona. */
    modality: BrainModality;
    /** Extra system-prompt context appended for this page (e.g. the open file + content). */
    extraSystem?: string;
    /** Deep-link: open the drawer on this chat. */
    initialChatId?: number | null;
    /** Deep-link: one-shot prompt auto-sent when the drawer opens (e.g. the IDE
     *  `?prompt=` seed). Distinct from a pending-prompt handoff — this is published
     *  by a page effect, not read from storage. */
    initialPrompt?: string;
    /** Deep-link: one-shot work item to auto-link the opened chat to (the IDE
     *  `?ticket=<kind>:<ref>` seed). The docked Brain gets this as a direct prop; the
     *  floating drawer reads it here. */
    initialTicket?: {
        kind: string;
        ref: string;
    };
}
interface BrainContextValue extends BrainPageContext {
    open: boolean;
    setOpen(open: boolean): void;
    /** Merge partial page context (call from a page effect). */
    setContext(patch: Partial<BrainPageContext>): void;
    /**
     * The chat currently selected in the docked Brain. Lifted here so co-mounted
     * Brain instances (e.g. the IDE Designer left-panel and the floating drawer)
     * stay on the same conversation. Distinct from `initialChatId` (a one-shot
     * deep-link); this tracks the live selection.
     */
    activeChatId: number | null;
    setActiveChatId(id: number | null): void;
}
declare function BrainContextProvider({ children }: {
    children: React.ReactNode;
}): react.JSX.Element;
/** Read/update the ambient Brain context. Throws if no provider is mounted. */
declare function useBrainContext(): BrainContextValue;
/**
 * Safe variant for pages that may render with or without the Brain mounted.
 * Returns null instead of throwing when no provider is present.
 */
declare function useOptionalBrainContext(): BrainContextValue | null;

/** The placeholder title `create()` stamps on an untitled chat. A chat still carrying
 *  it has never been named, so {@link deriveChatTitle}-based auto-titling may replace it
 *  (a user/seed-provided title never matches this and is left alone). */
declare const DEFAULT_CHAT_TITLE = "New chat";
/**
 * Derive a short, human chat title from the first user message — "what the chat is
 * about" — so a conversation stops showing as "New chat" the moment it starts. Pure and
 * LLM-free (no cost, instant, deterministic): first non-empty line, whitespace
 * collapsed, trimmed to ~60 chars on a word boundary. Returns '' when there's nothing
 * usable (so the caller leaves the placeholder in place).
 */
declare function deriveChatTitle(text: string): string;
interface UseBrainChatsOptions {
    /** Dropdown filter — id string, 'none', or null (all). Ignored when `pinnedProjectId` is set. */
    filterProjectId?: string | null;
    /** Project pages: lock the list (and new chats) to this project; no filter UI. */
    pinnedProjectId?: number | null;
    /**
     * Controlled active chat. When provided (not `undefined`), the active chat id
     * is owned by the caller instead of internal state — so two co-mounted Brain
     * instances (e.g. the IDE Designer left-panel and the floating drawer) can
     * share one selection via a common store. Pair with `onActiveChatChange`.
     */
    activeChatId?: number | null;
    /** Controlled-mode setter, called whenever the hook would change the selection. */
    onActiveChatChange?: (id: number | null) => void;
    /**
     * Titles that also count as "untitled" for `autoTitle` — a host that seeded its chats
     * with a LOCALIZED "New chat" (the VS Code panel did) still gets them auto-named.
     */
    placeholderTitles?: readonly string[];
}
interface UseBrainChats {
    chats: BrainChat[];
    loading: boolean;
    error: string;
    activeChatId: number | null;
    activeChat: BrainChat | null;
    setError(msg: string): void;
    select(id: number | null): Promise<BrainChat | null>;
    /** Create a chat (defaults project to the active filter/pin) and select it. */
    create(opts?: {
        title?: string;
        projectId?: number | null;
        capability?: string | null;
        mode?: ChatMode;
    }): Promise<BrainChat | null>;
    rename(id: number, title: string): Promise<void>;
    /** Set (or clear, with null) what the chat is making. Persisted on the chat, so
     *  the choice follows the conversation across surfaces instead of the browser. */
    setCapability(id: number, capability: string | null): Promise<void>;
    /** Switch the conversation between CHAT (answer) and WORK (execute + dispatch).
     *  Persisted on the chat for the same reason `capability` is — the choice belongs
     *  to the conversation, not to the browser it was flipped in. */
    setMode(id: number, mode: ChatMode): Promise<void>;
    /** Flip the chat's Memory switch (`memoryEnabled`) — optimistic, reverted on failure. */
    setMemoryEnabled(id: number, on: boolean): Promise<void>;
    /**
     * Auto-name a still-untitled chat (title === {@link DEFAULT_CHAT_TITLE}) from its
     * first user message, so "New chat" becomes the topic once the conversation begins.
     * No-op when the chat was already given a real title (user rename / task seed), so it
     * never clobbers an intentional name. Wired to the conversation's first-turn hook.
     */
    autoTitle(id: number, firstUserText: string): Promise<void>;
    /**
     * Persist the user's first prompt on the chat (migration 1245) so the linked ticket can
     * show the origin request, not just the title derived from it. Write-once per chat and
     * best-effort: it never rejects (a failed capture retries on the next first turn) and a
     * chat that already carries a request is left untouched. Pass this straight to
     * `useChatCreation`'s `onCaptureOriginalRequest` port — the hook guarantees once-per-chat
     * firing and this one guarantees the write, so neither has to know about the other.
     */
    captureOriginalRequest(id: number, text: string): Promise<void>;
    summarize(id: number): Promise<void>;
    /**
     * Archive a chat — put it away rather than remove it.
     *
     * Calls `persistence.archiveChat`, never {@link remove}'s `deleteChat`. The
     * server's archive happens to be `DELETE /api/brain/chats/:id` (it sets
     * `isArchived`), but reaching it through `deleteChat` is what made Archive a
     * delete. A persistence that has not grown `archiveChat` fails closed — it
     * does not fall back to `deleteChat`, which on the local-first adapter
     * tombstones the row.
     */
    archive(id: number): Promise<void>;
    remove(id: number): Promise<void>;
    assignToProject(id: number, projectId: number | null): Promise<void>;
    reload(): Promise<void>;
    /** Bump a chat to the top + refresh ordering after new activity. */
    touch(id: number): Promise<void>;
}
declare function useBrainChats(options?: UseBrainChatsOptions): UseBrainChats;

/**
 * The choices a person makes BEFORE a conversation exists — its Chat|Work mode and its
 * Memory switch — and the ONE creation path that carries them. Moved from the web
 * Brain panel (`useBrainChatStart`) and the editor's chat list (`useVsCodeChats`),
 * which each kept a copy.
 *
 * Every creation path has to carry the armed mode: a person who picks Work in the
 * empty state and then types must get a WORK conversation, not a chat one that
 * silently declines to do the thing they asked for. The choices live in refs as well
 * as state so `createArmed` reads the current value without being re-created — it is
 * a dependency of the `ensureChatId` captured into every run.
 *
 * Once a chat exists, mode and memory are properties of the CONVERSATION (they follow
 * it to every surface), so `selectMode` writes through to it.
 */
interface ArmedNewChat {
    /** The open chat's mode, or the armed one before a chat exists. */
    chatMode: ChatMode;
    selectMode: (mode: ChatMode) => Promise<void>;
    /** Arm the Memory switch for the chat the first send creates. */
    armMemory: (on: boolean) => void;
    /** Create (and select) a chat carrying the armed mode and memory. */
    createArmed: (opts?: Parameters<UseBrainChats['create']>[0]) => ReturnType<UseBrainChats['create']>;
}
declare function useArmedNewChat(chats: Pick<UseBrainChats, 'activeChatId' | 'activeChat' | 'create' | 'setMode' | 'setMemoryEnabled'>): ArmedNewChat;

/**
 * How full the model's context was on the conversation's LAST turn — what the composer's
 * context meter shows.
 *
 * Read from the `llm.complete` step, which is durable (persisted as a step row), so the
 * figure survives a reload: the live trace is searched first, then the persisted step
 * rows. `usage.prompt` is what the gateway reported the turn actually sent; `contextWindow`
 * is the window of the model that served it, stamped by the run when the host knows it
 * (`RunWindowFit.contextWindow`). Unknown window ⇒ the meter shows the count alone.
 *
 * The run keeps the prompt inside the window on its own — `buildWorkingTranscript`
 * folds the older middle into a memory note past `HISTORY_TOKEN_BUDGET` and records a
 * `context.compacted` step — so this is a READOUT, never a gate.
 */

interface ContextUsage {
    /** Prompt tokens the last turn sent. */
    promptTokens: number;
    /** The serving model's context window, when known. */
    contextWindow?: number;
    /** The model that served the turn. */
    model?: string;
}
/** The last turn's context usage, or null when no turn has reported token usage. */
declare function contextUsageOf(messages: readonly BrainMessage[], trace: readonly BrainTraceEvent[]): ContextUsage | null;

/**
 * Directed messages — addressing a chat turn to a participant, not the BRAIN.
 *
 * A BuilderForce chat is multi-party: alongside the BRAIN (the agent that
 * executes build/change requests) a chat can have other participants — invited
 * teammate agents and humans. Not every message is a directive for the BRAIN to
 * run: a user can @-tag a participant and simply talk to them. Such a turn is a
 * normal `user` message tagged with `{ addressedTo: {...} }` in its metadata; the
 * conversation loop reads that flag and does NOT start a BRAIN run for it, while
 * the transcript still shows who it was addressed to. An untagged message (or one
 * addressed to the BRAIN) runs the agent loop as before.
 *
 * `addressedTo` has two shapes. ONE participant is stored as the participant
 * itself (`{kind:'agent'|'human', ref, name}`). SEVERAL — a canvas group turn that
 * asks every agent on the board at once — are stored as
 * `{kind:'group', members:[…participants]}`. Readers go through
 * {@link parseDirectedRecipients}, which answers a list for both, so no surface
 * has to know which shape a row carries.
 *
 * This is the single source of truth for the convention, shared by the send path
 * (which skips the run), the auto-reply guard, and any surface that renders the
 * "→ recipients" badge.
 */
/** A non-BRAIN participant a message can be addressed to. */
interface DirectedRecipient {
    /** 'agent' = an invited teammate agent; 'human' = an invited person. */
    kind: 'agent' | 'human';
    /** Stable id/ref of the participant (an agentRef, or a user id/handle). */
    ref: string;
    /** Display name shown in the composer chip + the transcript badge. */
    name: string;
}
/** A turn addressed to several participants at once (a canvas group turn). */
interface DirectedGroup {
    kind: 'group';
    members: DirectedRecipient[];
}
/** The metadata key that flags a user message as addressed to a participant. */
declare const ADDRESSED_TO_META_KEY = "addressedTo";
/** The metadata key that attributes an assistant turn to a specific participant
 *  (an invited agent that replied), rather than the default BRAIN. Mirrors
 *  {@link ADDRESSED_TO_META_KEY} on the answering side. */
declare const AUTHORED_BY_META_KEY = "authoredBy";
/** The participant that authored an assistant turn, or `null` for the BRAIN. */
declare function parseMessageAuthor(msg: {
    metadata?: string | null;
}): DirectedRecipient | null;
/**
 * Merge an `addressedTo` flag into a message's metadata object (preserving any
 * other keys, e.g. `attachments`). One recipient is stored as itself; two or more
 * as a {@link DirectedGroup}. Returns a serialized string, or `undefined` when
 * there is nothing to store — ready to hand to `persistence.sendMessages`.
 */
declare function withDirectedMetadata(recipient: DirectedRecipient | readonly DirectedRecipient[] | null | undefined, base?: Record<string, unknown>): string | undefined;
/**
 * Everyone a persisted message was addressed to — empty for a BRAIN turn, one
 * entry for a directed turn, several for a group turn.
 *
 * Group rows written before members carried names stored bare agent refs
 * (`{kind:'group', refs}`); those still read as addressed, named by their ref, so
 * the transcript says SOMETHING true about them and the BRAIN still stays idle.
 */
declare function parseDirectedRecipients(msg: {
    metadata?: string | null;
}): DirectedRecipient[];
/**
 * True when a message is addressed to one or more participants — a directed OR a
 * group turn — so the BRAIN must NOT run for it: whoever it was put to owns the
 * reply.
 */
declare function isDirectedToParticipant(msg: {
    metadata?: string | null;
}): boolean;
/**
 * The invited agents a directed turn should dispatch to. Humans are omitted —
 * they are notified out-of-band, not run. A missing `kind` still dispatches
 * (composer/roster bugs used to drop `kind` and then silently skip the reply).
 */
declare function directedAgentRecipients(recipient: DirectedRecipient | DirectedGroup | readonly DirectedRecipient[] | null | undefined): DirectedRecipient[];
/**
 * A composer's recipient choice: `null` = auto (follow any leading @mention),
 * `'brain'` = explicitly the BRAIN, or an explicit participant. An explicit
 * choice always wins over a typed @mention.
 */
type RecipientChoice = DirectedRecipient | 'brain' | null;
/** An in-progress "@mention" being typed at the caret — what a composer typeahead
 *  offers a picker for. */
interface MentionToken {
    /** The text typed after '@' (before the caret); '' right after typing '@'. */
    query: string;
    /** Index of the '@' character in the text. */
    start: number;
    /** Index just past the query (the caret position). */
    end: number;
}
/**
 * Detect an in-progress "@mention" at the caret, for a composer typeahead. The
 * token is an '@' at the start of the text or right after whitespace, followed by
 * a run of non-whitespace, non-'@' characters, with the caret inside that run.
 * Returns null when the caret is not in such a token (so no picker should show).
 * Deliberately mirrors {@link mentionRecipient}'s `@([^\s@]+)` grammar so what the
 * typeahead offers and what a leading mention resolves to stay consistent.
 */
declare function activeMentionToken(text: string, caret: number): MentionToken | null;
/**
 * Filter + rank participants for a mention query — case-insensitive substring
 * match, name-start matches first. An empty query returns every participant (so
 * typing a bare '@' opens the full roster). Shared by every composer's typeahead.
 */
declare function filterMentionCandidates(participants: DirectedRecipient[], query: string): DirectedRecipient[];
/** Resolve a leading "@name" in composer text to one of `participants`, if any. */
declare function mentionRecipient(text: string, participants: DirectedRecipient[]): DirectedRecipient | null;
/**
 * The effective target of the next message: an explicit BRAIN pick wins (→ null,
 * runs the BRAIN); else an explicit participant; else a leading @mention; else the
 * BRAIN. Shared by every composer so routing is identical across surfaces.
 */
declare function resolveRecipient(choice: RecipientChoice, mention: DirectedRecipient | null): DirectedRecipient | null;
/** A ticket that can be #tagged in chat. */
interface ChatTicket {
    /** Unique ticket id (numeric). */
    id: number;
    /** Display title/subject. */
    title: string;
    /** Optional status for display (e.g. "in_progress"). */
    status?: string;
    /** Optional key (e.g. "1-ABC-123"). */
    key?: string;
    /** Reference string (e.g. "#123" or the key). */
    ref?: string;
}
/** Token returned when the caret is inside a #ticket query. */
interface TicketToken {
    /** The text after '#' that the user is typing. */
    query: string;
    /** Start position of '#' in the text. */
    start: number;
    /** End position (caret) in the text. */
    end: number;
}
/** Alias for ChatTicket, used in ticket autocomplete. */
type TicketTag = ChatTicket;
/** Alias for activeTicketToken, used in ticket autocomplete. */
declare const activeHashtagToken: typeof activeTicketToken;
/**
 * Detect an in-progress "#ticket" tag at the caret, for a composer typeahead.
 * The token is a '#' at the start of the text or right after whitespace, followed
 * by a run of non-whitespace, non-'#' characters, with the caret inside that run.
 * Returns null when the caret is not in such a token.
 */
declare function activeTicketToken(text: string, caret: number): TicketToken | null;
/**
 * Filter + rank tickets for a tag query — case-insensitive substring match on
 * title or key. An empty query returns every ticket (so typing a bare '#'
 * opens the full list).
 */
declare function filterTicketCandidates(tickets: ChatTicket[], query: string): ChatTicket[];

/**
 * A draft chat's first send CREATES the chat, and what the person types while it does belongs to THAT creation - not to
 * whichever chat is showing when the id arrives.
 *
 * A DRAFT TOKEN is minted when a send starts from a draft (`begin`, synchronously - before any async preparation the host's
 * send does). Every turn held while the draft is unresolved carries the token, never a chat id. The creation started for the
 * token resolves it with its chat id, or fails it; only the creation that BELONGS to a token can settle it, so an abandoned,
 * older creation resolving late settles its own token and no other draft's. Switching the visible chat touches no token.
 *
 * A creation is ASKED FOR with the token its send began with (`ensureChatId(token)`) - never with whichever token is on screen
 * when it runs - so a late send of an abandoned draft creates, and settles, its own.
 *
 * Pure (no React): `useChatCreation` owns one binding and reports into it; `useChatTurns` / `useQueuedTurns` read it.
 */
/** Names one draft's send-and-creation. Opaque; only compare it. */
type DraftToken = number;
/** The id a token's creation resolved with, or null when it failed (nothing was created). */
type DraftOutcome = number | null;
interface DraftBinding {
    /**
     * A send starts from the draft: its token (the draft's current one, minted when it has none). Counts the send, so the
     * token is not failed while another send from the same draft is still getting ready; pair every call with `settle`.
     */
    begin: () => DraftToken;
    /** The draft on screen's token without counting a send - for a creation asked for with no token of its own (`ensureChatId()`); a send names its token. */
    adopt: () => DraftToken;
    /** The draft on screen's token (null: none yet, or the draft has been left). Stable between changes. */
    current: () => DraftToken | null;
    /** The creation for this token has started: it, and only it, will resolve or fail the token. */
    startCreation: (token: DraftToken) => void;
    resolve: (token: DraftToken, chatId: number) => void;
    fail: (token: DraftToken) => void;
    /**
     * A send that `begin` counted has ended. A token whose every send ended without a creation ever starting has nothing
     * coming: it fails (its held turns go back to the composer).
     */
    settle: (token: DraftToken) => void;
    /** A chat was opened: the draft is no longer on screen. Its tokens stay open - their creations may still answer. */
    leave: () => void;
    /**
     * What a token's creation answered: the chat id, null if it failed, undefined while open (or forgotten). A resolved token is
     * kept while the draft is on screen and while a send that began with it is still in flight - until then a send naming it
     * gets ITS chat.
     */
    outcomeOf: (token: DraftToken) => DraftOutcome | undefined;
    /** Called whenever `current()` changes (a `useSyncExternalStore` subscription). */
    subscribe: (listener: () => void) => () => void;
    /** Called once per token, when its creation answers. */
    onOutcome: (listener: (token: DraftToken, outcome: DraftOutcome) => void) => () => void;
}
declare function createDraftBinding(): DraftBinding;

/**
 * Which user turns START a run — the one rule the conversation's three run doors read: a
 * send, the auto-reply to a trailing turn on load, and Retry.
 *
 * A stop ("Stop the run", "stop", "cancel the task") with nothing running stops nothing.
 * Sent as a turn it STARTED a fresh run, which carried on working: the progress guard's
 * pause asks "Continue with guidance / Stop the run", the question ends the run, and the
 * "Stop the run" answer then arrived at an idle chat (VS Code chat #6). Such a turn is kept
 * as the person's answer and starts nothing. Mid-run, the same words are the Stop button
 * (the editor's `runSteer.ts`, through the same `stopIntent`).
 */

/** Does this user turn's text ask for work (true), or only for the work to stop (false)? */
declare function startsRun(text: string): boolean;

interface UseBrainConversationOptions {
    chatId: number | null;
    modality?: BrainModality;
    /**
     * The chat's project. Forwarded to the run so the loop's "a code change is always
     * tied to a ticket" backstop can mint a `from_delta` ticket for this project when
     * an IDE run changed code without recording one. Omit for a non-project chat / the
     * web Brain (no file tools → the backstop never fires).
     */
    projectId?: number | null;
    /** Extra system-prompt context (e.g. an IDE's open file + content). */
    extraSystem?: string;
    /** Override the system prompt entirely (e.g. a fixed Brain Storm persona). */
    systemPrompt?: string;
    /** Override the model (e.g. run the Brain as a specific assigned agent). */
    model?: string;
    /** True when `model` came from a deliberate user pick. */
    modelStrict?: boolean;
    /** Gateway-owned routing or the tenant's ordered BYO pool. */
    routingMode?: 'auto' | 'byo_pool';
    /**
     * Pick the next model when the current one burns its stall budget without emitting
     * a tool call. Hosts pass `(tried) => nextFallbackModel(surface, tried)` using the
     * `/llm/v1/models` surface they already cache. Omit to keep the run on one model
     * and stop with an explanation instead of switching.
     */
    pickFallbackModel?: (tried: readonly string[]) => string | undefined;
    /** Where the run's window fit learns a model's window — `BrainRunRequest.windowSources`. */
    windowSources?: RunWindowSources;
    /**
     * `max_tokens` for this conversation's completions — the host's Effort control
     * (see `effort.ts`, the single effort→params map). Omit for the 4096 default.
     */
    maxTokens?: number;
    /**
     * Vendor-neutral reasoning intent (the host's Thinking toggle). Build it with
     * `reasoningForRun({ effort, thinking })` so the level tracks Effort. Omit /
     * `undefined` ⇒ no `reasoning` field on the wire at all.
     */
    reasoning?: ReasoningIntent;
    /** Tool specs from the page-action registry. */
    toolSpecs?: BrainToolSpec[];
    /** Dispatch a tool call to the registry. `signal`: the call's Stop, when it is interruptible. */
    runTool?: (name: string, args: unknown, signal?: AbortSignal) => Promise<unknown>;
    /**
     * Pure predicate: return true to pause the loop for an explicit user
     * confirmation before the tool runs (the human-in-the-loop gate). The prompt
     * UI is driven by `pendingConfirm` + `resolveConfirm` on the return value, so
     * the gate survives a navigation that swaps which Brain panel is mounted.
     * Hosts typically gate only mutating tools (see BrainActions `isMutating`).
     * Omit to run every requested tool immediately.
     */
    needsConfirm?: (req: {
        name: string;
        args: unknown;
    }) => boolean;
    /**
     * Create-on-demand when sending without an active chat; returns the new chat id. `draft` is the token the send began with
     * (`send(text, { draft })`): the creation is THAT draft's, never whichever draft is on screen when this runs.
     */
    ensureChatId?: (draft?: DraftToken) => Promise<number | null>;
    /** Notify the host (chats hook) that this chat got new activity. */
    onActivity?: (chatId: number) => void;
    /**
     * Fired once when the FIRST user turn of a chat is persisted, with that turn's text —
     * the seam the host uses to auto-name a still-"New chat" conversation from what it's
     * about (wired to `useBrainChats.autoTitle`). Best-effort and idempotent on the host
     * side; omit to leave chats untitled.
     */
    onFirstUserTurn?: (chatId: number, text: string) => void;
    /**
     * Project-Evermind memory hooks, bound by the host to the active chat's project.
     * When set, a run recalls the project's learned memories before answering
     * (grounding the reply) and records recall/learn/reconcile steps in the trace.
     * Omit for a non-project chat.
     */
    evermind?: EvermindRunHooks;
    /**
     * Optional async per-turn system-prompt augment, called at run start with the
     * latest user text. Its non-empty return is appended to the system prompt for
     * that run. This is the seam a host uses for a PER-TURN async fetch the sync
     * `resolveSystemPrompt` / `extraSystem` cannot do — e.g. a fresh limbic/affect
     * block appraised against this turn's prompt (VS Code parity). Best-effort: a
     * throw / empty return just skips it. Omit when the static `extraSystem`
     * personality block is enough.
     */
    augmentSystemPrompt?: (userText: string) => Promise<string | undefined>;
    /**
     * The active chat's MODE — `chat` (answer the question) or `work` (create, staff,
     * link AND dispatch the work). Read from the chat row by the host so the choice
     * follows the conversation rather than the browser. Omit to keep the pre-mode
     * always-execute behaviour.
     */
    chatMode?: ChatMode;
    /**
     * The agents invited into the active chat. The host already holds this roster to
     * render the recipient picker and the @-mention typeahead; passing it through means
     * the RUN knows who is in the conversation too, instead of the model having to
     * discover it. A non-empty roster makes the invited agents the default owners of
     * work-mode work — see `chatMode.ts`. Omit when the host has not resolved it.
     */
    chatRoster?: readonly ChatRosterAgent[];
    /**
     * What a host can only know at RUN time, for the chat the run is in — resolved at each
     * run's start and merged OVER the request this hook builds from its render-time
     * options. The seam for a host whose tools are bound to the chat they act for (Rovr's
     * browser tools write that chat's action ledger and tasks — and a draft chat only gets
     * its id inside `send`), whose run options live on the chat's record, or whose system
     * prompt is built from live context (the working tab). A throw refuses the run with its
     * message; the user turn is already on record, so `retryLastTurn` can run it again.
     */
    prepareRun?: (chatId: number) => Promise<Partial<BrainRunRequest>>;
}
interface UseBrainConversation {
    messages: BrainMessage[];
    loadingMessages: boolean;
    /** Force a transcript refetch without changing the chat id (e.g. after a merge). */
    reloadMessages: () => void;
    sending: boolean;
    /** A run is executing or being made for this chat: what a typed message can STEER (`sending` also covers a send still saving). */
    runLive: boolean;
    error: string;
    /**
     * What the user can DO about {@link error}: reconnect an expired session, upgrade
     * a plan, or add a card. Decided ONCE from the gateway's structured error body
     * (see `chatErrorAction`), so an error banner renders the fix without
     * pattern-matching the message text. Null when only dismissing applies.
     */
    errorAction: ChatErrorAction | null;
    /** Live assistant delta buffer (rendered as a trailing bubble while streaming). */
    streamingText: string;
    /**
     * What the run is doing RIGHT NOW — the in-flight step (which tool, on what,
     * since when), published on ENTRY rather than on completion. Hand it straight
     * to the transcript's `activity` prop to get the animated progress row. Null
     * while idle. See `runActivity.ts`.
     */
    activity: BrainRunActivity | null;
    /** This viewer's thumb per message id (+1 up, -1 down). Hand straight to the
     *  shared transcript's `ratings` prop. */
    ratings: Record<number, 1 | -1>;
    pendingAttachments: ChatInputAttachment[];
    uploading: boolean;
    /**
     * Persist + answer a user turn. Resolves `true` once the turn is safely
     * persisted and the run has started (the message can no longer be lost), or
     * `false` if it failed before persisting (e.g. the token expired mid-send) —
     * so a composer can restore the text the user typed instead of dropping it.
     * `attachments` is the turn's OWN files (a held turn, a steer's leftovers): omitted, the turn
     * takes the composer's; given, exactly those leave the composer as the send starts and a
     * failure leaves them to the caller (`restoreAttachments`). `draft` is the token the turn door minted for a send from a
     * draft (`useChatTurns`' `send(turn, { draft })`): the chat this send creates belongs to it (`ensureChatId(draft)`).
     */
    send(text: string, opts?: {
        addressedTo?: DirectedRecipient | DirectedGroup | readonly DirectedRecipient[] | null;
        attachments?: ChatInputAttachment[];
        draft?: DraftToken;
    }): Promise<boolean>;
    /**
     * Answer the active chat's REFUSED turn again — the trailing user message nothing
     * replied to (only step rows after it), e.g. a turn a `no_local_model` verdict stopped.
     * The remedy's re-send ("Switch to Hybrid" → this): the message is already persisted,
     * so it is NOT written again — the run starts on it exactly as the auto-reply does.
     * Returns false (and does nothing) when a run is in flight or there is no such turn.
     */
    retryLastTurn(): boolean;
    /**
     * Stop the in-flight run for the active chat: aborts the streaming LLM request
     * and unwinds the agent loop (no error surfaced). No-op when nothing is
     * running. Pair with `sending` to drive a Stop button.
     */
    stop(): void;
    /**
     * Rate one assistant reply (+1 / -1, or 0 to clear). Beyond flipping the thumb it
     * derives WHAT is being rated — the model that served the turn and the MCP tool it
     * ran ({@link ratedTurnContext}) — and sends that with the vote, which is what
     * makes the press teach the learned router instead of just colouring a button.
     */
    rateMessage(msg: BrainMessage, rating: 1 | -1 | 0): Promise<void>;
    attach(file: File): Promise<void>;
    removeAttachment(key: string): void;
    /**
     * Put files back in the composer after a send that was not kept - merged by key, so calling it
     * twice (or for a file already there) never duplicates. The ONE restore: the web panel and the
     * editor's chat both use it for a turn they gave its own files.
     */
    restoreAttachments(files: readonly ChatInputAttachment[]): void;
    setError(msg: string): void;
    /**
     * Dismiss the current error banner. Clears BOTH the hook's local error and the
     * run cell's error (a failed LLM stream / tool loop sets the latter, which
     * `setError('')` alone can't reach) — so the user can always close the banner.
     */
    clearError(): void;
    /** A tool call awaiting the user's Approve/Cancel decision (or null). */
    pendingConfirm: {
        name: string;
        args: unknown;
    } | null;
    /** Resolve the pending confirmation. */
    resolveConfirm(ok: boolean): void;
    /**
     * True once the active chat has any recorded execution steps (LLM/tool/error)
     * — drives the "capture execution" affordance.
     */
    hasTrace: boolean;
    /**
     * The live execution trace (LLM turns + tool calls + errors) for the active
     * chat, in order — updated AS THE RUN HAPPENS. Render it as the timeline's
     * tool/thinking/error steps; pair it with `messages` for the durable
     * user/assistant turns. Empty when the chat has no run this session.
     */
    trace: BrainTraceEvent[];
    /** How full the model's context was on the last turn — the composer's context meter
     *  (`contextUsageOf` over the live trace, then the persisted steps). */
    contextUsage: ContextUsage | null;
    /**
     * Connected providers the gateway could NOT use this run (e.g. an expired Claude
     * subscription that fell back to the shared pool). A mounted view renders a passive
     * "reconnect your account" banner off this; empty when everything resolved.
     */
    byoUnresolved: string[];
    /**
     * BYO providers that hit a usage/capacity cap this run (e.g. Anthropic monthly
     * spend limit, Meta MUSE quota exhausted). A mounted view renders a "manage your
     * API keys" banner so the user can top up or switch providers. Empty when no cap
     * was hit this run.
     */
    providerCap: string[];
    /**
     * Assemble a paste-able triage report of the active chat's execution — the LLM
     * steps, the full tool chain (args + results), intermediate assistant messages,
     * every error, and the visible transcript. `agentLabel` names the persona the
     * Brain ran as; `surface` names where it ran (e.g. `VS Code (VSIX)`). Mirrors the
     * host/cloud "Copy triage info" report.
     */
    buildTriageReport(agentLabel?: string, surface?: string): string;
}

declare function useBrainConversation(options: UseBrainConversationOptions): UseBrainConversation;

/**
 * Shared reconnecting WebSocket invalidation client for Brain chat messages.
 * Both BuilderForce web and VSIX adapters use this implementation so auth,
 * reconnect, cleanup, and frame handling cannot drift between surfaces.
 */
declare function subscribeToChatMessages(baseUrl: string, getToken: () => string | null, chatId: number, onChanged: () => void): () => void;

/**
 * An authenticated JSON call, relative to the gateway origin.
 *
 * The init is narrowed to what this client actually sends — a method and a body —
 * rather than the whole of `RequestInit`. Demanding more than it uses would
 * reject a perfectly good host request function over a `headers` type it never
 * passes, which is exactly what the web app's `apiRequest` (whose `headers` is a
 * plain record) would have hit.
 */
type BrainRestInit = {
    method?: string;
    body?: BodyInit;
};
type BrainRestRequest = <T>(path: string, init?: BrainRestInit) => Promise<T>;
interface BrainRestOptions {
    /** Absolute gateway origin — used for the URL builders and the SSE subscription. */
    baseUrl: string;
    /** How this host makes an authenticated JSON call. */
    request: BrainRestRequest;
    /** Bearer token accessor, for the two calls that authenticate themselves. */
    getToken: () => string | null;
    /**
     * Multipart upload, when the host's `request` cannot carry a `FormData` body
     * with its boundary intact.
     *
     * The web app's `apiRequest` leaves `Content-Type` unset for `FormData`, so it
     * needs no override. The webview's `authedFetch` always sets
     * `application/json`, which would strip the multipart boundary and make every
     * upload fail — so it passes its own. This is the difference that made a
     * shared implementation look impossible; naming it makes it one line.
     */
    uploadFile?: (file: File) => Promise<{
        key: string;
        name: string;
        type: string;
    }>;
}
declare function createBrainRestPersistence(opts: BrainRestOptions): {
    listChats: (params?: {
        projectId?: string;
        limit?: number;
        offset?: number;
    }) => Promise<BrainChat[]>;
    getChat: (id: number) => Promise<BrainChat>;
    createChat: (body: {
        title?: string;
        originalRequest?: string | null;
        projectId?: number | null;
        capability?: string | null;
        mode?: string | null;
    }) => Promise<BrainChat>;
    updateChat: (id: number, body: {
        title?: string;
        originalRequest?: string | null;
        projectId?: number | null;
        visibility?: "shared" | "locked";
        capability?: string | null;
        mode?: string | null;
        memoryEnabled?: boolean;
    }) => Promise<BrainChat>;
    /** Archives rather than destroys — `archived` is what the server reports. */
    deleteChat: (id: number) => Promise<{
        archived: boolean;
    }>;
    /**
     * Archive a chat. The server's archive IS `DELETE /api/brain/chats/:id`
     * (sets `isArchived` and retains the summary) — there is no second route.
     * Named apart from `deleteChat` so Archive is not a call to the destroy
     * method. `deleteChat` is unchanged.
     */
    archiveChat: (id: number) => Promise<{
        archived: boolean;
    }>;
    /** Summarize a chat and store the summary on it. */
    summarizeChat: (id: number) => Promise<{
        summary: string;
    } | {
        error: string;
    }>;
    getMessages: (chatId: number, limit?: number) => Promise<BrainMessage[]>;
    subscribeMessages: (chatId: number, onChanged: () => void) => () => void;
    /**
     * Advance this viewer's unread high-water mark (omit `seq` for "all read").
     *
     * Reading a chat in VS Code clears its badge on the web too — it is the same
     * server conversation. Best-effort: the run loop never blocks on it.
     */
    markChatRead: (chatId: number, seq?: number) => Promise<{
        lastReadSeq: number;
    }>;
    /**
     * Post turns, and attach the server's TRUTHFUL learn-gate outcome to the
     * assistant turn(s) this POST persisted.
     *
     * The outcome is transient — it is never persisted — so a host that drops it
     * renders a run that is silent about learning, which is exactly how
     * "Connected, yet nothing learned" became an unexplained mystery in the VSIX.
     * Folding it HERE is what stops one host from forgetting again.
     */
    sendMessages: (chatId: number, messages: Array<{
        role: string;
        content: string;
        metadata?: string;
        eventKey?: string;
    }>) => Promise<BrainMessage[]>;
    /**
     * Set thumbs up/down on a message (null clears).
     *
     * `context.toolName` is the MCP tool the rated turn ran — the server files it,
     * with the reply's resolved model, as an `llm_action_ratings` row the learned
     * router ranks on. So the press teaches routing, not just a button colour.
     */
    setMessageFeedback: (messageId: number, feedback: "up" | "down" | null, context?: {
        toolName?: string | null;
    }) => Promise<{
        ok: boolean;
    }>;
    /**
     * Ask an invited agent participant to reply — a chat-scoped run that answers
     * AS the agent, returning the posted assistant turn (attributed through
     * `metadata.authoredBy`).
     */
    requestAgentReply: (chatId: number, input: {
        agentRef: string;
        agentName?: string;
    }) => Promise<BrainMessage>;
    upload: (file: File) => Promise<{
        key: string;
        name: string;
        type: string;
    }>;
    /** URL to view/download an uploaded file by key. */
    uploadUrl: (key: string) => string;
    /**
     * Mint a short-lived signed public URL for an uploaded object so an upstream
     * LLM provider can fetch it (vision). Used only for an image too large to
     * inline as a data URL — see the image prep in the run loop.
     */
    signedUploadUrl: (key: string) => Promise<string>;
};
/** The precise shape {@link createBrainRestPersistence} returns. */
type BrainRestPersistence = ReturnType<typeof createBrainRestPersistence>;

/**
 * The chat's linked tickets and its run history — read ONCE, for every host.
 *
 * Two routes (`GET /api/brain/chats/:id/tickets`, `GET /api/brain/chats/:id/runs`) had
 * two readers: the panel's chat-tickets REST adapter (`@seanhogg/builderforce-brain-ui`
 * `restAdapter.ts`, behind the diagnostics capture and the Tickets panel) and the VS Code
 * host's task context pack (PRD 35 E2), which cannot load the React package. They live
 * here — pure, fetch-agnostic, no DOM — and each host hands in the authenticated GET it
 * already has. What a reader does with a failure stays the caller's: the panel degrades
 * a history it could not read to "nothing ran", the pack says "could not be read".
 */
/** The host's authenticated JSON GET, relative to the gateway origin. */
type ChatStateGet = <T>(path: string) => Promise<T | undefined>;
/** `GET /api/brain/chats/:id/tickets` — the chat's linked tickets ([] when the body has none). Rejects as `get` does. */
declare function readChatTicketLinks<T>(get: ChatStateGet, chatId: number): Promise<T[]>;
/** `GET /api/brain/chats/:id/runs` — the chat's run history, as the server sends it. Rejects as `get` does. */
declare function readChatRunHistory<H>(get: ChatStateGet, chatId: number): Promise<H | undefined>;

/**
 * A host's one-line note on a run's trace — for what the HOST decided about the run as
 * it settled, which the loop could not know (PRD 35 E8: "no facts were written: the
 * chat's Memory switch is off", so diagnostics do not read "0 writes" as a fault).
 * A key with no cell (evicted, never run) is a no-op.
 */

interface RunNoteStep {
    label: string;
    result: string;
    args?: Record<string, unknown>;
}
declare function noteRunStep(key: RunKey, step: RunNoteStep): void;

/**
 * The live snapshot of one run cell — the binding `useBrainConversation` makes for a
 * chat, and every other view of a run keyed any way (a sub-agent's cell,
 * `startEngineRun`'s canvas turns).
 *
 * Read through `useSyncExternalStore`, so the snapshot returned is ALWAYS the cell named
 * by `key` in this render. The earlier state-plus-effect binding returned the PREVIOUS
 * key's snapshot for the first render after a switch — a panel that walked from one
 * running chat to another briefly reported the old chat's run as the new one's. The
 * store hands out a stable snapshot identity until the cell changes, which is what
 * `useSyncExternalStore` requires.
 */
declare function useRunSnapshot(key: RunKey | null): BrainRunSnapshot;

/**
 * Consecutive failed tool dispatches after which a run is stopped, when the surface
 * names no other number. ONE value, owned here, so every surface stops for the same
 * reason at the same point.
 *
 * ── WHY A FAILURE STREAK, AND NOT A STEP COUNT ──────────────────────────────────
 * A run is not wrong for being long. A bulk ticket clean-up, a rename across a
 * repository, a review of forty branches — each is a hundred honest tool calls, and a
 * step ceiling stopped every one of them mid-task with "kept calling tools without
 * finishing". The ceiling existed to catch a run that had stopped making progress, and
 * that condition has a direct signal: tool calls that keep FAILING. So the only limit
 * the kernel applies is this one — a run whose last N dispatches all failed is stuck,
 * and stopping it is what the step cap was always trying to do by proxy. Five is past
 * the point where the repeat-failure advisories (nudge at 2, instruct at 3) have had
 * their say and been ignored.
 */
declare const DEFAULT_TOOL_FAILURE_STREAK = 5;

/**
 * The durable STEP ROW — the single stored form of a run's tool call, LLM turn or
 * memory step. Every writer builds it here: the client run loop (brain-embedded
 * `persistStep`) and the server's addressed-agent reply (api `BrainService.agentReply`),
 * so the row cannot drift between them. Readers parse it back with brain-embedded's
 * `parseStepMessage`.
 *
 * It is a `role:'tool'` chat message with empty content and `{ kind:'step', … }`
 * metadata. Seed builders exclude `role:'tool'`, so a step row never re-enters a model
 * transcript.
 */
/** A step as a run records it — the fields of a live trace event the row keeps. */
interface StepRowInput {
    category: string;
    label: string;
    /** When the step HAPPENED (ISO) — readers order and dedupe steps by it. */
    ts: string;
    args?: unknown;
    result?: unknown;
    isError?: boolean;
    durationMs?: number;
    ttftMs?: number;
    /** `tool` steps: pre-trim byte size of the full result (the stored copy is capped). */
    resultBytes?: number;
    /** `tool` steps: the result the model saw was truncated. */
    truncated?: boolean;
    /** `llm` steps: token usage the gateway reported for the turn. */
    usage?: unknown;
    /** `llm` steps: OpenAI finish_reason. */
    finishReason?: string | null;
    /** `llm` steps: length of the assistant text the turn produced. */
    textChars?: number;
}
/** The `role:'tool'` message that stores one step. */
declare function stepRow(step: StepRowInput): {
    role: "tool";
    content: "";
    metadata: string;
};

interface AskUserOption {
    label: string;
    description?: string;
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
 * runSteering — direction for a run that is ALREADY running, keyed by run.
 *
 * Ported from `brain-embedded/src/runSteering.ts` (WS2c, PRD 35 §4 row 2c): the composer
 * queue a surface posts mid-run messages to. Keyed by RUN KEY, not by chat — an owner and
 * its children share one chat and each needs its own inbox. A message marked `interrupt`
 * (the person's own words, PRD 35 E10) also aborts the run's interruptible step in flight
 * and skips the rest of its turn; a child's report waits for the step to end.
 *
 * {@link runSteeringSource} binds one run's inbox to the agent's `SteeringSource` port, so
 * a surface that keeps its queue in-process supplies the port with one call. The
 * vision-part rendering the Brain adds on top (`steerModelContent`) stays with the Brain:
 * attachments ride here untyped, as data.
 *
 * No `node:*` imports, no DOM.
 */

/** A queued direction for a run. */
interface RunSteerMessage$1 {
    text: string;
    attachments?: unknown;
    /** The person typed it — not a child's report or an owner's direction to a sub-agent. */
    fromPerson?: boolean;
    /**
     * No surface has shown or saved this message yet — the run must, when it drains it. A host
     * that shows the person's words itself as it queues them (the editor's `say`) leaves it unset.
     */
    persist?: boolean;
    /**
     * A row for these words already exists in the chat (they were said while a run was starting and
     * saved with the send). Explicit, never inferred from the other flags: a host that queues
     * `{ fromPerson: true }` alone (the editor's `say`) means NOT saved by this surface. A continuation
     * (`brain-embedded/src/runStore/continueChat.ts`) saves only the words that are not `saved`.
     */
    saved?: boolean;
    /**
     * The key the saved ROW is stored under (the server upserts on `(chat, event_key)`), minted ONCE: by `queueRunSteering`
     * when the words the run will save (`persist`) are first enqueued, or - for a steer with none (an owner's, a child's) -
     * by the continuation just before its FIRST save attempt, and kept through every requeue. A save that is
     * retried, after a timeout or a requeue, therefore never makes a second row.
     */
    eventKey?: string;
}

/**
 * The Brain's face of the run steering queue (PRD 35 §6.3).
 *
 * The queue itself — keyed by RUN KEY, with its interrupt flag and listeners — lives ONCE, in
 * `@builderforce/agent-run` (`policy/steering/runSteering.ts`): the agent's steering policy
 * and every surface that drains the queue read the same inboxes. What stays here is the
 * Brain's own: the attachment type its composer produces, and the rendering of a steered
 * message into the vision parts a model request carries (`steerModelContent`).
 *
 * Direction for a run that is ALREADY running — redirecting it without stopping it — is
 * how an owner corrects a sub-agent mid-task and how a child's report reaches a parent that
 * is still working. The loop drains the queue before every model turn and, when the model
 * was about to end, re-opens the run for what arrived (`brainRunStore.ts`). A message
 * queued for a run that is not running waits for its next turn — the host decides whether
 * to start one.
 */

/**
 * A queued direction for a run. Carries its attachments so a message steered
 * mid-run reaches the model with the same vision parts a normal send builds —
 * a bare string here is what dropped mid-run images.
 */
interface RunSteerMessage extends Omit<RunSteerMessage$1, 'attachments'> {
    attachments?: ChatInputAttachment[];
}
/**
 * Queue one message for a run's next turn. Blank text is ignored. `interrupt` also
 * aborts the run's interruptible step now (a foreground command) and skips the rest of
 * its turn's calls. Attachments ride along so mid-run messages keep their images;
 * `persist` asks the run to save and show the message when it drains it; `saved` says a row for
 * it already exists (so nothing saves it again).
 */
declare function queueRunSteering(runKey: number, text: string, opts?: {
    interrupt?: boolean;
    attachments?: ChatInputAttachment[];
    fromPerson?: boolean;
    persist?: boolean;
    saved?: boolean;
    eventKey?: string;
}): void;
/** Take every message queued for a run, oldest first. Empty when none are waiting. */
declare function drainRunSteering(runKey: number): RunSteerMessage[];
/**
 * Model-visible content for one steered message: inline images as `image_url` vision
 * parts (the same shape a normal send builds in `useBrainConversation.send`), so a
 * steered message reaches the model identically whether it arrived mid-run or not.
 * Without an image it stays a plain string.
 */
declare function steerModelContent(msg: RunSteerMessage): string | ContentPart[];

/**
 * Planning ends in TASKS, and the tasks are the hand-off to the coding model.
 *
 * Two ways a run leaves planning. A SMALL change is simply made: the planner's first edit
 * moves the run into coding (auto-routed, that edit is re-asked of the coding model —
 * `code_change_attempted` in `@builderforce/run-policy`). Telling the planner it must never
 * edit kept Hybrid runs reading for hundreds of turns without touching a file, so the tool
 * below is OPTIONAL. MULTI-TASK work ends in `hand_off` instead, because the implicit path
 * files nothing and cannot run in parallel (chat #133: MiniMax planned for 22 turns, Grok
 * then re-did it).
 *
 * `hand_off` names the tasks; the run then:
 *   1. files ONE ticket per task, linked to the chat (the board shows the plan);
 *   2. posts the plan into the chat;
 *   3. switches the run to the coding role, and
 *      • where the host can fan out (`spawn_agents`, the editor) and the tasks own
 *        disjoint paths, starts one coding child per task, side by side — in the editor
 *        they run in the BACKGROUND (the coder keeps working; each child posts into the
 *        chat under its own name and its report reaches the coder when it finishes);
 *      • otherwise hands the coder the task list to implement in order.
 *
 * Pure apart from the injected ports, so the run store only wires it.
 */

declare const HAND_OFF_TOOL = "hand_off";
declare const HAND_OFF_TOOL_SPEC: BrainToolSpec;
interface HandOffTask {
    title: string;
    brief: string;
    paths: string[];
    acceptance?: string;
    /** What not to touch, copy or grow — the limits a standalone brief must carry. */
    constraints?: string;
}
interface HandOffPlan {
    summary: string;
    tasks: HandOffTask[];
}
/** Validate the planner's arguments. A string is the corrective the model is handed. */
declare function parseHandOff(args: unknown): HandOffPlan | string;
/** What every task of one plan shares — the run's side of a child's brief. */
interface BriefContext {
    /** The planner's summary of the research. */
    summary: string;
    /** What the user asked for, in their words — the goal every slice serves. */
    request?: string | null;
    /** The planning run's record of what it read and searched (`RunKnowledgeLog.brief`). */
    knowledge?: string | null;
}
/**
 * A child's whole brief. It sees nothing else, so everything the coder would otherwise
 * have to rediscover rides along: the goal in the user's words, the slice and its limits,
 * how it is accepted, the planner's summary of the research and the run's record of what
 * was already read. How it REPORTS is its standing instructions (`subagentSystemPrompt`).
 */
declare function childTaskBrief(task: HandOffTask, ctx: BriefContext, ticketId?: number): string;
/**
 * Whether the plan can run side by side: two or more tasks, every one owning paths, and
 * no two owning the same file. A plan that fails this runs inline, in order — the safe
 * reading of a breakdown whose slices touch each other. This is where slices are kept
 * apart: every child is a clone of its owner, and nothing downstream restricts it.
 */
declare function canRunInParallel(tasks: readonly HandOffTask[]): boolean;
/** The plan as the user reads it in the chat. */
declare function planMessage(plan: HandOffPlan, ticketIds: ReadonlyArray<number | undefined>, parallel: boolean): string;
/** What the run hands the executor. */
interface HandOffPorts {
    /** The run's own dispatcher — the same relay and gates the model's calls ride. */
    runTool(name: string, args: Record<string, unknown>): Promise<unknown>;
    /** Every tool name the host advertises this run. */
    toolNames: ReadonlySet<string>;
    /** The planning run's record of what it read and searched (`RunKnowledgeLog.brief`). */
    knowledge?: string | null;
    /** What the user asked for — every child's brief opens with the goal. */
    request?: string | null;
    projectId?: number;
    /** Called with each created ticket's result, so the run links it to the chat. */
    afterCreate?(toolName: string, out: unknown): Promise<void>;
    /** Record a step the run took on the planner's behalf. */
    step?(label: string, args: Record<string, unknown>, out: unknown, durationMs: number): void;
    /** Post the plan into the chat. */
    postPlan?(text: string): Promise<void>;
    now?(): number;
}
/** What the coding model reads back as the `hand_off` result. */
interface HandOffOutcome {
    ok: boolean;
    mode: 'parallel' | 'inline';
    tickets: Array<{
        title: string;
        id?: number;
    }>;
    workstreams?: unknown[];
    changedFiles?: string[];
    /** Placeholders the children wrote, for the run's placeholder guard. */
    placeholders?: unknown[];
    next: string;
}
/**
 * Carry the plan out. Never throws: a failed ticket or a refused fan-out degrades to the
 * inline path, which is always available — the coder is the run itself.
 */
declare function executeHandOff(plan: HandOffPlan, ports: HandOffPorts): Promise<HandOffOutcome>;

/**
 * The files a finished call changed, or `null` when the call changes no code at all.
 * An empty array means "a code change happened, but no path could be read from it"
 * — still a code change for the backstop, just not one with a file to name.
 */
declare function codeChangesOf(name: string, args: unknown, out: unknown): string[] | null;

/**
 * The PLACEHOLDER guard — unfinished work written into code, caught at the moment it is
 * written and named in the diagnostics.
 *
 * Measured on chat #127: asked to thread the parent run's abort signal into a delegated
 * sub-agent, the VS Code agent wrote
 *
 *     return undefined; // TODO: wire up the actual signal
 *
 * plus comments that were its own thinking left in the source ("Let me use that approach
 * instead", "A proper implementation would…"), committed it, and reported the bug FIXED.
 * Nothing in the run noticed: the edit succeeded, the tool answered `{ ok: true }`, and
 * the diagnostics counted "19 mutating calls, 19 succeeded". A stub is the one kind of
 * edit that succeeds by every measure the run had and does nothing.
 *
 * So a successful code write is scanned for NEW placeholder markers — markers the
 * replaced text did not already carry, so editing near an old TODO is not blamed on this
 * run — and two things happen: the model is told on the result it reads (the only moment
 * it can still finish the work), and a trace step records it, which the copied
 * diagnostics report as its own line.
 *
 * Only COMMENTS are scanned (plus the one code-shaped stub, `throw new Error("not
 * implemented")`): a string such as an input's `placeholder="Search"` is product copy,
 * not unfinished work. Only source files are scanned: a roadmap that lists TODO items is
 * doing its job. Pure: no I/O, no clock.
 */

/** One placeholder line a write introduced. */
interface PlaceholderHit {
    path: string;
    /** The offending line, trimmed and capped. */
    text: string;
}
/**
 * The placeholder lines ONE successful write introduced. `write_file` is judged on its
 * whole content; `edit_file` on what its replacement adds beyond what it replaced.
 */
declare function placeholdersWritten(tool: string, args: unknown): PlaceholderHit[];
/** What the model reads on the result of a write that introduced placeholders. */
declare function placeholderAdvisory(hits: readonly PlaceholderHit[]): string | null;

/**
 * The run DRIVER seam: who actually executes a Brain run.
 *
 * By default a run executes in the process that called `startRun` — the module-level
 * store in `brainRunStore.ts` IS the loop. A host whose UI process is disposable (the
 * VS Code webview: closing the tab destroys its JavaScript context and, with it, any
 * loop running inside it) installs a driver that hands the run to a process that
 * outlives the view — the extension host — and MIRRORS that process's run state back
 * into this store with {@link applyRemoteRun}, so every consumer (`useBrainConversation`,
 * the timeline, the cross-chat indicator) keeps reading the same store it always did.
 *
 * The seam is deliberately five verbs: the store's own public API for a run (plus the words a person says to it), minus
 * reads. Reads stay local, fed by the mirror.
 */

/** One turn said to a chat's run through the driver: its words, its files, and the key that makes saying it twice the same as once. */
interface SteerTurn {
    text: string;
    attachments?: ChatInputAttachment[];
    eventKey: string;
}
interface BrainRunDriver {
    /** Execute a run elsewhere. Resolves when that run has settled, like `startRun`. */
    start(chatId: number, req: BrainRunRequest): Promise<void>;
    stop(chatId: number): void;
    confirm(chatId: number, ok: boolean): void;
    clearError(chatId: number): void;
    /**
     * Words for a CHAT's run, wherever that run executes - the chat-keyed twin of `queueRunSteering`, for a process whose
     * in-page inbox is read by nobody. The process that owns the run decides what they are: heard by the run when it is live
     * or being set up, the chat's next turn when it is idle (the editor host's `runSteer.steerTurns`: its inbox + wake) - SEVERAL
     * turns together are ONE continuation, in order. Keyed by the chat, never by the view that happens to be showing it. Each
     * turn carries its own key: the host hears a turn it has already heard (a repeated post) once.
     */
    steer(chatId: number, turns: readonly SteerTurn[]): void;
}
/** Route this process's runs through `driver`; `null` restores in-process execution. */
declare function installRunDriver(driver: BrainRunDriver | null): void;
declare function getRunDriver(): BrainRunDriver | null;

/** One queued item, as a {@link OutboxStore} persists it. JSON-serialisable when `T` and `K` are. */
interface OutboxEntry<T, K> {
    /** The entry's idempotency key — unique, minted when it was queued. */
    id: string;
    key: K;
    item: T;
    /** Monotonic queue position; FIFO order across restarts. */
    seq: number;
    /** Set once the entry has been sealed into a batch: that batch's idempotency key. */
    batch?: string;
    /** The scope (e.g. tenant id) it was queued under; absent = sendable under any scope. */
    scope?: string;
    /** Permanent refusal retained for export/repair; dead letters are never sent automatically. */
    deadLetter?: {
        reason: string;
        at: string;
    };
    /**
     * Set at enqueue from the work classification. Durable user work is never
     * auto-evicted; best-effort telemetry may be dropped.
     */
    retention?: OutboxRetention;
}
/** Durable user work is retained. Best-effort telemetry may be dropped. */
type OutboxRetention = "durable" | "best-effort";
/**
 * Where queued entries live between being queued and being acknowledged. Calls are
 * serialised by the outbox (never two at once, always in order), and `put`/`remove`
 * never run before `load` has settled.
 */
interface OutboxStore<T, K> {
    load(): Promise<OutboxEntry<T, K>[]> | OutboxEntry<T, K>[];
    /** Insert or replace by `id`. */
    put(entries: OutboxEntry<T, K>[]): Promise<void> | void;
    remove(ids: string[]): Promise<void> | void;
}
/** The host's connectivity. `subscribe` returns an unsubscribe. */
interface OutboxOnlineSignal {
    isOnline(): boolean;
    subscribe(listener: (online: boolean) => void): () => void;
}
interface OutboxSendPermission {
    isAllowed(): boolean;
    subscribe(listener: (allowed: boolean) => void): () => void;
}

/**
 * stepOutbox — the run's durable step rows, sent in batches instead of one POST each.
 *
 * Every tool call, LLM turn and memory step a run takes is persisted as a `role:'tool'`
 * message (see `persistedSteps.ts`). Sent one at a time that was a full
 * `POST /chats/:id/messages` per step — measured on chat #142: 57 tool calls over 22
 * turns, ~80 requests, each costing the API an access check, a membership upsert, the
 * insert, the seq update, the chat touch and a learn-gate read. The endpoint writes an
 * ARRAY in one insert; nothing about a step row needs its own request.
 *
 * So step rows go through the shared write outbox (`@builderforce/write-outbox`), one
 * lane per chat, and leave:
 *   - riding along with the next conversational send for that chat (assistant text, a
 *     stopped turn, a run failure) — the same request, zero extra calls;
 *   - when {@link STEP_BATCH_MAX} rows are queued;
 *   - {@link STEP_BATCH_WAIT_MS} after the first queued row, at the latest;
 *   - when the run ends ({@link StepBatchingPersistence.flush}).
 *
 * ORDER holds by construction: a chat's lane has one request in flight at a time, and a
 * conversational send waits its turn in that lane, so nothing it writes can overtake a
 * step batch already on the wire.
 *
 * DURABLE: the outbox runs in its durable mode. A step batch that fails to send (offline,
 * a redeploy, a dropped connection) is kept at the head of its chat's lane and retried
 * with backoff — or the moment the host's `online` signal comes back — instead of being
 * dropped; a failed conversational send hands its piggybacked rows back to the lane and
 * still throws to its caller. Only a batch the server REFUSED (a 4xx) is dropped. Every
 * row carries an `eventKey` minted from its outbox entry id, so a replay of a batch the
 * server already wrote is recognised (`uq_brain_chat_messages_event`) and writes nothing
 * twice. With a host `store` the queue also survives a restart.
 */

/** A row as the step outbox queues and persists it. */
type StepOutgoingMessage = {
    role: string;
    content: string;
    metadata?: string;
    eventKey?: string;
};
/**
 * How a HOST makes step rows work fully offline: where each queue is stored, the host's
 * connectivity + identity, and a RUN-INDEPENDENT sender. Installed once by the host (the
 * web app over IndexedDB, the VS Code extension host over its workspace state).
 *
 * With `sendRows` + `storedKeys`, every stored queue is drained on install (startup) and
 * again whenever the host comes back online — no run in that chat is needed, because a
 * step row is just a POST to its chat's messages endpoint (idempotent on `eventKey`).
 * Without durability a run's rows are still retried, for the life of the process.
 */
interface StepDurability {
    /** The store for one queue. `key` names the chat (and, for a sub-agent, its run). */
    storeFor(key: string): OutboxStore<StepOutgoingMessage, number>;
    /** Every key that currently holds a stored queue. */
    storedKeys?(): Promise<string[]> | string[];
    /** POST rows to a chat (the base persistence port), AS `scope` when given. Throws on
     *  failure, with the HTTP `status` when there was one (a 4xx is dropped). */
    sendRows?(chatId: number, rows: StepOutgoingMessage[], scope?: string): Promise<unknown>;
    online?: OutboxOnlineSignal;
    scope?(): string | null;
    /** Administrative permission, independent of network reachability. */
    sendPermission?: OutboxSendPermission;
}
/** Install (or with `null`, remove) the host's step durability, and drain what is stored. */
declare function installStepDurability(next: StepDurability | null): void;

/**
 * Durable Brain run steps over IndexedDB — the ONE installer for every host that has
 * IndexedDB: a browser tab (the web app) and an MV3 service worker / extension page
 * (the Chrome extension, Rovr).
 *
 * A run's step rows go through the step outbox (`stepOutbox.ts`); installed with this,
 * each chat's queue is kept in ONE IndexedDB database, one partition per queue, so rows
 * a run could not save — the host went offline, the API redeployed, the worker was put
 * to sleep — survive a reload. Every stored queue is drained on install and again each
 * time the host comes back online, straight to its chat's messages endpoint (no run in
 * that chat needed), under the event keys the rows were first sent with (no duplicates).
 *
 * Rows are SCOPED to the identity they were written under (`scope()`): a queue written in
 * one workspace is parked, never replayed into another. `sendRows` re-checks the scope at
 * send time, which closes the window where the identity switches mid-send.
 *
 * Host-neutral: the IndexedDB factory, the connectivity signal, the identity and the
 * sender are injected; nothing here reads `window`, `self` or `chrome`.
 */

interface IndexedDbStepDurabilityOptions {
    /** `indexedDB` in a tab, `self.indexedDB` in a service worker. */
    indexedDB: IDBFactory;
    /** One database per host, e.g. `builderforce-outbox:brain-steps`. */
    dbName: string;
    /** The host's connectivity — rows wait while offline and replay on reconnect. */
    online: OutboxOnlineSignal;
    /** The identity rows are sent as right now (e.g. `tenant:7`); null = nobody yet. */
    scope(): string | null;
    /** POST rows to a chat's messages endpoint. Throws on failure, with the HTTP `status`
     *  when there was one (a 4xx is dropped, anything else is retried). */
    sendRows(chatId: number, rows: StepOutgoingMessage[]): Promise<unknown>;
}
/** Install IndexedDB-backed step durability for this host and drain what is stored. */
declare function installIndexedDbStepDurability(opts: IndexedDbStepDurabilityOptions): void;

/**
 * The seed, and the persisted message id behind each seed entry, in
 * order — what lets a run's fold record which persisted messages its note covers
 * (`BrainRunRequest.seedIds`, `runFoldMarker.ts`).
 */
declare function transcriptSeedOf(history: BrainMessage[]): {
    messages: ChatCompletionMessage[];
    ids: number[];
};

/**
 * The progress picture as report text — the lines a copied diagnostic carries and the
 * one-sentence verdict its "Likely cause" header leads with. The numbers are
 * `runProgress.ts`'s; this module only words them.
 */

/** Compact duration for a report line (0.4s / 12s / 3m 20s). */
declare function progressDuration(ms: number): string;
/**
 * Render the progress picture as report lines. Emitted only when there is
 * something to say — a run that advanced cleanly adds a single "Progress:" line
 * rather than four sections of zeroes.
 */
declare function formatRunProgress(p: RunProgress): string[];
/**
 * The one-sentence verdict for a run that spun or had no effect. Returned
 * separately from {@link formatRunProgress} because it belongs in the "Likely
 * cause" header, above every other signal — a reader who acts on the header alone
 * must be sent at the real fault. Null when neither condition holds.
 */
declare function runProgressVerdict(p: RunProgress): string | null;

/**
 * The `composing` phase — a turn that is streaming a TOOL CALL, made visible.
 *
 * The run loop published its live phase off text deltas alone. A turn that emits no
 * prose and one large tool call therefore showed nothing: chat #113 streamed
 * "Writing the Advisor Platform PRD and filing the epic now." and then sat on
 * "streaming the reply" for 3m 23s while the model pushed 21 KB of `write_file`
 * arguments down the wire. Every byte of that was progress, and none of it was on
 * screen — the one failure mode that makes a working agent indistinguishable from a
 * wedged one.
 *
 * This module owns the whole of that behaviour: a factory that builds the
 * `onToolCallDelta` member of `StreamHandlers` for one turn. It lives here rather
 * than in `brainRunStore.ts` because that file is already ~2,700 lines, and because a
 * pure fold over deltas is testable in isolation while a run-loop closure is not.
 *
 * Pure except for the injected sink and clock.
 */

/**
 * Where a composing update goes. Deliberately three narrow callbacks rather than the
 * run cell itself, so this module never learns what a `RunCell` is:
 *
 * - `set`              — store the activity value (no repaint of its own).
 * - `repaint`          — draw NOW. A phase change must not wait for a frame.
 * - `coalescedRepaint` — draw within a frame, folding every delta that lands meanwhile.
 *   Argument fragments arrive as fast as tokens do, so the steady state has to cost a
 *   frame, not a render per fragment.
 */
interface ComposingSink {
    set(activity: BrainRunActivity): void;
    repaint(): void;
    coalescedRepaint(): void;
}
interface ComposingOptions {
    /** 1-based agent-loop iteration this turn belongs to. */
    step: number;
    /** Clock, injected so the tests own it. Defaults to `Date.now`. */
    now?: () => number;
}
/** One turn's composing tracker. `reset` starts it over for a retried turn. */
interface ComposingActivity {
    /** Wire this as `StreamHandlers.onToolCallDelta`. */
    onDelta(index: number, partial: {
        id?: string;
        name?: string;
        argsFragment?: string;
    }): void;
    /** Argument bytes seen so far this turn. */
    bytes(): number;
    /** Discard the attempt — a stream-interrupt retry re-streams the whole turn. */
    reset(): void;
}
/** UTF-8 byte length of a string. What the wire actually carried, not its char count. */
declare function utf8ByteLength(text: string): number;
/** Total argument bytes of a turn's assembled tool calls — the settled twin of
 *  {@link ComposingActivity.bytes}, for the durable turn record. */
declare function toolCallArgBytes(calls: ReadonlyArray<{
    args?: string;
}>): number;
/**
 * Build the `onToolCallDelta` handler for one turn.
 *
 * On the first fragment it publishes the `composing` phase and repaints immediately —
 * a phase change the user is waiting on must never trail a frame. Every later fragment
 * adds its bytes and repaints on the coalesced path.
 *
 * `startedAt` is stamped ONCE and held. The live renderer re-seeds its elapsed ticker
 * whenever `startedAt` changes, so re-stamping it per delta would pin the clock at 0s
 * for the entire three minutes — the exact reassurance this phase exists to give.
 */
declare function createComposingActivity(sink: ComposingSink, opts: ComposingOptions): ComposingActivity;

/**
 * A size budget for a copied triage report.
 *
 * Per-payload capping alone is not enough. A 26-call run with a 4 KB cap per
 * payload can still assemble a 120 KB report, and every paste target downstream
 * (issue trackers, chat clients, a model's own context) truncates from the END —
 * which is precisely where the failure being triaged lives. The pasted report
 * this module exists for ended mid-sentence with "[Message truncated - exceeded
 * 50,000 character limit]", losing every turn after the tenth.
 *
 * So the report budgets itself, and spends what it has where the information is:
 *
 *  1. The header, diagnostics and signals are never charged — they are the part a
 *     reader acts on, and they are bounded already.
 *  2. Payloads are charged against a shared pool. As the pool drains, the
 *     per-payload cap SHRINKS, so an early verbose tool result cannot eat the
 *     allowance the later ones need.
 *  3. A payload byte-identical to one already emitted is replaced by a back
 *     reference. A run that read the same file seven times pays for it once —
 *     and the back reference is itself a finding, since it makes the repetition
 *     visible in the body rather than only in the diagnostics block.
 *
 * The result is a report that stays under the limit end-to-end instead of being
 * complete for its first third and absent for the rest.
 */
/** What a budget was asked to enforce. */
interface PayloadBudgetOptions {
    /** Total characters all payloads may consume together. */
    total: number;
    /** Ceiling for any single payload while the pool is full. */
    perPayload: number;
    /**
     * Floor the per-payload cap decays to as the pool drains. Below this a payload
     * is not worth including at all, so it is elided with a marker instead.
     */
    minPayload?: number;
}
interface PayloadBudgetStats {
    /** Characters actually emitted into payload blocks. */
    spent: number;
    /** Payloads shortened because the pool had run low. */
    trimmed: number;
    /** Payloads replaced by a back reference to an identical earlier one. */
    deduped: number;
    /** Characters saved by those back references — the cost of the repetition. */
    dedupedChars: number;
}
interface PayloadBudget {
    /**
     * Charge a payload against the budget and return what should be printed for it.
     * `label` names the block (e.g. `read_file Output`) so a back reference can say
     * what it points at.
     */
    cap(payload: string, label: string): string;
    stats(): PayloadBudgetStats;
    /** A one-line note for the report when the budget actually bit; null otherwise. */
    note(): string | null;
}
/**
 * Create a budget. Stateful by design — the caller walks the transcript once, in
 * order, charging each payload as it goes.
 */
declare function createPayloadBudget(opts: PayloadBudgetOptions): PayloadBudget;

/**
 * Did this run's change actually SHIP?
 *
 * `tickets.from_delta` opens its ticket in the `in_review` lane, and its own tool
 * description promises the ticket "completes automatically once merged and
 * deployed". That completion never happened: nothing in the codebase moves a delta
 * ticket out of `in_review`. So every ad-hoc change an agent recorded left a ticket
 * pinned at 50% on the board, forever, with no actor and no event that could ever
 * finish it — the board slowly filling with half-done work that was in fact done.
 *
 * The intended completer was a GitHub merge webhook, which only fires for a change
 * that went through a pull request. It cannot fire for the case this module covers:
 * the agent committed and pushed straight to the base branch, in the same run. There
 * the run has first-hand evidence the work shipped, and is the only thing that will
 * ever have it.
 *
 * The evidence has to be strong, because completing a ticket that did NOT ship is a
 * worse failure than leaving one open. Two independent facts are required:
 *
 *  1. A `git push` actually SUCCEEDED in this run.
 *  2. A git status observed AFTER that push shows the working branch is a BASE
 *     branch, tracking an upstream, with nothing left to push.
 *
 * A push to a feature branch fails (2) on the branch name; an unpushed commit fails
 * it on `ahead`; a run that only edited files fails (1). Every ambiguous case fails
 * closed and leaves the ticket alone.
 *
 * Pure over the recorded trace — no clock, no shell, no I/O.
 */

/**
 * Branches whose content is, by definition, shipped. Deliberately just the two
 * conventional defaults: a repo whose base branch is named something else simply
 * does not auto-complete, which is the safe direction to be wrong in.
 */
declare const BASE_BRANCHES: ReadonlySet<string>;
interface GitShortStatus {
    branch: string | null;
    upstream: string | null;
    ahead: number;
    behind: number;
}
/**
 * Parse the branch header of `git status --short --branch`.
 *
 * The first line is `## <branch>...<upstream> [ahead N, behind M]`, or `## <branch>`
 * with no upstream, or `## HEAD (no branch)` when detached. Returns null when no
 * such header is present, so a caller can never mistake "could not tell" for
 * "clean and pushed".
 */
declare function parseGitShortStatus(output: string): GitShortStatus | null;
/**
 * The file paths `git status --short` lists as changed or untracked, repo-relative.
 * A rename line (`R  old -> new`) yields the new path; git's quoting of paths with
 * spaces is undone.
 */
declare function dirtyPathsOf(output: string): string[];
/**
 * Did this run push its work to a base branch and verify it landed?
 *
 * Requires a successful push, and then a status — recorded AT OR AFTER it — showing a
 * base branch, an upstream, and nothing left to push. Order matters: a status taken
 * BEFORE the push says nothing about whether the push worked. The push step itself
 * counts as the observation when its own output carries the status header — the
 * `git_push` tool prints `git status --short --branch` after pushing, so the declared
 * route verifies itself instead of depending on the model remembering a follow-up call.
 *
 * `touchedFiles` (workspace-relative) closes the last hole: a push of SOME commit while
 * the change this run made is still uncommitted. When the confirming status lists any
 * touched file as modified or untracked, the change did not ship, whatever the header
 * says.
 */
declare function shippedToBaseBranch(events: readonly BrainTraceEvent[], opts?: {
    touchedFiles?: readonly string[];
}): boolean;

/**
 * THE tool-output policy: what a tool result costs the MODEL transcript, and how it is
 * cut down when it costs too much. The full result always survives in the surface's
 * own trace; only the copy the model re-reads every turn is bounded.
 *
 *   • `read_file` is paged by line with the continuation offset rewritten
 *     ({@link windowReadFile});
 *   • with the C7 lever on (`summarize: true`), a shell/test/build log is summarized
 *     ({@link summarizeShellOutput}) and any other large JSON is PROJECTED
 *     ({@link projectJson}) instead of head-sliced;
 *   • otherwise (and as the last resort) a head slice with an explicit marker, so the
 *     model knows data was elided and can re-call with a narrower filter.
 *
 * Pure: no I/O, no clock, no env. The lever decision arrives as a parameter.
 */

interface ShapedToolResult {
    /** The string to store as the tool message the model sees. */
    content: string;
    /** Size of the ORIGINAL result's JSON — what diagnostics report as result bytes. */
    bytes: number;
    /** True when the model was handed less than the tool returned. */
    truncated: boolean;
    /** `read_file` only: the window the model was served, before the advisory — what read
     *  coverage records instead of the untrimmed result. */
    served?: Record<string, unknown>;
}

/**
 * What a tool result costs the MODEL transcript on the Brain — the Brain's adapter over
 * THE shared policy, `@builderforce/tool-output-policy` (PRD C7).
 *
 * The full result always survives in the trace (timeline + triage copy); only the copy
 * the model re-reads every turn is bounded. The rules — `read_file` paged at a LINE
 * boundary with its continuation offset rewritten (the fix for chat #99, where a 6,000-
 * char slice deleted the paging fields and the model re-read one file six times), the
 * generic head slice with an item-count marker, and, with the C7 lever on, log
 * summaries and JSON projection — live in that package, shared with agent-runtime, the
 * cloud loop and the container. What stays here is the Brain's own convention for the
 * loop-guard advisory: folded into the result's `note` (`withAdvisory`).
 *
 * Pure: no I/O, no clock.
 */

/** Per-result cap (chars of JSON) for every tool that is not a file read. */
declare const MAX_TOOL_RESULT_CHARS = 6000;
/** Per-result cap for `read_file` — paged by line, so a big file arrives in windows. */
declare const READ_FILE_RESULT_CHARS: number;
type TrimmedToolResult = ShapedToolResult;
interface TrimOptions {
    /**
     * A loop-guard advisory to attach to the result (the re-read warning). Attached AFTER
     * trimming so the trim can never delete it, and folded into the same `note` field the
     * tools' own guidance uses so the model meets one convention.
     */
    advisory?: string | null;
    /**
     * The C7 lever decision (log summaries + JSON projection). Defaults to the lever's
     * manifest/rollout answer for an on-device host (no tenant: on only when fully on).
     */
    summarize?: boolean;
    /**
     * The serving model's context window (tokens), when the run knows it
     * (`RunWindowFit.contextWindow`). Sizes the cap through the shared `windowedCap`: a
     * bigger `read_file` page on a large window, a smaller result on a tiny one. Unknown =
     * today's fixed caps.
     */
    contextWindowTokens?: number;
}
/**
 * Trim a tool result to what the model transcript can afford. `bytes` is always the
 * ORIGINAL size — the diagnostics report it. For `read_file`, `served` is the window the
 * model was handed before the advisory — what read coverage records.
 */
declare function trimToolResult(tool: string, out: unknown, opts?: TrimOptions): TrimmedToolResult;

/**
 * A dead stream has to END, not hang.
 *
 * `reader.read()` on a stalled upstream never settles: the socket is open, the gateway
 * is waiting on a provider that will never speak again, and the agent loop waits with
 * it — forever, or until the user presses Stop. Chat #113 sat on one turn for 3m 23s
 * (that one was alive, streaming tool arguments), and the same picture with a genuinely
 * dead upstream is indistinguishable from the outside. A turn that stops producing
 * bytes must fail, so the run loop can do what it already knows how to do with an
 * interrupted stream: retry once on another model.
 *
 * This is the whole mechanism: race each read against an idle timer, cancel the reader
 * when the timer wins, and throw. Isolated from `streamChatCompletion.ts` so it can be
 * tested with fake timers instead of a live socket, and so there is exactly ONE idle
 * rule in the package.
 */
/**
 * Silence that ends a stream. Deliberately generous: a reasoning model can think for
 * minutes before its first token, and a false positive costs a wasted turn on another
 * model. Four minutes of ZERO bytes is not thinking, it is a dead connection.
 */
declare const STREAM_IDLE_MS = 240000;
/** The stream produced no bytes for {@link IdleWatchdogOptions.idleMs}. */
declare class StreamIdleError extends Error {
    /** The silence that was exceeded, so the caller can say it in its own message. */
    readonly idleMs: number;
    constructor(idleMs: number);
}
/** The slice of `ReadableStreamDefaultReader` this needs — structural, so a test
 *  passes a plain object and a browser passes the real reader. */
interface IdleWatchdogReader<T> {
    read(): Promise<T>;
    cancel(reason?: unknown): Promise<unknown> | unknown;
}
interface IdleWatchdogOptions {
    /** Silence before the read is abandoned. Defaults to {@link STREAM_IDLE_MS}. */
    idleMs?: number;
    /** Observer for the idle trip (a trace line, a metric). Never throws the error itself. */
    onIdle?(idleMs: number): void;
}
/**
 * One `reader.read()`, bounded by an idle timer. Resolves with the chunk when the
 * stream speaks; cancels the reader and throws {@link StreamIdleError} when it does not.
 *
 * The losing `read()` promise is left pending on purpose — cancelling the reader is what
 * releases it — with its rejection swallowed so an aborted socket cannot surface as an
 * unhandled rejection after the caller has already been told the stream went silent.
 */
declare function readWithIdleWatchdog<T>(reader: IdleWatchdogReader<T>, opts?: IdleWatchdogOptions): Promise<T>;

/**
 * CHAT ACTIVITY — the structured contract behind a run milestone / agent dispatch line.
 *
 * The runtime narrates itself into the conversation that spawned the work: "▶️ **Ada**
 * started working on task #41", "✅ … finished … — moved to **in review**". Those rows
 * are persisted as ordinary `role:'assistant'` messages carrying `metadata.runMilestone`
 * / `metadata.agentDispatch`, and BOTH chat renderers showed them as exactly that: an
 * assistant bubble with an emoji glued to the front, indistinguishable from something
 * the model said — and, because the server composed the sentence in English, untouchable
 * by either surface's i18n.
 *
 * This module is the fix's foundation: the metadata carries the FACTS (who, which
 * ticket, which phase, which lane, the first line of the result), and each surface
 * renders the sentence itself from its own catalogue. So the line is a system/activity
 * line rather than a bubble, and it is localized where localization actually lives —
 * next-intl on the web, `vscode.l10n.t()` in the VS Code webview.
 *
 * Older rows carry only the English `content` (the structured fields did not exist yet).
 * {@link parseChatActivity} still recognises them and reports `text: undefined`, so a
 * renderer falls back to the stored sentence: an old transcript keeps reading correctly,
 * it just isn't translated.
 */
/** The lifecycle moments a run narrates. Mirrors the api's `RunMilestonePhase`. */
type RunMilestonePhase = 'started' | 'completed' | 'failed' | 'paused' | 'resumed' | 'cancelled';
/** One run-lifecycle line. */
interface RunMilestoneActivity {
    kind: 'milestone';
    phase: RunMilestonePhase;
    /** Display name of the agent, resolved server-side (it owns the workforce directory). */
    agentName: string;
    /** `task` | `epic` | `gap` — the ticket vocabulary, rendered as-is. */
    ticketKind: string;
    ticketRef: string;
    executionId: number | null;
    /** Lane the ticket moved to on completion, already de-underscored. */
    toStatus?: string;
    /** First line of the run result (completed) or the error (failed). */
    note?: string;
    /** The `ask_human` question a `paused` milestone is blocked on. */
    question?: string;
}
/** One "an agent joined this ticket" line. */
interface AgentDispatchActivity {
    kind: 'dispatch';
    agentName: string;
    ticketKind: string;
    ticketRef: string;
}
type ChatActivity = RunMilestoneActivity | AgentDispatchActivity;
/**
 * Parse a message's activity metadata, or null when it is an ordinary turn.
 *
 * Defensive by construction: a malformed blob, or one missing the structured fields,
 * yields either null or an activity whose optional fields are simply absent — never a
 * throw, and never a half-built sentence.
 */
declare function parseChatActivity(msg: {
    metadata?: string | null;
}): ChatActivity | null;
/** True when a message is an activity line rather than something the model said. */
declare function isActivityMessage(msg: {
    metadata?: string | null;
}): boolean;
/**
 * How many activity lines a transcript holds. A NEW one means the server just changed the
 * chat's ticket/agent state (a run milestone joins the running agent to the chat), so a
 * host feeds this into its ticket-rail refresh signal to re-read the Agents list live.
 */
declare function activityMessageCount(messages: ReadonlyArray<{
    metadata?: string | null;
}>): number;
/**
 * The label templates a surface must supply to render an activity line in ITS language.
 * Every value is a template with `{…}` placeholders — never a pre-composed sentence — so
 * word order is the translator's to decide.
 */
interface ChatActivityLabels {
    /** `{agent}`, `{kind}`, `{ref}` */
    milestoneStarted: string;
    /** `{agent}`, `{kind}`, `{ref}` */
    milestoneCompleted: string;
    /** `{agent}`, `{kind}`, `{ref}`, `{lane}` */
    milestoneCompletedWithLane: string;
    /** `{agent}`, `{kind}`, `{ref}` */
    milestoneFailed: string;
    /** `{agent}`, `{kind}`, `{ref}` */
    milestonePaused: string;
    /** `{agent}`, `{kind}`, `{ref}`, `{question}` */
    milestonePausedWithQuestion: string;
    /** `{agent}`, `{kind}`, `{ref}` */
    milestoneResumed: string;
    /** `{agent}`, `{kind}`, `{ref}` */
    milestoneCancelled: string;
    /** `{agent}`, `{kind}`, `{ref}` */
    agentDispatched: string;
}
declare const DEFAULT_CHAT_ACTIVITY_LABELS: ChatActivityLabels;
/** The glyph that marks each activity — one per phase, shared by both surfaces. */
declare function activityIcon(activity: ChatActivity): string;
/** Tone for the activity line — drives the accent colour, not the wording. */
declare function activityTone(activity: ChatActivity): 'neutral' | 'good' | 'bad' | 'waiting';
/**
 * Compose the activity's sentence FROM the structured facts, in the caller's language.
 * Pure, so both surfaces get identical wording rules from one implementation and the
 * only thing that differs between them is the catalogue they hand in.
 */
declare function chatActivityText(activity: ChatActivity, labels: ChatActivityLabels): string;

/**
 * persistedSteps — the READER for the durable tool/memory step rows the agent
 * loop writes, and the counterpart to `brainRunStore.persistStep`.
 *
 * A run's `trace` is IN-MEMORY ONLY: it lives on the run cell and is gone the
 * moment the chat is closed, remounted, or resumed in another window. That is
 * exactly why every tool/memory step is ALSO persisted as a `role:'tool'` message
 * whose `metadata` carries `{ kind:'step', … }`.
 *
 * Every consumer that wants "the steps of this conversation" therefore has to read
 * BOTH sources and de-duplicate. The timeline already did; the triage diagnostics
 * did not — it counted the live `trace` alone, so a copied transcript of a reopened
 * chat rendered 20 tool calls from the persisted rows while the Diagnostics block
 * above it said `Tool calls: 0`, `Tool results: 0 B`, and — starved of signal —
 * `Likely cause: Inconclusive`. Both now go through {@link traceWithPersistedSteps}.
 */

/** A tool/memory step in the shape shared by a live `trace` event and its durable
 *  persisted copy — so ONE builder covers both sources. */
interface PersistedStep {
    category: string;
    label: string;
    args?: unknown;
    result?: unknown;
    isError?: boolean;
    durationMs?: number;
    /** `tool` steps: pre-trim byte size of the full result (the stored copy is capped). */
    resultBytes?: number;
    /** `tool` steps: the result the model saw was truncated. */
    truncated?: boolean;
    /** `llm` steps: token usage the gateway reported for the turn. */
    usage?: {
        prompt?: number;
        completion?: number;
        total?: number;
    };
    /** `llm` steps: OpenAI finish_reason. */
    finishReason?: string | null;
    /** `llm` steps: length of the assistant text the turn produced. */
    textChars?: number;
    /** `llm` steps: time-to-first-token. */
    ttftMs?: number;
}
/**
 * Identity of a step across the live trace and its durable copy: same category +
 * label + client timestamp. Lets a step present in BOTH be handled once, while a
 * prior run's step — present only in the messages — still counts.
 */
declare function stepSig(category: string, label: string, tsIso: string | undefined): string;
/**
 * Parse a persisted `role:'tool'` step message's metadata into a {@link PersistedStep}
 * plus its client timestamp. Null when the row isn't a well-formed step (so it is
 * never rendered as an assistant bubble or counted as a tool call).
 */
declare function parseStepMessage(metadata: string | null): {
    step: PersistedStep;
    tsIso?: string;
} | null;
/**
 * The FULL step + turn history of a conversation as trace events: the live
 * in-memory `trace` plus every durable step row the messages carry that the trace
 * doesn't already hold (deduped by {@link stepSig}). Ordered by timestamp so a
 * reader sees the run in sequence.
 *
 * Feed this — not the bare `trace` — to `computeBrainDiagnostics` so a reloaded or
 * resumed chat reports the tool calls it actually made.
 *
 * `persistStep` stores the diagnostics scalars alongside each step — the pre-trim
 * `resultBytes` + `truncated` flag on a tool step, and `usage` / `finishReason` /
 * `textChars` on an `llm` turn — so a recovered run reports the same tool counts,
 * payload sizes, token peaks and finish reasons a live one does. Only the step
 * RESULT payload is lossy (capped at `STEP_RESULT_CAP` in the stored copy).
 */
declare function traceWithPersistedSteps(messages: BrainMessage[], trace: BrainTraceEvent[]): BrainTraceEvent[];

/**
 * The deployed API version, read once per session from `/health`.
 *
 * A support capture with no build stamp is ambiguous in the worst way: a dump taken
 * minutes BEFORE a deploy is byte-identical to one taken after, so a fixed bug reads
 * as unfixed. Every surface therefore stamps `UI x · API y` onto its diagnostics.
 *
 * The surfaces REACH `/health` differently — the web app hits the api origin
 * unauthenticated, the VS Code webview goes through its configured gateway base — so
 * the caller supplies the read and this module owns the part that must not be
 * duplicated: a session cache plus in-flight coalescing, so the footer, the sidebar
 * and a diagnostics capture cost one request between them.
 */
/**
 * How long a resolved version stays good.
 *
 * IT USED TO BE FOREVER, and that reproduced the EXACT failure the header above says
 * this module exists to prevent. `cached` was set once per page load and never
 * invalidated, so a tab open across a deploy stamped every later capture with the build
 * it started on. Measured 2026-07-29: a diagnostics capture taken twelve hours after
 * `2026.7.181` shipped reported `apiVersion: 2026.7.180`, and the fixes in that build —
 * visibly present in the very decision payloads inside the same report — were read as
 * never deployed. A stamp that lies about which build produced the evidence is worse
 * than no stamp: it is the one field a reader cannot cross-check.
 *
 * A minute is long enough to keep the property the cache was added for (the footer, the
 * sidebar and a capture still cost ONE request between them) and short enough that no
 * capture can name a build that is no longer running.
 */
declare const API_VERSION_TTL_MS = 60000;
/**
 * How long the `/health` read may take before the caller stops waiting for it.
 *
 * UNREACHABLE and SLOW are different failures, and only the first one was ever handled.
 * A rejected read resolves null and a report honestly says the API version is unknown;
 * a read that never SETTLES (offline behind a live socket, a captive portal, a stalled
 * connection) left every awaiting caller hanging forever. That is precisely what turns
 * "Copy diagnostics" into a button that does nothing at all: the click is received, the
 * report is never built, and nothing is ever shown to say so.
 *
 * The stamp is the least important line in a diagnostics report and must never be able
 * to hold the rest of it hostage — so the wait is bounded HERE, in the one module both
 * surfaces already go through, rather than each host racing its own timer (the web app
 * had one, the VS Code webview did not, and only one of the two copy buttons worked).
 * An over-run is just a null.
 *
 * A caller that can cancel the underlying request should ALSO pass its own
 * `AbortSignal.timeout(API_VERSION_PROBE_TIMEOUT_MS)` — the race below guarantees the
 * bound, the signal is the courtesy that also frees the socket.
 */
declare const API_VERSION_PROBE_TIMEOUT_MS = 2500;
/** Drop the memoized version — for tests, and for a surface that knows it just
 *  reconnected to a different deployment. */
declare function resetApiVersionCache(): void;
/**
 * Resolve the API version through `read`, memoizing a success for
 * {@link API_VERSION_TTL_MS} and abandoning a read that outruns
 * {@link API_VERSION_PROBE_TIMEOUT_MS}. Resolves null when `/health` is unreachable OR
 * too slow — a diagnostics capture must never fail, and must never STALL, because a
 * version lookup did.
 *
 * `now` and `timeoutMs` are injectable so the expiry and the deadline are unit-testable
 * without a clock; pass `timeoutMs: 0` to wait indefinitely.
 */
declare function fetchApiVersionVia(read: () => Promise<{
    version?: string;
} | null>, now?: () => number, timeoutMs?: number): Promise<string | null>;

/**
 * Chat ⇄ work linking — the single source for (a) the system-prompt directive that
 * tells the Brain to turn work it identifies or code it changes into a ticket LINKED
 * to the current conversation, and (b) the tool-name predicates that back the
 * deterministic "a code change is always tied to a ticket" guarantee.
 *
 * Why it lives here: the shared agent loop ({@link ./brainRunStore}) drives BOTH the
 * web Brain and the VS Code webview Brain, and it is the one place that always knows
 * the RESOLVED chatId of the run. Injecting the directive there (with the real id)
 * gives the primary Brain loop the same behaviour the server-side `@agent` reply loop
 * already has (BrainService.agentReply bakes the chatId in), so:
 *   1. when the agent's investigation determines work must be done, it CREATES the
 *      work item and links it to this chat (lineage), instead of only describing it;
 *   2. when the agent changes code, that change becomes a ticket linked to this chat.
 *
 * The predicates are also consumed by the loop's post-run backstop: if a run changed
 * code (a workspace file tool succeeded) but never itself recorded a ticket, the loop
 * mints one via `builtin_tickets_from_delta` tied to the chat — so an IDE edit is
 * never left invisible or unlinked.
 *
 * WHICH TOOLS those are is NOT decided here: the local workspace toolset belongs to
 * `localWorkspaceTools.ts`, which the run loop also reads to keep those tools
 * advertised. One owner, so "what can change code" cannot mean two things.
 *
 * Kept framework-free (pure strings + Sets) so it is safe in every bundle.
 */
/**
 * Advertised (gateway `builtin_*`) names of the platform tools that RECORD work
 * against the chat. If the model calls any of these itself during a run, the turn
 * already tied its work to a ticket and the deterministic backstop stays quiet.
 */
declare const TICKET_RECORDING_TOOLS: ReadonlySet<string>;
/** A work item a create tool just produced, in the shape `builtin_chats_link_ticket`
 *  wants: which tier it is, its ref, and whether it was newly created vs. an
 *  idempotent hit on a pre-existing item (so the link records the honest lineage). */
interface CreatedWorkItemLink {
    kind: string;
    ref: string;
    linkType: 'created' | 'linked';
}
/**
 * Derive the chat-link descriptor for the result of a work-item CREATE tool, or null
 * when the tool is not a create (or the result carries no usable id). This is what
 * makes "an item the Brain creates is always tied to the conversation" DETERMINISTIC:
 * the run loop fires `builtin_chats_link_ticket` off this instead of hoping the model
 * remembers to. An idempotent-hit result (`{ deduped: true, … }`) links as 'linked'
 * (the item already existed) rather than 'created'.
 */
declare function workItemLinkFromCreate(toolName: string, result: unknown): CreatedWorkItemLink | null;
declare function isTicketRecordingTool(name: string): boolean;
/**
 * Task-tier statuses that mean "not started yet" — mirrors the board's not-started
 * lanes (TaskStatus BACKLOG | TODO | READY). A linked ticket in one of these that a
 * code-changing run actively worked is advanced to `in_progress` by the loop backstop,
 * so "you worked a ticket but never moved it off backlog" can't happen silently.
 * `blocked` / `in_progress` / `in_review` / `done` are deliberately excluded — the run
 * must not un-block, re-open, or regress a ticket that already moved past the backlog.
 */
declare const NOT_STARTED_TASK_STATUSES: ReadonlySet<string>;
/** A linked ticket the deterministic backstop should advance to in_progress. */
interface LinkedTicketToAdvance {
    kind: string;
    ref: string;
}
/**
 * From a `builtin_chats_list_tickets` result, the task-tier tickets still sitting in a
 * not-started lane — the ones a code-changing run left behind in backlog. The loop
 * advances each to `in_progress` via `builtin_tasks_update`, closing the gap that let
 * the agent "start work on a ticket without ever updating its status". Tolerant of the
 * tool result arriving as a JSON string, a parsed array, or an error object (returns
 * [] for anything unusable), and skips deleted/unresolved links.
 */
declare function linkedTicketsToAdvance(listResult: unknown): LinkedTicketToAdvance[];
/**
 * From a `builtin_chats_list_tickets` result, the task-tier tickets sitting in
 * `in_review` — the ones a run that MERGED its change to the base branch has finished.
 *
 * This closes the loop `tickets.from_delta` promises in its own tool description
 * ("completes automatically once merged and deployed") and never delivered: nothing
 * moved a delta ticket out of `in_review`, so each one sat at 50% on the board
 * permanently. Same tolerant parsing as {@link linkedTicketsToAdvance}.
 */
declare function linkedTicketsToComplete(listResult: unknown): LinkedTicketToAdvance[];
/** The workspace-relative path a code-change tool touched (for delta provenance),
 *  or null when the args carry no usable `path`. */
declare function codeChangeFile(args: unknown): string | null;
/**
 * The system-prompt block that binds a chat's work to the conversation. Encodes BOTH
 * operator requirements: investigation-identified work → create + link; and a code
 * change → from_delta tied to this chat. Uses the advertised `builtin_*` tool names
 * the model actually sees on the gateway MCP relay.
 */
declare function chatWorkLinkingDirective(chatId: number | null): string;

/**
 * The LOCAL WORKSPACE TOOLSET — the tools a surface has only because it is running
 * beside the user's files.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * The per-turn tool selector (`selectTools.ts`) trims a ~440-tool catalog to ~64 by
 * LEXICAL relevance against the turn's text, keeping (a) tools the system prompt
 * names and (b) tools this run has already called. Both of those are the right
 * instincts and both missed these tools:
 *
 *   - "tools the prompt names" is resolved by `toolNamesMentionedIn`, whose pattern
 *     matches only `builtin_*` / `mcp__*` identifiers. The IDE persona names
 *     `run_command`, `read_file`, `edit_file` and the rest in plain prose, so
 *     naming them pinned nothing at all.
 *   - "tools already called" cannot help a tool that has not been called YET.
 *
 * So on the turn where it mattered, `run_command` scored zero against "commit the
 * change and push to main" — no shared word stems — and was dropped from the 64.
 * The agent, whose own system prompt had just told it to "use run_command for git…
 * to commit, push, and open a PR", searched its tool list, could not find it, and
 * spent the rest of the run looking: 78 tool calls, 44 minutes, the same two files
 * read 14 and 13 times, and the commit never made. It reported, correctly, that the
 * tool it had been promised did not exist.
 *
 * These are not one domain among many that a query can be relevant to — they are
 * WHAT THIS SURFACE IS. Relevance must never decide whether the agent can touch the
 * workspace it is sitting in, so the run loop pins every one of them that the host
 * actually advertised. Nothing is pinned that the host did not offer: on the web
 * Brain this set matches no advertised tool and the selection is unchanged.
 *
 * Framework-free (plain Sets and predicates) so it is safe in every bundle.
 */
/**
 * Every local workspace tool, by the name the host advertises. The run loop pins the
 * intersection of this set with the run's own catalog — a host that adds a tool must
 * add it here to have it pinned, which is deliberate: this is a declaration of what
 * "working in the user's workspace" means, not a prefix match on whatever appears.
 */
declare const LOCAL_WORKSPACE_TOOLS: ReadonlySet<string>;
/**
 * Workspace tools whose success means the agent CHANGED code — the surface-specific
 * signal that a ticket must exist. Two surfaces have them: the VS Code (IDE) surface's
 * files on disk, and the Studio's project workspace (`canvas_*_build_file`, the build
 * vocabulary in `frontend/src/lib/canvasBuildTools.ts`). A chat with neither never trips
 * the ticket backstop. `run_command` is intentionally excluded: it usually runs tests /
 * build / lint, not a durable code change, so treating it as one would mint
 * spurious tickets.
 *
 * The Studio writers were missing until chat #129 measured the cost: the Studio changed
 * a site twice, nothing counted it as a code change, so no ticket was opened for it, the
 * change was never verified, and the two tickets the model filed by hand sat at
 * `in_review` (75%) with nothing in the loop that would ever move them.
 */
declare const CODE_CHANGE_TOOLS: ReadonlySet<string>;
/**
 * The tool that reviews a change in the RUNNING preview (`canvas_inspect_preview`,
 * declared as `CANVAS_INSPECT_PREVIEW_TOOL` in `@builderforce/creation-canvas-contract`;
 * a frontend test pins the two spellings together). Only the Studio advertises it, so
 * its presence is how the run loop knows it is in the Studio — see `previewReview.ts`.
 */
declare const PREVIEW_REVIEW_TOOL = "canvas_inspect_preview";
/**
 * The Studio's workspace vocabulary: what that surface IS, pinned for the reason
 * {@link LOCAL_WORKSPACE_TOOLS} is. Measured (chat #129): with these left to relevance,
 * the agent spent calls on `builtin_tools_find` to rediscover `canvas_search_build_files`
 * and `builtin_tools_describe` to learn `canvas_read_build_file`'s arguments. Pinned only
 * where the review tool is advertised (see {@link studioToolsIn}), so the creation canvas,
 * which shares the `canvas_*` build tools, keeps its own relevance-driven selection.
 */
declare const STUDIO_WORKSPACE_TOOLS: ReadonlySet<string>;
/**
 * Local tools that can change ARBITRARY files — a shell command may run a codemod, a
 * formatter, `git checkout`, or nothing at all, and the call site cannot tell which.
 * The three git tools that REWRITE the working tree belong here for the same reason: a
 * merge of the base branch, an undo or a redo can change any file in the checkout, and
 * name none of them. Consumers that invalidate per-target state (see `readCoverage`)
 * must treat these as invalidating everything, because the honest answer to "what did
 * that touch?" is "unknown". `git_commit` / `git_push` / `open_pull_request` are NOT
 * here: they move work out of the tree without changing a byte a read would see.
 */
declare const UNSCOPED_MUTATION_TOOLS: ReadonlySet<string>;
/**
 * Does this local tool change repository state that a PLATFORM read observes (branches
 * ahead of base, open pull requests)? See {@link REPO_PUBLISH_TOOLS}.
 */
declare function isRepoPublishTool(name: string): boolean;
declare function isLocalWorkspaceTool(name: string): boolean;
declare function isCodeChangeTool(name: string): boolean;
declare function isUnscopedMutationTool(name: string): boolean;
/**
 * Whether THIS run can change code itself — i.e. the host advertised the local
 * workspace writers. The IDE surface does; the web Brain does not.
 *
 * Read by the WORK-mode directive, so "do it yourself rather than dispatching a cloud
 * agent for it" is stated only where it is true, and by nothing else — the post-run
 * ticket backstop reads the same set through {@link isCodeChangeTool}, so the two
 * can never disagree about what "this session can change code" means.
 */
declare function canChangeCodeHere(toolNames: readonly string[]): boolean;
/**
 * Whether THIS run can PUBLISH its own change — commit AND push. The VS Code host
 * advertises both; the web Brain advertises neither. Read by the self-review ship
 * contract (`selfReviewShip.ts`): only a session that can land its change is told it is
 * that change's reviewer, and only such a session is re-prompted for leaving it unshipped.
 */
declare function canShipHere(toolNames: readonly string[]): boolean;
/**
 * The local workspace tools this run actually has, out of a catalog. Handed to the
 * per-turn selector as always-advertised, so the surface's own capability is never a
 * casualty of relevance trimming.
 */
declare function localToolsIn(toolNames: readonly string[]): string[];
/**
 * Whether THIS run can review its own change in a live preview — the host advertised
 * {@link PREVIEW_REVIEW_TOOL}. The Studio does; the VS Code host and the web Brain do not.
 */
declare function canReviewInPreview(toolNames: readonly string[]): boolean;
/** The Studio workspace tools this run has — always advertised, and only in the Studio. */
declare function studioToolsIn(toolNames: readonly string[]): string[];

/**
 * SELF-REVIEW SHIP — in a local editor session the agent is the reviewer of its own
 * change, so it reviews, commits, pushes, and the ticket closes.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * `tickets.from_delta` opens every editor change's ticket in `in_review` (75% on the
 * board): "the code exists but has not landed". Something then has to review it and
 * land it. On the web and in the cloud that is a pull request, a reviewer agent, a merge
 * webhook. In the VS Code extension it is NOBODY: the run is local, it holds the only
 * copy of the change, and no other agent can reach the user's working tree. The persona
 * nevertheless told the agent the "default route is review" (ticket branch + pull
 * request) and to push the base branch only when the human explicitly asked — so the
 * agent edited, recorded the delta, stopped, and the ticket sat at 75% indefinitely
 * (measured, chat #103: two "Code change … from Brain chat" tickets parked in review,
 * the edits uncommitted on disk).
 *
 * The fix is to say what is true on this surface: the agent IS the reviewer. It
 * verifies, reviews its own diff, records that review on the ticket, then commits and
 * pushes the base branch — each publish call still surfaces the host's approval prompt,
 * which is the human's review of the agent's review. The verified push is what the
 * existing `shippedToBaseBranch` → `completeShippedTickets` backstop needs to move the
 * ticket to done.
 *
 * Two halves, one module, so they cannot disagree:
 *   - {@link selfReviewShipDirective} — the system-prompt contract.
 *   - {@link leftChangeUnshipped} + {@link unshippedChangeNudge} — the loop gate that
 *     re-prompts a turn that changed code and ended without even TRYING to ship it.
 *     (Enforcement lives in the loop, not only in advice: a directive a model can skim
 *     past is exactly how the 75% tickets happened.)
 *
 * Gated on {@link canShipHere} — the host advertised the git publish tools — so the web
 * Brain (no working tree, no git) never sees any of it.
 *
 * Framework-free (strings, Sets, predicates) so it is safe in every bundle.
 */

/**
 * The directive. Uses the names the model actually sees: plain names for the local git
 * tools, `builtin_*` for the platform ones (which also pins those into the advertised
 * set — the loop pins every `builtin_*` name the system prompt mentions).
 */
declare function selfReviewShipDirective(chatId: number | null): string;
/**
 * Did this run TRY to publish its work?
 *
 * Success is deliberately not required. A commit the human declined at the approval
 * prompt, or a push the remote rejected, is a result the model has to REPORT — and
 * re-prompting it to ship would re-ask a person who already said no.
 */
declare function attemptedPublish(events: readonly BrainTraceEvent[]): boolean;
declare function declinesShipping(text: string | null | undefined): boolean;
/** What the loop knows when a turn ends without tool calls. */
interface UnshippedChangeInput {
    /** A workspace code-change tool succeeded in THIS run. */
    codeChanged: boolean;
    /** Names of the tools this run's host advertised. */
    toolNames: readonly string[];
    /** The user's own request for this run — never a nudge the loop injected. */
    requestText: string | null | undefined;
    /** THIS run's trace events (not an earlier run's — see `brainRunStore.runTrace`). */
    events: readonly BrainTraceEvent[];
}
/**
 * Is this turn ending with a code change the agent never attempted to ship?
 *
 * Every condition must hold, so the gate stays quiet whenever stopping is right:
 *  - the run changed code (nothing to ship otherwise);
 *  - this host can commit AND push (the web Brain cannot);
 *  - the user asked for a change (a question answered with a scratch edit is not a
 *    work order to publish) and did not say to hold off;
 *  - nothing in the run tried to commit, push or open a pull request.
 */
declare function leftChangeUnshipped(input: UnshippedChangeInput): boolean;
/**
 * The re-prompt. Concedes the edit is made and names what is left, rather than the
 * generic "you made zero tool calls" — a model that did plenty of work reads that as
 * wrong and argues instead of acting.
 */
declare function unshippedChangeNudge(): string;

/**
 * PREVIEW REVIEW — in the Studio the agent is the reviewer of its own change, and the
 * live preview is where it proves it.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * The Studio runs the app it is building in a preview in the user's browser. Measured on
 * chat #129 ("Build a marketing website for he-man"): the agent fixed a pill stretching
 * to full card height and rebuilt the mobile layout, filed a ticket for each, and stopped.
 * Both tickets opened in `in_review` (75%) and stayed there. The agent had no way to see
 * whether either fix worked — `canvas_read_build_diagnostics` said "no errors", and a
 * layout bug is not an error — so it tried to dispatch the invited QA agent to review it
 * (refused: execution switched off), and nothing else in the platform could ever move
 * those tickets: no other agent can reach a preview running in someone's browser.
 *
 * This is the Studio's twin of `selfReviewShip.ts` (the VS Code host's contract), with
 * the preview standing in for the push: the agent VERIFIES in the running app with
 * `canvas_inspect_preview`, RECORDS a review that quotes the measurements, and the run
 * CLOSES the reviewed tickets.
 *
 * Three parts, one module, so they cannot disagree about what "reviewed" means:
 *   - {@link previewReviewDirective} — the system-prompt contract.
 *   - {@link leftChangeUnreviewed} + {@link unreviewedChangeNudge} — the loop gate that
 *     re-prompts, once, a turn that changed the app and ended without a review.
 *   - {@link ticketsReviewedInPreview} — the evidence the post-run backstop closes
 *     tickets on: a passing inspection after the LAST change, then a "complete" review.
 *
 * Gated on {@link canReviewInPreview} — only the Studio advertises the inspect tool.
 * Framework-free (strings, Sets, predicates) so it is safe in every bundle.
 */

/**
 * The directive. Uses the names the model sees: `canvas_*` for the Studio's own tools,
 * `builtin_*` for the platform ones (which also pins those into the advertised set).
 */
declare function previewReviewDirective(chatId: number | null): string;
/**
 * The tickets this run REVIEWED in the preview: each one a successful "complete"
 * `builtin_reviews_record` made after a passing `canvas_inspect_preview` that itself
 * came after the run's last app change. Ordering is the whole point — an inspection of
 * the app BEFORE the last edit reviewed a different app, and a review recorded before
 * the passing inspection was not based on it.
 *
 * Empty when the run changed nothing (there is no change to have reviewed) — a turn
 * that only inspects and reviews is a review, not a delivery, and closes nothing here.
 */
declare function ticketsReviewedInPreview(events: readonly BrainTraceEvent[]): number[];
declare function declinesReview(text: string | null | undefined): boolean;
/** What the loop knows when a turn ends without tool calls. */
interface UnreviewedChangeInput {
    /** A workspace code-change tool succeeded in THIS run. */
    codeChanged: boolean;
    /** Names of the tools this run's host advertised. */
    toolNames: readonly string[];
    /** The user's own request for this run — never a nudge the loop injected. */
    requestText: string | null | undefined;
    /** THIS run's trace events (not an earlier run's — see `brainRunStore.runTrace`). */
    events: readonly BrainTraceEvent[];
}
/**
 * Is this turn ending with an app change the agent never reviewed?
 *
 * Every condition must hold, so the gate stays quiet whenever stopping is right:
 *  - the run changed the app, and this host can inspect its preview (the Studio);
 *  - the user did not say to hold off reviewing. Unlike the ship gate this does NOT
 *    ask whether the request was phrased as a change: chat #129's requests were defect
 *    reports ("its height is wrong", "needs to be improved") that read as statements,
 *    and reviewing is harmless where publishing is not — a change the run MADE is the
 *    reason to verify it, whatever words prompted it;
 *  - after the last change the run neither inspected the preview NOR recorded a review.
 *    An inspection that failed and was reported, or a "gaps" verdict, is a result to
 *    relay, not to re-prompt — the nudge would only re-ask a question already answered.
 */
declare function leftChangeUnreviewed(input: UnreviewedChangeInput): boolean;
/**
 * The re-prompt. Concedes the change is made and names what is left, rather than a
 * generic "keep going" a model that did plenty of work reads as wrong and argues with.
 */
declare function unreviewedChangeNudge(): string;

/** Persist a landing-page prompt for replay after authentication. No-ops on empty input or SSR. */
declare function savePendingPrompt(text: string): void;
/** Read and clear the saved prompt. Returns null when none is stored or on SSR. */
declare function takePendingPrompt(): string | null;

/**
 * The tenant's assignable agent pool — ONE roster built from three source lists:
 * the tenant's own cloud (workforce) agents, agents acquired from the marketplace,
 * and registered remote agents. An agent is registered once to the tenant and can
 * be assigned to any surface (project, swimlane, brain…), so the pool is never
 * project-filtered here.
 *
 * Pure mapping plus a transport-agnostic loader: the web app fetches through its own
 * API client and the VS Code webview through its authed fetch, but both build the
 * SAME pool from the SAME rows — which is what keeps a persona picker or a recipient
 * chip naming an agent identically on both surfaces.
 */
/** A selectable agent from one of the tenant's two source pools. */
interface PoolAgent {
    kind: 'workforce' | 'registered';
    ref: string;
    name: string;
    meta: string;
    /** Gateway-resolvable model for this agent (workforce base_model), or null when
     *  it should use the default (the 'builderforce-default' sentinel / registered). */
    baseModel?: string | null;
}
/** The fields of a workforce (cloud) agent row the pool reads. */
interface PoolWorkforceAgentRow {
    id: number | string;
    name: string;
    title?: string | null;
    base_model?: string | null;
}
/** The fields of a registered remote agent row the pool reads. */
interface PoolRegisteredAgentRow {
    id: number | string;
    name: string;
    type: string;
    isActive: boolean;
}
/** base_model sentinel meaning "no explicit model — use the default". */
declare const DEFAULT_AGENT_MODEL_SENTINEL = "builderforce-default";
/** The three endpoints the pool is built from. */
declare const AGENT_POOL_PATHS: {
    readonly owned: "/api/workforce/agents/mine";
    readonly purchased: "/api/workforce/agents/purchased";
    readonly registered: "/api/agents";
};
/** Build the pool from its three source lists (owned + purchased deduped by id). */
declare function poolAgentsFrom(input: {
    owned: readonly PoolWorkforceAgentRow[];
    purchased: readonly PoolWorkforceAgentRow[];
    registered: readonly PoolRegisteredAgentRow[];
}): PoolAgent[];
/** A host's authenticated JSON GET. */
type PoolRequest = <T>(path: string) => Promise<T>;
/** Load the pool through a host's transport. Each source degrades to empty on its own. */
declare function loadAgentPoolVia(request: PoolRequest): Promise<PoolAgent[]>;

/**
 * Brain personas — WHO the Brain answers as in a conversation.
 *
 * A composer's "Acting as" control offers three kinds of persona: the host's
 * default Brain, a built-in MODALITY persona (the Website builder, the mobile
 * coder, the Evermind teacher…), or an AGENT assigned to the Brain (scope='brain'
 * in the agent-assignment model). This module is the one definition of all three,
 * shared by the web app and the VS Code webview: the modality prompts live here
 * (the frontend's modality registry reads them from here too), and so do the choice
 * encoding, the agent join, and the two ways a host applies a persona.
 *
 * The two applications differ for a real reason. The web Brain has no environment
 * of its own to describe, so a persona REPLACES its system prompt
 * ({@link personaSystemPrompt}). The editor's base prompt describes the actual
 * workspace, file tools and repository — a Builder persona that talks about a live
 * browser Preview must not overwrite that — so the editor LAYERS the persona on top
 * ({@link personaOverlay}).
 */

/** The project modalities that carry a Brain persona. */
type PersonaModalityId = 'designer' | 'mobile' | 'webmobile' | 'evermind' | 'finetune' | 'voice';
/** Display order of the modality personas. */
declare const PERSONA_MODALITY_IDS: readonly PersonaModalityId[];
/** A modality persona: its English name, its glyph and the Brain prompt it runs under. */
interface ModalityPersona {
    /** The English display name — THE default every host localizes over (web `modality.<id>.label`,
     *  the editor's `app.persona.modality.<id>`); no host keeps a copy of its own. */
    label: string;
    icon: string;
    prompt: string;
}
/**
 * How a BUILDER persona delivers code: by writing it, never by handing it over.
 *
 * These personas used to say the opposite. The Website persona told the model to
 * "use a normal code block so the user can apply it" for the open file and to
 * fall back to path-tagged code blocks; the mobile personas offered code blocks
 * as the ONLY way to deliver a file. On 2026-10-03 a Studio build whose writes
 * were being cut off by the output ceiling ended exactly as those lines allowed:
 * the agent printed the CSS and asked the user to add it by hand, beside a live
 * Preview that only ever shows what was written.
 *
 * It names no tool on purpose (the prompt tool-name contract): this text is shared
 * by the web Builder, Studio and the editor, which advertise different file
 * tools, and a hand-typed name is right only until the next rename. The model
 * reads the real names off its own tool list.
 *
 * Exported because the build CAPABILITIES (`frontend/src/lib/brain/capabilities.ts`)
 * carry the same rule — one sentence of policy, one place it is written.
 */
declare const FILE_DELIVERY_RULE: string;
/** Every modality persona, its prompt carrying the shared strategy/OKR note. */
declare const MODALITY_PERSONAS: Readonly<Record<PersonaModalityId, ModalityPersona>>;
/** An agent assigned to the Brain, named and model-resolved from the tenant pool. */
interface BrainPersonaAgent {
    kind: string;
    ref: string;
    name: string;
    /** The agent's own model, or null for the default. */
    baseModel?: string | null;
}
/**
 * A persona choice, encoded as one stable string so a host can hold it in a single
 * piece of state: `'default'`, `'modality:<id>'`, or `'agent:<kind>:<ref>'`.
 */
type BrainPersonaChoice = string;
declare const DEFAULT_PERSONA: BrainPersonaChoice;
declare function modalityPersonaChoice(id: string): BrainPersonaChoice;
declare function agentPersonaChoice(agent: {
    kind: string;
    ref: string;
}): BrainPersonaChoice;
/** The modality a choice names, or null (unknown ids included). */
declare function personaModalityOf(choice: BrainPersonaChoice): PersonaModalityId | null;
/** The assigned agent a choice names, or null when it names none of `agents`. */
declare function personaAgentOf(choice: BrainPersonaChoice, agents: readonly BrainPersonaAgent[]): BrainPersonaAgent | null;
/** The framing that makes the Brain answer AS an assigned agent. */
declare function agentPersonaPrompt(name: string): string;
/**
 * The persona as a REPLACEMENT system prompt — for a host whose persona is the whole
 * prompt (the web Brain). `undefined` for the default persona (or a choice naming
 * nothing), so the host's own default applies.
 */
declare function personaSystemPrompt(choice: BrainPersonaChoice, agents: readonly BrainPersonaAgent[]): string | undefined;
/**
 * The persona as an ADDITIVE directive — for a host that keeps its own base prompt
 * because that prompt describes the environment the run really executes in (the
 * editor's workspace, file tools and repository). `undefined` for the default persona.
 */
declare function personaOverlay(choice: BrainPersonaChoice, agents: readonly BrainPersonaAgent[]): string | undefined;
/**
 * The model an agent persona runs on — the agent's own `base_model` — or undefined
 * (default persona, modality persona, or an agent on the default model). A host
 * feeds it as a NON-strict preference: an explicit user pin still wins.
 */
declare function personaModel(choice: BrainPersonaChoice, agents: readonly BrainPersonaAgent[]): string | undefined;
/** Join the Brain's agent assignments to the tenant pool — one entry per agent. */
declare function brainPersonaAgents(assignments: ReadonlyArray<{
    agentKind: string;
    agentRef: string;
}>, pool: readonly PoolAgent[]): BrainPersonaAgent[];
/** The Brain's agent assignments (scope='brain'). */
declare const BRAIN_AGENT_ASSIGNMENTS_PATH = "/api/agent-assignments?scope=brain";
/** Load the Brain's assigned agents through a host's transport. Degrades to []. */
declare function loadBrainPersonaAgentsVia(request: PoolRequest): Promise<BrainPersonaAgent[]>;

/** The metadata key that marks a persisted assistant message as stopped mid-stream. */
declare const STOPPED_TURN_META_KEY = "stoppedByUser";
/** The trace/step label a user Stop records — `args.model` names the model it cut off. */
declare const STOPPED_TURN_STEP = "agent.stopped";
/** Which model (and whose account) was streaming when Stop was pressed, when known. */
interface StoppedTurnSource {
    model?: string;
    account?: string;
}
/** Metadata for a stopped turn: the marker, plus provenance whenever the model was known. */
declare function stoppedTurnMetadata(source: StoppedTurnSource): string;
/** Whether a persisted message is a reply the user stopped mid-stream (or before it began). */
declare function isStoppedTurn(msg: {
    metadata?: string | null;
}): boolean;
/** Whether a stopped turn is the marker of a run stopped before it started — not a reply. */
declare function isStoppedBeforeStart(msg: {
    metadata?: string | null;
}): boolean;
/**
 * The row a run stopped BEFORE it started leaves behind: the person's turn is saved, the
 * Stop came while the run was still getting ready, and without an answer after it a
 * reopened chat (the auto-reply on load, Retry) would start that work after all. It is no
 * model's reply: the transcript shows its localized caption (`stoppedBeforeStart`) in place
 * of the body, which is only the stored record (a message's content is never empty).
 */
declare function stoppedBeforeStartRow(): {
    role: 'assistant';
    content: string;
    metadata: string;
};

/**
 * Which model ACTUALLY answered — per conversation — and how a tool call gets told.
 *
 * The gateway auto-selects per turn (a connected BYO account, the learned reorder, or a
 * cascade failover can all change which model answers), and it reports the winner on the
 * `x-builderforce-model` response header, which `streamChatCompletion` surfaces as
 * `StreamChatResult.resolvedModel`. An MCP call is a SEPARATE request, so the server
 * cannot see which model served this chat — only the client can. Without this the
 * `session.current_model` tool falls back to the plan default and the assistant answers
 * "probably X" about itself.
 *
 * ## Why this is keyed by chat
 *
 * It used to be one module-level string, justified by "both hosts are single-user
 * processes and the tool call lands immediately after the turn that set it". That stopped
 * being true when the VS Code extension moved the agent loop into the extension host so
 * runs survive their tab: several chats now execute AT ONCE, and a single slot means chat
 * A's `session.current_model` can be answered with the model that served chat B — a wrong
 * answer produced with total confidence, about the one subject the tool exists to be
 * authoritative on. Interleaving is not a corner case here; it is the normal shape of two
 * runs sharing a process.
 *
 * ## Why the SHAPER lives here too
 *
 * The web Brain used to fold the observed model into the tool's arguments inside its MCP
 * relay (`mcpCatalog.ts`), which meant the editor — whose platform tools go through their
 * own relay in `clients/vscode/src/platformTools.ts` — never got it at all. Answering that
 * by adding a second copy to the second relay would be two implementations of one rule,
 * and would put the rule in the layer that has no idea which chat is asking. So the rule
 * lives here, beside the value it reads, and is applied ONCE by the run loop — which is
 * the only layer that knows both the chat and the call. Every surface that runs the shared
 * loop gets it, with no relay needing to know this tool exists.
 */
/** Record the model a completion resolved to, for the chat it served. Ignores empty
 *  values so a turn that reported no model leaves the previous (still-accurate) answer
 *  intact. */
declare function setLastResolvedModel(chatId: number, model: string | undefined | null): void;
/** The model this chat's last completion resolved to, or undefined before any turn. */
declare function getLastResolvedModel(chatId: number): string | undefined;
/** Forget a chat — a run store reset must not leave a stale model behind it. */
declare function forgetResolvedModels(): void;
/**
 * Supply the model THIS chat's last turn resolved to as the `model` argument of
 * `session.current_model`. Every other call passes through untouched, and a model that
 * explicitly asked about a specific id keeps its own argument — the tool is then being
 * used to look something up, not to introspect.
 */
declare function withObservedModel(chatId: number, tool: string, args: unknown): unknown;

/**
 * Context used only to choose tools for a turn.
 *
 * A correction such as "actually, make those weekly" contains almost no domain
 * nouns. Scoring tools against that sentence alone drops the scheduler/project
 * tools selected for the preceding request. Keep a small, bounded tail of user
 * intent so follow-ups inherit the task they refine without resending a whole chat.
 */
declare function routingQueryForTurn(messages: readonly ChatCompletionMessage[]): string;
/**
 * Small, stable model-facing contract that makes context-efficiency a platform
 * responsibility instead of a collection of user prompting rituals.
 */
declare function turnOptimizationDirective(): string;

/**
 * What counts as something the MODEL said to the user, out of a persisted transcript.
 *
 * An assistant-role row is not always a reply: a run step (`role:'tool'`), a server
 * activity line, and a consolidation marker (a "Consolidate" summary, or a run's
 * auto-compaction note persisted mid-run) all sit in the same list. Every reader that
 * asks "what did the model answer last" — retry, the newest-reply actions, triage claim
 * detectors, a child's result — uses this one predicate, so none of them mistakes a note
 * for an answer.
 */
declare function isModelReply(m: {
    role: string;
    metadata?: string | null;
}): boolean;

/**
 * chatDiagnostics — a pure serializer for the "Copy diagnostics" action.
 *
 * The plain transcript (turns + tool I/O) answers "what did the model say?"; this
 * answers "what STATE was this chat in?" — the identity + wiring facts you otherwise
 * have to guess at from screenshots: the chat's own project, the tenant, the project
 * Evermind head (version / mode / learned / queued / last-learned), the learn-gate
 * outcome for the last turn, the agents invited into the chat, and the linked tickets.
 *
 * It is the fix for a whole class of "even after N fixes I can't tell what's wrong"
 * loops: the #1 real cause of "Learning · Connected yet nothing learns" is that the
 * CHAT is bound to a different project (or none) than the panel shows — a fact invisible
 * in the UI but dumped plainly here, with a Signals section that names the likely cause.
 *
 * Pure + host-agnostic (no fetch, no DOM): every surface gathers the data its own way
 * and calls this ONE renderer, so the copied report is identical on web and in VS Code.
 */
/**
 * One execution started against a ticket this chat links. Mirrors the API's
 * `ChatRunRecord` (`application/brain/chatRunHistory.ts`) — kept structural here so the
 * serializer stays pure and host-agnostic, exactly like every other field it renders.
 */
interface ChatDiagnosticsRun {
    executionId: number;
    taskId: number;
    taskTitle?: string | null;
    agentRef?: string | null;
    agentName?: string | null;
    status: string;
    /** `user:<id>` | `system:lane-auto` | `system:coordinator` | … — WHICH pathway started it. */
    submittedBy: string;
    source?: string;
    /** WHERE it executed: 'durable' (the one cloud runtime) | 'github_actions'. */
    executor?: string | null;
    /**
     * What served its shell and working tree: 'container' | 'actions' | 'none'. Reported
     * because it decides what the run was CAPABLE of — a run with no sandbox edited over
     * the git API and could not compile what it wrote — and from inside the transcript the
     * two are indistinguishable.
     */
    sandbox?: string | null;
    /** The on-prem machine this run was delivered to, when it was one. */
    hostId?: number | null;
    hostName?: string | null;
    /** Did the finished run leave a commit / PR / merge / lane move behind? Null = not judged. */
    produced?: boolean | null;
    errorMessage?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    createdAt: string;
}
/** The chat's execution history, as gathered. */
interface ChatDiagnosticsRuns {
    /** How many runnable tickets this chat links — the denominator for "nothing ran". */
    linkedRunnableTickets: number;
    runs: ChatDiagnosticsRun[];
    /** Distinct `submittedBy` labels across those runs. */
    dispatchers: string[];
    /** Distinct executors across those runs ('container' | 'durable' | 'on-prem' | …). */
    executors?: string[];
}
/** The project Evermind head/activity snapshot, as the panel reads it. */
interface ChatDiagnosticsEvermind {
    version: number;
    mode: string;
    inferenceEnabled?: boolean;
    teacherModel?: string | null;
    /** Merged contributions to date — the panel's "Learned". */
    contributions?: number;
    /** Queued-but-not-yet-merged contributions — the panel's "Queued". */
    pending?: number;
    /** ISO timestamp of the last merge, or null if never — the panel's "Last learned". */
    lastLearnedAt?: string | null;
}
/** One metered resource, mirroring the `/api/consumption` meter snapshot shape. */
interface ChatDiagnosticsMeter {
    /** 'ai_tokens' | 'ingestion' | 'error_events' | 'outbound_fetches' | 'cloud_runs' */
    key: string;
    /** 'tokens' | 'bytes' | 'events' | 'fetches' | 'runs' */
    unit: string;
    used: number;
    /** Monthly allowance; -1 = unlimited. */
    limit: number;
    unlimited: boolean;
    /** Remaining this month; -1 when unlimited. */
    remaining: number;
    /** 0–100; 0 when unlimited. */
    percentUsed: number;
}
/**
 * WHO the user is to the platform and WHAT they are allowed to spend — the half of
 * "why is this chat behaving like that?" that identity + Evermind state can't answer.
 *
 * The motivating case is a brand-new signup: free plan, no card, a small token
 * allowance and no premium/frontier entitlement. From the outside that looks
 * indistinguishable from a broken install ("it picked a weak model", "it stopped
 * answering") — so the report states the plan, the billing status, the month-to-date
 * meters, and the model entitlement explicitly, and the Signals section names the
 * consequence rather than leaving the reader to infer it.
 */
interface ChatDiagnosticsAccount {
    /** Effective plan key ('free' | 'pro' | …) as the API resolves it. */
    plan?: string | null;
    /** Billing status ('none' = no payment method on file, 'trialing', 'active', …). */
    billingStatus?: string | null;
    /** Current metering period — when the allowances reset. */
    periodStart?: string | null;
    resetsAt?: string | null;
    /** Month-to-date usage vs allowance for every metered resource. */
    meters?: ChatDiagnosticsMeter[];
    /** The model in force for this chat (absent ⇒ the gateway routes per turn). */
    model?: string | null;
    /** Which purse funds `model`: 'byo:<vendor>' | 'plan' | 'premium' | 'auto'. */
    modelFunding?: string | null;
    /** Whether the plan entitles the tenant to premium/frontier models. */
    canUsePremiumModels?: boolean;
    /** How many models the plan pool currently offers. */
    planModelCount?: number;
    /** Connected bring-your-own provider keys (empty ⇒ every turn is plan-funded). */
    byoProviders?: string[];
    /** Client build + gateway it is talking to, so a report pins the exact surface. */
    extensionVersion?: string | null;
    baseUrl?: string | null;
}
/**
 * WHICH purse funds a model, as a machine key: `auto` (no pin — the gateway routes per
 * turn), `evermind` (the project's own learned head), `byo:<vendor>` (the tenant's own
 * connected account), `plan` (in the plan pool, included), or `premium` (metered at
 * cost + per-request fee).
 *
 * ONE decision, two consumers: the chat header renders a localized sentence from it and
 * the diagnostics report records it. Kept here (not in a UI file) so the sentence a user
 * READS and the key a support report SHOWS can never disagree.
 */
declare function classifyModelFunding(model: string | null | undefined, surface: {
    data?: Array<{
        id?: string;
    }>;
    byo?: {
        models?: Array<{
            id?: string;
            vendor?: string;
        }>;
    };
} | null | undefined): string;
/** Everything the diagnostics block needs — already gathered by the host (pure in). */
/**
 * How big the conversation is and WHERE its full dialogue lives. A copied report is
 * trimmed (results capped, long chats summarized), so a reader needs the count to know
 * what they are not seeing and the location to go and read it.
 */
interface ChatDiagnosticsHistory {
    /** Every message the surface holds for this chat, step rows included. */
    messages: number;
    /** Of those, the run's persisted tool/LLM/memory step rows. */
    steps: number;
    /** Where the full dialogue is stored — a local file on the VSIX, the chat URL on the web.
     *  Null when the surface did not say. */
    location: string | null;
}
interface ChatDiagnosticsData {
    surface?: string;
    chatId?: number | null;
    chatTitle?: string | null;
    /** Message/step counts and where the full history lives. */
    history?: ChatDiagnosticsHistory | null;
    /** 'shared' | 'locked' — who can see the chat. */
    chatVisibility?: string | null;
    /**
     * The chat's MODE — 'chat' (answer the question) or 'work' (file it, staff it, run it).
     *
     * Reported because it decides what the run was OBLIGED to do, and therefore what counts
     * as a failure: "it made a plan and stopped" is the correct behaviour in chat mode and a
     * broken run in work mode. A report that omits it makes those two indistinguishable.
     */
    mode?: string | null;
    /** The chat's OWN project (what the learn gate keys on), or null when unattached. */
    projectId?: number | null;
    projectName?: string | null;
    /**
     * The project the surrounding UI/panel currently has SELECTED — `null` when nothing is
     * selected. Always reported (never conditionally omitted): "no project is selected" and
     * "a project IS selected but the chat never adopted it" have opposite causes and
     * opposite fixes, and a report that prints only the chat's project renders them
     * identically as `Chat's project: none`. Reading that ambiguity the wrong way once cost
     * a wrong revert.
     */
    selectedProjectId?: number | null;
    /** Display name for {@link selectedProjectId}, when the host holds one. */
    selectedProjectName?: string | null;
    tenantId?: number | string | null;
    userId?: string | null;
    /** The project Evermind head for the CHAT's project (not the selected one). */
    evermind?: ChatDiagnosticsEvermind | null;
    /** The server learn-gate outcome for the most recent assistant turn, if known. */
    lastLearn?: {
        learned: boolean;
        version: number;
        reason?: string | null;
    } | null;
    /**
     * The agents invited into this chat.
     *
     * `name` is optional only because a client can be talking to an API that predates it;
     * where it is present it is what gets printed. It used to be absent entirely, and the
     * report rendered the raw `agentRef` — so a chat staffed with Bob, John and the
     * Manager copied out as three uuids, and the one question the line exists to answer
     * ("who is on this?") could not be answered from the report at all.
     */
    agents?: Array<{
        agentRef: string;
        role: string;
        name?: string;
        builtinKind?: string | null;
    }>;
    /**
     * What has actually RUN for this chat — the pathway half of the report.
     *
     * Invited agents and linked tickets describe INTENT; this describes EXECUTION, and
     * the gap between them is the single most common thing a reader is trying to see. A
     * chat with agents, tickets and no runs has a staffing failure; the same chat with
     * runs that all failed has a runtime one; the same chat with runs started by
     * `system:lane-auto` was never driven from the conversation. None of those were
     * distinguishable before this section existed.
     *
     * Absent means NOT GATHERED (an older surface, a failed read) and is reported as such
     * — never as "nothing ran", which is a different and much stronger claim.
     */
    runs?: ChatDiagnosticsRuns | null;
    tickets?: Array<{
        kind: string;
        ref: string;
        label?: string;
        linkType?: string;
        status?: string;
    }>;
    /** Plan, quota and model entitlement for the signed-in tenant (see the interface). */
    account?: ChatDiagnosticsAccount | null;
    /**
     * This chat's own dollar cost (`BrainChat.spend`). Plan meters above are quota
     * counters and stay at 0 on an unlimited plan even when the chat spent money.
     */
    spend?: SpendSavingsSummary | null;
    /**
     * How many tools the model could actually call, and why not more. Without this
     * a tool-less Brain ("I don't have that data", zero tool calls) is
     * indistinguishable from a model that simply chose not to call anything — the
     * exact ambiguity that made a silent MCP-catalog failure impossible to diagnose.
     *
     * `advertisedMin`/`advertisedLastTurn` are the OBSERVED per-turn numbers, read off
     * the run's trace (`toolExposureInTrace`). They exist because this line used to
     * render the per-turn CEILING (`up to 64 advertised`) while the Diagnostics block
     * directly below it rendered the real measured range off the same run — two lines
     * in one report answering the same question differently, and the ceiling was the
     * one that was always wrong for the turn that actually failed.
     */
    tools?: {
        count: number;
        error?: string | null;
        loading?: boolean;
        /** Fewest tools advertised on any measured turn; null when no turn was measured. */
        advertisedMin?: number | null;
        /** Tools advertised on the LAST measured turn; null when no turn was measured. */
        advertisedLastTurn?: number | null;
    } | null;
    /**
     * Which BUILD produced this capture. Without it a dump taken minutes before a
     * deploy is indistinguishable from one taken after, so a fixed bug reads as
     * unfixed — which is exactly what happened while debugging chat #71.
     */
    versions?: {
        ui?: string | null;
        api?: string | null;
        /**
         * Short SOURCE HASH of the client build.
         *
         * A version names a RELEASE, not an ARTIFACT: a client can be rebuilt and
         * redistributed under the same version with different code, at which point `ui`
         * alone makes a fixed bug read as unfixed. On 2026-07-25 exactly that happened —
         * two `2026.7.104` VSIXes, one with an agent-stall recovery fix and one without,
         * and the report said `UI 2026.7.104` for both. This is the field that separates
         * them; `"dev"` means the surface was not running a packaged artifact at all.
         */
        uiBuildId?: string | null;
        /** When the client artifact was built, so two builds of the same source are orderable. */
        uiBuiltAt?: string | null;
        /** The WEBVIEW bundle's own source hash, where the surface has one. See below. */
        webviewBuildId?: string | null;
        webviewBuiltAt?: string | null;
        /** One line on whether this machine can run POSIX shell scripts — the fact that
         *  decides whether the `git_sync_latest` / `git_undo` / `git_redo` tools work at
         *  all, and which used to surface only as a raw `cmd.exe` error inside one tool
         *  result that named neither the cause nor anything to check. */
        posixShell?: string | null;
    } | null;
}
/** How close a metered allowance is to stopping turns. */
type AllowanceState = 'ok' | 'warn' | 'exhausted';
/**
 * Classify a token allowance. THE single definition of the thresholds — the
 * diagnostics signals below and any host banner must agree on when to warn, or a
 * user gets a scary banner and a calm report (or vice versa).
 *
 * Takes the structural meter shape, so hosts can pass their own
 * `/api/consumption` snapshot meter without converting it.
 *
 * `unlimited` is authoritative: a tenant the gateway does not cap must never be
 * told it is out of tokens, however large `used` grows.
 */
declare function allowanceState(meter: {
    unlimited: boolean;
    remaining: number;
    percentUsed: number;
} | null | undefined): AllowanceState;
/**
 * Render the diagnostics block as Markdown lines (no trailing blank line). Every field
 * is best-effort: an absent value is shown as "unknown"/"none" rather than omitted, so
 * the reader can tell "not gathered" from "genuinely empty".
 */
declare function formatChatDiagnostics(d: ChatDiagnosticsData): string[];

/**
 * The sub-agents of a chat, as a triage report reads them.
 *
 * A sub-agent is a run of its own — its turns, tool calls and failures live in ITS trace,
 * not its owner's. A report built from the owner's trace alone shows `wait_agents`
 * sitting for minutes and nothing about the three runs it is waiting on, which is exactly
 * where the answer to "why is it waiting / what went wrong" lives. This renders each
 * child from its own trace, so the report names who was spawned, by whom, what each did,
 * where each failed, and what it reported.
 *
 * Pure: the surface hands in each child's trace and state; nothing here reads a store.
 */

interface SubagentDiagnosticsInput {
    /** How it is addressed, e.g. `a3`. */
    handle: string;
    name: string;
    /** Its slice of the work. */
    label: string;
    /** Who spawned it. */
    owner: string;
    /** 1 for a child, 2 for a grandchild … */
    depth: number;
    ticket?: string;
    /** Still running at capture. */
    running: boolean;
    /** Its own run's trace. */
    events: BrainTraceEvent[];
    /** What it is doing right now, when running. */
    activity?: BrainRunActivity | null;
    /** The run's error, when it failed. */
    error?: string;
    /** Its last assistant message — the report it gave (or is writing). */
    lastMessage?: string;
}
/** The "Sub-agents" block of a triage report. Empty when the chat spawned none. */
declare function formatSubagentDiagnostics(children: readonly SubagentDiagnosticsInput[], capturedAtMs: number): string[];

/** The `/api/consumption` snapshot, structurally — each host has its own named type
 *  for it, and they agree on exactly these fields. */
interface ChatDiagnosticsPlanSnapshot {
    period: {
        start: string;
        resetsAt: string;
    };
    plan: {
        effective: string;
        billingStatus: string;
    };
    meters: ChatDiagnosticsMeter[];
    /** Every limit is lifted because the CALLER is a superadmin — not because the plan
     *  grants it. Optional: an older API does not send it. */
    limitsLiftedBySuperadmin?: boolean;
    /** Spent vs saved over the last 30 days. Optional: an older API does not send it. */
    spendSavings?: SpendSavingsSummary | null;
}
/** The `/llm/v1/models` surface, structurally — enough to classify funding and to
 *  count what the plan pool offers. */
interface ChatDiagnosticsModelSurface {
    data?: Array<{
        id?: string;
    }>;
    byo?: {
        providers?: string[];
        models?: Array<{
            id?: string;
            vendor?: string;
        }>;
    };
    canUsePremiumModels?: boolean;
}
/** The `/api/projects/:id/evermind/contributions` head, structurally. */
interface ChatDiagnosticsEvermindHead {
    version: number;
    mode: string;
    inferenceEnabled?: boolean;
    teacherModel?: string | null;
    contributions?: number;
    pending?: number;
    lastLearnedAt?: string | null;
}
/** The minimum of a message this needs: the last assistant turn's learn outcome.
 *  Structural on purpose so a host can pass its own message array unchanged. */
interface ChatDiagnosticsMessageLike {
    role: string;
    evermindLearn?: {
        learned: boolean;
        version: number;
        reason?: string | null;
    } | null;
}
/**
 * Everything the report needs, split into what the host KNOWS and what it must READ.
 *
 * Every reader is optional and best-effort: an omitted one is simply "not gathered"
 * and a rejecting one degrades to null/[]. That is deliberate — a diagnostics capture
 * whose whole point is to explain a broken chat must never itself fail because one of
 * the endpoints it asks about is the broken one.
 */
interface ChatDiagnosticsSources {
    /** Which surface produced the capture ('Web' | 'VS Code (VSIX)' | …). */
    surface: string;
    chatId?: number | null;
    chatTitle?: string | null;
    /** 'shared' | 'locked'. */
    chatVisibility?: string | null;
    /** The chat's MODE ('chat' | 'work') — what the run was obliged to do, which is what
     *  decides whether "planned it and stopped" is correct behaviour or a failed execution. */
    mode?: string | null;
    /** The CHAT's own project — what the learn gate keys on. */
    projectId?: number | null;
    projectName?: string | null;
    /** The project the surrounding UI currently has SELECTED — `null` when none is.
     *  Always reported, so "nothing selected" stays distinguishable from "selected but
     *  the chat never adopted it" (see `ChatDiagnosticsData.selectedProjectId`). */
    selectedProjectId?: number | null;
    /** Display name for {@link selectedProjectId}, when the host holds one. */
    selectedProjectName?: string | null;
    tenantId?: number | string | null;
    userId?: string | null;
    /** The transcript — read for the newest assistant turn's learn outcome and the
     *  message/step counts. */
    messages?: readonly ChatDiagnosticsMessageLike[];
    /** Where the full dialogue is stored on this surface (a file path, a chat URL). */
    historyLocation?: string | null;
    /** This chat's dollar rollup (`BrainChat.spend`). Null when the server has none yet. */
    spend?: SpendSavingsSummary | null;
    /** The live tool registry the conversation runs on, and why it might be short. */
    tools?: {
        count: number;
        error?: string | null;
        loading?: boolean;
    };
    /** The run's trace, so the report states the tools the model was ACTUALLY handed
     *  per turn rather than a ceiling derived from the registry size. */
    trace?: readonly BrainTraceEvent[];
    /** The model pinned for this chat, or null when the gateway routes per turn. */
    model?: string | null;
    /** The model surface the pickers already loaded — reused, never re-fetched. */
    modelSurface?: ChatDiagnosticsModelSurface | null;
    /** The build that produced the capture (extension version / web app version). */
    uiVersion?: string | null;
    /** Short SOURCE HASH of the client artifact — the identity `uiVersion` cannot carry
     *  (two artifacts can share a version and differ in code). `"dev"` when unbundled. */
    uiBuildId?: string | null;
    /** ISO timestamp the client artifact was built. */
    uiBuiltAt?: string | null;
    /** Source hash of the WEBVIEW bundle, when the surface ships one separately from its
     *  host. Both halves of the VS Code extension travel in one `.vsix`, so these match in
     *  a released install — a MISMATCH is the case that used to be invisible, and the one
     *  that made "is the host older than the version it reports?" unanswerable. */
    webviewBuildId?: string | null;
    webviewBuiltAt?: string | null;
    /** Whether this machine can run the POSIX git scripts (`git_sync_latest` / `undo` /
     *  `redo`). Absent on a surface with no local shell. */
    posixShell?: string | null;
    /** The gateway this surface is talking to. */
    baseUrl?: string | null;
    /** Resolve the chat project's NAME when the host does not already hold it (the two
     *  UI surfaces read it from a loaded project list; the headless probe has none).
     *  Wins over the static `projectName` above when it answers. */
    readProjectName?: () => Promise<string | null>;
    readAgents?: () => Promise<Array<{
        agentRef: string;
        role: string;
        name?: string;
        builtinKind?: string | null;
    }>>;
    readTickets?: () => Promise<Array<{
        kind: string;
        ref: string;
        label?: string;
        linkType?: string;
        status?: string;
    }>>;
    /**
     * The chat's EXECUTION HISTORY — what actually ran, and who started it.
     *
     * Optional, and its absence is reported as "not gathered" rather than "nothing ran":
     * those are opposite findings, and a surface that has not adopted the read must not
     * be able to assert the stronger one by omission.
     */
    readRuns?: () => Promise<ChatDiagnosticsRuns | null>;
    readEvermind?: () => Promise<ChatDiagnosticsEvermindHead | null>;
    readPlan?: () => Promise<ChatDiagnosticsPlanSnapshot | null>;
    /** Resolve the deployed API version — bounded + session-cached by
     *  `fetchApiVersionVia`, which every host reaches it through. */
    readApiVersion?: () => Promise<string | null>;
}
/**
 * Assemble the diagnostics payload. Resolves — never rejects — so a caller can hand
 * the result straight to {@link formatChatDiagnostics} without a try/catch that would
 * only ever produce a worse report.
 */
declare function gatherChatDiagnostics(src: ChatDiagnosticsSources): Promise<ChatDiagnosticsData>;

/**
 * chatDiagnosticsReport — the diagnostics capture as DATA, not prose.
 *
 * Every "Copy diagnostics" surface has, until now, produced exactly one artefact: a wall
 * of Markdown on the user's clipboard. That is the right thing for a bug report and the
 * wrong thing for everything else. Nobody can ask "how many work-mode runs filed tickets
 * and staffed nobody last week?", the report is gone the moment the user closes the chat,
 * and an agent asked to look into its own failure has to re-derive the facts from a
 * transcript it cannot read reliably.
 *
 * So the same facts are ALSO assembled here as one versioned JSON object, persisted with
 * the chat (`POST /api/brain/chats/:id/diagnostics`) and appended to the copied report so
 * the paste carries both halves. There is no second derivation: this composes the exact
 * values the Markdown renders — {@link ChatDiagnosticsData}, {@link BrainDiagnostics},
 * the shared provenance readers and {@link StaffingSummary} — so the prose and the JSON
 * can never disagree about the run they describe.
 *
 * Pure of clock and I/O (`now` is injected) so a test pins a capture time and a host can
 * build the report anywhere it already holds the events.
 */

/**
 * Schema version of the persisted report.
 *
 * Bumped whenever a field CHANGES MEANING or disappears — a reader that stored a v1 row
 * must be able to tell it apart from a later shape without guessing from which keys are
 * present. Purely additive fields do not bump it.
 */
declare const CHAT_DIAGNOSTICS_SCHEMA_VERSION = 1;
/** Model/account provenance for the run, as data rather than the rendered header lines. */
interface ChatDiagnosticsProvenance {
    /** What the surface was CONFIGURED with — null when the gateway auto-selects. */
    configuredModel: string | null;
    /** What actually answered, first-seen order (a mid-run failover stays visible). */
    modelsUsed: string[];
    /** Which purse served it: 'own' | 'shared' | 'shared_byo_unused'. */
    account: string | null;
}
/** One persisted diagnostics capture. The wire shape of `POST /api/brain/chats/:id/diagnostics`. */
interface ChatDiagnosticsReport {
    schemaVersion: 1;
    /** ISO capture time. */
    capturedAt: string;
    /** Where the capture was taken ('VS Code (VSIX)' | 'Web' | …). */
    surface: string;
    /** The run verdict, or null when there were no events to judge. */
    likelyCause: BrainDiagnostics['likelyCause'] | null;
    /** True when the run was STILL EXECUTING at capture time — every "and then nothing
     *  happened" field below describes an UNFINISHED run, not a failed one. */
    running: boolean;
    /** Chat identity + wiring state: project, tenant, Evermind head, agents, tickets, plan. */
    chat: ChatDiagnosticsData;
    /** The run's own numbers. Null when the capture holds no trace events at all — an
     *  empty diagnostics object would claim measurements nobody took. */
    run: BrainDiagnostics | null;
    provenance: ChatDiagnosticsProvenance;
    /** Filed vs staffed. Null alongside a null `run`, for the same reason. */
    staffing: StaffingSummary | null;
}
interface BuildChatDiagnosticsReportInput {
    /** The gathered chat state — exactly what the Markdown block renders. */
    diagnostics: ChatDiagnosticsData;
    /** The MERGED trace (live steps + steps recovered from durable history). */
    events: BrainTraceEvent[];
    /** The visible conversation — needed for the verdicts that read prose against the trace. */
    messages: BrainMessage[];
    /** The model this surface was configured with. */
    model?: string | null;
    /** True when the run was still executing when the capture was taken. */
    running?: boolean;
    surface: string;
    /** Injected clock, so a capture time can be pinned in a test. */
    now?: () => Date;
}
/** Assemble the persisted report. Pure; never throws. */
declare function buildChatDiagnosticsReport(input: BuildChatDiagnosticsReportInput): ChatDiagnosticsReport;
/**
 * The report as a fenced JSON block for the copied Markdown.
 *
 * Appended at the very END of the transcript and deliberately EXEMPT from the payload
 * budget that trims tool input/output: this is not another rendering of the run, it is
 * the machine-readable copy of the same facts, and a half-elided JSON object is not
 * valid JSON — it is useless to the only reader it exists for. The prose above it is
 * what a human reads; trimming that is a cost, trimming this is a total loss.
 */
declare function formatChatDiagnosticsReportJson(report: ChatDiagnosticsReport): string[];

/**
 * The gateway's model catalogue, read the ONE way every client reads it.
 *
 *   GET /llm/v1/models   — plan pool, free subset, BYO surface, entitlements
 *   GET /api/llm/models  — the tenant's named LLM configs (`tenant_model:<slug>`)
 *   GET /llm/v1/catalog  — the paid OpenRouter catalog, ONLY when entitled
 *
 * Two layers. The RULES (`gatewayPlanIsPaid`, `gatewayCanChooseModel`,
 * `gatewayModelIdentity`, `gatewayPlanModels`) are pure and shared by every reader —
 * the web's `useLlmModels`, the VS Code host's QuickPick, and the loader below — so
 * "may this viewer pin a model" is decided once, against the same older-payload
 * fallback everywhere. The LOADER (`loadGatewayModelOptions`) builds the `/` menu's
 * `ChatModelOptions` over any authenticated JSON GET, and is what the VS Code webview
 * and Rovr's side panel mount; it caches per key for the life of the page.
 */

/** The subset of `GET /llm/v1/models` a client consumes. Every field is optional so an
 *  older gateway degrades instead of breaking the picker. */
interface GatewayModelSurface {
    /** `configured: true` payloads list the pool as status rows (`model`); the shared
     *  funding / failover selectors read it as `id` — {@link loadGatewayModelOptions}
     *  normalizes it to carry both. */
    data?: Array<{
        id?: string;
        model?: string;
    }>;
    /** `configured: false` payloads list the pool as bare ids. */
    models?: string[];
    freeModels?: string[];
    /** The curated tool-calling / coding subset of the pool. */
    codingModels?: string[];
    teacherModels?: string[];
    /** A connected account's models; `contextWindow` is the vendor catalog's window. */
    byo?: {
        providers?: string[];
        models?: Array<{
            id?: string;
            vendor?: string;
            contextWindow?: number;
        }>;
    };
    canUsePremiumModels?: boolean;
    canChooseModel?: boolean;
    canUseFrontierModels?: boolean;
    /** The tenant's resolved plan ('free' | 'pro' | 'teams'). */
    effectivePlan?: string;
    /** A premium override lifts a free plan onto the paid product. */
    premium?: boolean;
}
/** True when the tenant's turns are funded by a paid plan (or a premium override). */
declare function gatewayPlanIsPaid(surface: Pick<GatewayModelSurface, 'premium' | 'effectivePlan'>): boolean;
/**
 * May the tenant pin a model at all? The server sends `canChooseModel` (its alias for
 * frontier access); an older payload that omits it falls back to every grant that
 * implies choice — a paid plan, frontier or premium access, or a connected provider.
 */
declare function gatewayCanChooseModel(surface: GatewayModelSurface): boolean;
/** Who is reading: the routing product funding their turns, and whether a pin is accepted. */
declare function gatewayModelIdentity(surface: GatewayModelSurface): ModelIdentityContext;
/** The plan pool's model ids, whichever payload shape carried them. */
declare function gatewayPlanModels(surface: GatewayModelSurface): string[];
/**
 * The gateway catalog's context windows, as the window-fit gate's `cloud` source — the
 * client twin of the server's `catalogEntry(model).contextWindow`. Only the models the
 * surface carries a window for answer (a connected account's catalog rows); any other
 * ref is unknown, which keeps the run's own budget rather than guessing.
 */
declare function gatewayModelWindows(surface: {
    byo?: {
        models?: ReadonlyArray<{
            id?: string;
            contextWindow?: number;
        }>;
    };
} | null | undefined): (ref: string) => number | undefined;
/** An authenticated JSON GET against the gateway (`<T>(path) => Promise<T>`). */
type GatewayJsonRequest = <T>(path: string) => Promise<T>;
interface GatewayModelOptions {
    /** The surface, `data` normalized to `{ id }` rows for the funding / failover selectors. */
    surface: GatewayModelSurface;
    /** Everything the `/` menu can offer, grouped by who pays. */
    options: ChatModelOptions;
    identity: ModelIdentityContext;
}
/** The shape a host shows while the catalogue is unreadable: Auto only, choice-less. */
declare const EMPTY_GATEWAY_MODEL_OPTIONS: GatewayModelOptions;
/** Drop the cached catalogue (sign-in / sign-out / workspace switch). */
declare function invalidateGatewayModelOptions(): void;
/**
 * The `/` menu's gateway models, cached per `cacheKey` (the gateway base URL) for the
 * life of the page — a slow-changing surface a host must not re-fetch on every repaint.
 * A failure is not cached (a later read retries) and resolves to
 * {@link EMPTY_GATEWAY_MODEL_OPTIONS}.
 */
declare function loadGatewayModelOptions(request: GatewayJsonRequest, cacheKey: string, labels: {
    paidCostDetail: string;
}): Promise<GatewayModelOptions>;

/**
 * Last-known state of the MCP tool catalog fetch — a module singleton, mirroring
 * `lastResolvedModel`.
 *
 * Why this exists: `useMcpExtensions` fetches the gateway's tool catalog, and a
 * failure there (401, 500, network) used to collapse silently to an EMPTY tool
 * list. The Brain then has no data tools, so every answer becomes "I don't have
 * that data" / "calling the tool now" followed by nothing — indistinguishable from
 * a weak model, and invisible in the diagnostics dump.
 *
 * The hook publishes here; the diagnostics reporter reads it, so "how many tools
 * did the model actually have?" is always answerable after the fact.
 */
interface McpToolStatus {
    /** Tools registered into the Brain's loop (0 = the model can call nothing). */
    count: number;
    /** Why the catalog fetch failed, when it did. Null on success. */
    error: string | null;
    /** True until the first fetch settles. */
    loading: boolean;
}
declare function setMcpToolStatus(next: McpToolStatus): void;
declare function getMcpToolStatus(): McpToolStatus;

/**
 * Per-turn tool selection.
 *
 * The Brain's catalog has grown to ~300 tools (205 first-party `builtin_*` entries
 * plus tenant MCP servers and navigation). Sending ALL of them on every turn is
 * the failure mode this module exists to fix:
 *
 *   - Most providers degrade sharply past ~128 tool definitions, and small
 *     free-pool models routinely respond to an oversized catalog by emitting NO
 *     tool calls at all — observed live: a chart request answered with "I do not
 *     have the task status data", zero tool calls, three times running, with 308
 *     tools advertised.
 *   - Every definition carries a JSON schema, so the catalog alone can dominate
 *     the prompt budget before the conversation is even considered.
 *
 * The selection is LEXICAL and deterministic — no embeddings, no extra round trip,
 * no network — and the scoring is the shared `rankLexically` from
 * `@builderforce/agent-tools` (the same ranker the Worker's `tool_search` uses), fed
 * this module's product synonyms as extra weighted fields. It scores each tool against the live turn's text and keeps the best
 * `limit`, then adds anything the run has already touched (beyond the limit) so a
 * multi-step task never loses a tool mid-flight.
 *
 * Safety posture: when in doubt, INCLUDE. A catalog at or under the limit is
 * returned untouched, so small deployments behave exactly as before.
 */

/**
 * How many tools to advertise per turn. Comfortably under the ~128 threshold where
 * providers start to degrade, while leaving room for a broad request to still see
 * several domains at once.
 */
declare const DEFAULT_TOOL_LIMIT = 64;
interface SelectToolsOptions {
    /** The turn's text — typically the latest user message. */
    query: string;
    /** Max tools to advertise. Defaults to {@link DEFAULT_TOOL_LIMIT}. */
    limit?: number;
    /**
     * Tool names already called in this run. Always kept regardless of score, so a
     * multi-step task cannot lose a tool it is mid-way through using.
     */
    pinned?: Iterable<string>;
    /**
     * Tool names the SYSTEM PROMPT instructs the model to call. Kept ahead of
     * everything else, because advertising less than the prompt promises is a
     * contradiction the model can only resolve by narrating a call it cannot make.
     */
    required?: Iterable<string>;
}
interface ToolSelection {
    tools: BrainToolSpec[];
    /** True when the catalog was trimmed (i.e. selection actually applied). */
    trimmed: boolean;
    /** Size of the catalog before selection — recorded in the run trace. */
    available: number;
}
/**
 * Choose the tools to advertise for one turn.
 *
 * Order of inclusion: prompt-required tools, then by descending relevance, then — if
 * the limit is still unmet — catalog order, so a vague query ("help me") still gets a
 * usable, stable set rather than an arbitrary one. Pinned tools (already called this
 * run) are added on top, beyond the limit, so a pin never evicts a fixed tool.
 */
declare function selectToolsForTurn(tools: BrainToolSpec[] | undefined, options: SelectToolsOptions): ToolSelection;

/**
 * The tool ROUTER — the escape hatch that makes per-turn tool selection lossless.
 *
 * The problem with advertising a relevance-picked subset of a ~317-tool catalog is
 * not that it picks badly; it is that picking AT ALL is lossy and the model has no
 * way to know. A tool that misses the cut simply does not exist from where the model
 * is standing, so a request that needs it ends in a narrated call or an "I don't have
 * that data" — with no signal that the capability was there all along, one rank below
 * the cut. Worse, the cut is recomputed per turn, so a tool can be present on one
 * turn and gone on the next.
 *
 * The fix is a different DATA STRUCTURE rather than a better ranking: keep advertising
 * the relevant leaves for ergonomics, and additionally advertise three small, FIXED
 * tools that together reach every tool in the catalog:
 *
 *   find     → search the full catalog by keyword          (name + description only)
 *   describe → fetch one tool's exact JSON schema           (so args can be built)
 *   invoke   → call any tool in the catalog by name         (dispatch to the real one)
 *
 * Cost is three schemas per turn instead of 317, and the guarantee flips: nothing is
 * ever unreachable, only less convenient. This is progressive disclosure — the model
 * pays a round trip for the long tail and nothing for the hot set.
 *
 * Everything resolves against the in-memory catalog the run already holds, so `find`
 * and `describe` cost no network at all.
 */

/** Advertised names of the three router tools. Stable — the model learns them. */
declare const TOOL_ROUTER_FIND = "builtin_tools_find";
declare const TOOL_ROUTER_DESCRIBE = "builtin_tools_describe";
declare const TOOL_ROUTER_INVOKE = "builtin_tools_invoke";
/** True when `name` is one of the router's own tools (not a catalog tool). */
declare function isRouterTool(name: string): boolean;
/**
 * The three router specs. Their descriptions are written AT the model: they have to
 * make it obvious that a missing tool is a lookup away, because a model that does not
 * know the catalog is bigger than its tool list will never think to look.
 */
declare function routerToolSpecs(catalogSize: number): BrainToolSpec[];
/** One catalog entry as `find` reports it. */
interface ToolCatalogMatch {
    name: string;
    description: string;
}
/**
 * Keyword search over the FULL catalog. Ranks a name match above a description match
 * (the same weighting `selectTools` uses — the model should see the tool whose NAME is
 * about tickets before one that merely mentions them).
 */
declare function findTools(catalog: BrainToolSpec[], query: string, limit?: number): ToolCatalogMatch[];
/** The exact spec for one catalog tool, or null when the name is unknown. */
declare function describeTool(catalog: BrainToolSpec[], name: string): BrainToolSpec | null;
/**
 * Run a router call against the in-memory catalog.
 *
 * `find` and `describe` are answered locally (no network). `invoke` unwraps to a real
 * catalog call and is dispatched by the caller through `runTool`, so every guard the
 * normal path applies — confirmation gate, dedupe, audit, auto-link — still applies to
 * a routed call. Returns `{ dispatch }` for that case rather than calling anything
 * itself, keeping this module pure.
 */
declare function handleRouterCall(catalog: BrainToolSpec[], name: string, args: unknown): {
    result: unknown;
} | {
    dispatch: {
        name: string;
        args: Record<string, unknown>;
    };
};

/**
 * WHERE a linked work item OPENS — one routing table, every surface.
 *
 * The chat⇄ticket panel renders an "Open" affordance for each item a conversation
 * created or linked. Turning `(kind, ref, projectId)` into a destination was written
 * TWICE — once in the web host (`ChatTicketsPanel`'s `openTicket`, pushing through the
 * Next router) and once in the VS Code host (`brainWebview.openArtifact`, opening an
 * external URL). The two agreed on the day they were written and then drifted, which is
 * exactly the class of duplication the repo forbids: the same decision, expressed twice,
 * with nothing making them equal.
 *
 * They also both stopped SHORT of the item. A task deep-linked to its detail drawer
 * (`&task=<id>`), but every other kind landed on the SURFACE that contains the item and
 * left the user to find the card: an objective opened the portfolio tab, a spec opened
 * the project board. "Open" that reveals a page is not opening the thing.
 *
 * So this module returns a path that names the EXACT artifact for every kind:
 *
 *   task · epic · gap   → the ticket detail drawer               (`&task=`)
 *   objective · initiative · portfolio
 *                       → the PMO Structure tab, that card focused and scrolled to
 *                                                                 (`&focus=kind:id`)
 *   spec                → the project's PRDs tab with that document's drawer open
 *                                                                 (`&panel=prds&spec=`)
 *   roadmap             → the PM Roadmap section with that item's panel open
 *                                                                 (`&section=roadmap&roadmap=`)
 *   retro · poker       → the ceremony session itself             (`&session=`)
 *
 * Framework-free on purpose (plain strings in, one path out): the web host feeds it to
 * `router.push`, the VS Code host concatenates it onto the configured web base URL, and
 * neither can be given a route the other does not have.
 */
/** Every work-item kind a Brain chat can be tied to. Mirrors `TICKET_KINDS`. */
type ArtifactKind = 'portfolio' | 'objective' | 'initiative' | 'roadmap' | 'spec' | 'epic' | 'gap' | 'task' | 'retro' | 'poker';
/**
 * The query param the PMO views read to focus ONE strategy card, as `kind:id`.
 * A single param (rather than `focusKind` + `focusId`) keeps the two halves
 * inseparable — a link cannot carry an id with no kind to interpret it.
 */
declare const PMO_FOCUS_PARAM = "focus";
/** Build the `focus` value for a strategy card. */
declare function pmoFocusValue(kind: 'objective' | 'initiative' | 'portfolio', ref: string): string;
/** Parse a `focus` value back into its halves; `null` for anything unrecognised. */
declare function parsePmoFocus(value: string | null | undefined): {
    kind: 'objective' | 'initiative' | 'portfolio';
    id: string;
} | null;
/**
 * The DOM id a focusable PMO card carries, so the view can scroll to it without
 * threading refs through three levels of render helper. Derived from the same
 * `kind:id` pair the URL carries, so the link and the element cannot disagree.
 */
declare function pmoFocusDomId(kind: string, id: string): string;
/**
 * The path that opens ONE work item.
 *
 * `projectId` scopes the kinds that live under a project (task/epic/gap/spec/roadmap);
 * strategy tiers and ceremonies are workspace-wide and ignore it. Returns an absolute,
 * same-origin path — never a full URL, so the VS Code host stays in control of which
 * deployment it opens.
 */
declare function artifactRoutePath(kind: string, ref: string | null | undefined, projectId?: number | null): string;

/** Whether a workspace role (any case) may manage the workspace's project settings. */
declare function isManagerRole(role: string | null | undefined): boolean;

/**
 * PromptInput — the embeddable ONE-LINE composer: one filled box holding the field
 * and a round trailing button (Send, or Stop while a turn streams).
 *
 * ── WHY IT LIVES IN THE PACKAGE ──────────────────────────────────────────────
 * PRD 14 §136 moves the Brain's UI out of the web app so an external embed and
 * builderforce.ai draw the same composer. This is the small one — the full chat
 * composer (attachments, model menu, modes) is `ChatInput`; this is the "ask the
 * agent something" row a host drops beside other controls.
 *
 * ── WHAT IT DOES NOT CARRY ───────────────────────────────────────────────────
 * No copy and no router. Every word it shows is handed in already translated,
 * because the package cannot know the host's locale; and a link under the field is
 * `secondaryContent` the host renders with its OWN router, because a plain anchor in
 * a client-routed app is a full page load. Colours are the host's design tokens with
 * legible fallbacks, so it reads in either theme without a stylesheet.
 */
interface PromptInputProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    /** Placeholder, translated by the host. */
    placeholder: string;
    /** The send button's accessible name — it draws an arrow. Translated by the host. */
    submitLabel: string;
    /** The field's accessible name when the placeholder alone is not enough. */
    ariaLabel?: string;
    disabled?: boolean;
    /** A turn is in flight: the button shows it is working. */
    busy?: boolean;
    /**
     * Interrupt the in-flight turn. While `busy` with an empty field, the trailing
     * button becomes Stop. Needs {@link stopLabel} too — the package carries no copy.
     */
    onStop?: () => void;
    /** The Stop button's accessible name, translated by the host. */
    stopLabel?: string;
    /** Rendered before the field, inside the box — a recipient picker, say. */
    leading?: ReactNode;
    /** Rendered under the box — a link through the host's router, or why it is disabled. */
    secondaryContent?: ReactNode;
    /** 1 = single line (default); more = a compact textarea. */
    rows?: number;
    className?: string;
    /** When false, Enter adds a newline and only the button sends. Default true. */
    submitOnEnter?: boolean;
}
declare function PromptInput({ value, onChange, onSubmit, placeholder, submitLabel, ariaLabel, disabled, busy, onStop, stopLabel, leading, secondaryContent, rows, className, submitOnEnter, }: PromptInputProps): react.JSX.Element;

/**
 * The surface a gateway call is attributed to — the usage ledger's `surface` column.
 *
 * The vocabulary and the header are declared once in `@builderforce/spend-contract`
 * (the api reads both). A client that drives its own transport tags every gateway call
 * through {@link withUsageSurface} so "what did this cost, and where" is answered by the
 * ledger, not guessed: the VS Code native run (`vsix`) and Rovr (`rovr`) share it.
 */

type TransportFetch = (input: string, init: RequestInit) => Promise<Response>;
/** `fetchImpl`, with every request tagged as coming from `surface`. */
declare function withUsageSurface(fetchImpl: TransportFetch, surface: UsageSurface): TransportFetch;

interface QueuedItem<T> {
    /** Stable per held turn, so a host can render it and let the user remove it. */
    readonly id: number;
    readonly value: T;
    /** Held only because no run was live yet - in THIS chat's run: steered into it the moment it goes live. */
    readonly preLiveFor?: number;
    /**
     * Held for a DRAFT's creation (`draftBinding.ts`): typed while the first send was still creating the chat. Owned by that
     * creation's token - not by a chat id and not by the chat showing - so switching the visible chat leaves it alone. It is
     * in no other chat's queue (`items`), and only its own token's answer settles it. `followUp`: direction for the run being
     * made; otherwise held for after it (`queueAfter`).
     */
    readonly draft?: {
        readonly token: DraftToken;
        readonly followUp: boolean;
    };
}
/** A turn a draft's creation answered for: the value, and whether it is direction for the run being made. */
interface DraftHeld<T> {
    readonly value: T;
    readonly followUp: boolean;
}
interface QueuedTurns<T = string> {
    /** The held turns this view shows, oldest first (the showing draft's included; another draft's never). */
    items: readonly QueuedItem<T>[];
    /** How many turns are waiting. */
    count: number;
    /**
     * Offer a turn to the queue. Returns true when it was HELD (a run is in
     * flight and the caller must not send), false when the caller should send it
     * now. Written this way so the host keeps ownership of how it sends.
     */
    submit: (value: T, opts?: {
        preLiveFor?: number;
        draft?: QueuedItem<T>['draft'];
    }) => boolean;
    /** Drop one held turn (the user removed it, or steered it into the run). */
    remove: (id: number) => void;
    /** Put a turn back at the FRONT of the queue - a flushed turn the host did not keep must not be lost. */
    requeue: (value: T) => void;
    /** Add a turn at the BACK, held or not - an idle send waits behind the turns already waiting. */
    pushBack: (value: T) => void;
    /** Take the OLDEST waiting turn out of the queue now (undefined when none). Never one held for a draft's creation. */
    takeFront: () => T | undefined;
    /**
     * Drop everything this view holds - a stopped run. A Stop on the draft itself clears that draft's own held turns (they
     * are that conversation's queue); turns held for ANOTHER draft's creation are not its to drop.
     */
    clear: () => void;
}
interface QueuedTurnsOptions<T> {
    /** True while a turn is in flight on this conversation. */
    running: boolean;
    /** Send one held turn. Called on the running→idle edge, newest closure. */
    send: (value: T) => void;
    /** Queued turns are discarded when this changes (e.g. the active chat id). */
    resetKey?: string | number | null;
    /**
     * The text a non-string turn carries, for the blank check. String turns are
     * trimmed and checked directly; omit this for them.
     */
    textOf?: (value: T) => string;
    /**
     * Asked on the running->idle edge before a held turn is taken: false leaves the queue alone. A
     * host that is already sending a turn (and will chain on to the next when it is done) says so, so
     * the edge and that chain never both send - one path, whatever order the renders land in.
     */
    mayFlush?: () => boolean;
    /**
     * The conversation changed while turns were still held: every one of them, oldest first, with the key it was held
     * in. Each belongs to THAT conversation - the host hands it there (its run's inbox, or back to the composer) -
     * so nothing a person typed is discarded by a chat switch. Without it the held turns are dropped (a host with
     * nowhere to hand them). Turns held for a draft's creation are NOT handed off here: their token's answer settles them.
     */
    handOff?: (held: readonly QueuedItem<T>[], fromKey: string | number | null) => void;
    /**
     * The draft binding (`useChatCreation().drafts`): which creation each draft-held turn belongs to. Optional - a host
     * without draft creation holds none.
     */
    drafts?: DraftBinding;
    /**
     * A draft's creation answered - the chat id, or null when nothing was created: these turns, oldest first (possibly none),
     * were held for it. They have left the queue; the host lands them THROUGH THE CREATED CHAT'S RUN, whichever chat is
     * showing (back to the composer when nothing was created). Called for every answer, so the host can also settle the send
     * that made the creation.
     */
    landDraft?: (held: readonly DraftHeld<T>[], outcome: DraftOutcome, token: DraftToken) => void;
}
declare function useQueuedTurns<T = string>({ running, send, resetKey, textOf, mayFlush, handOff, drafts, landDraft }: QueuedTurnsOptions<T>): QueuedTurns<T>;

/**
 * Where turns go when they are not sent from the composer: held turns whose conversation changed (`handOff`), and turns held
 * for a draft's creation once it answers (`landDraft`). Extracted from `useChatTurns`, which owns the ports and the queue.
 *
 * A DRAFT's turns are delivered by the creation that made their chat, THROUGH THAT CHAT'S RUN (`chatDelivery.ts`) - never by
 * asking which chat is showing, and never by restoring them to the composer because a run driver is installed. The same
 * binding owns the send that began the creation: when the creation fails, the send's own turn and everything held behind
 * it come back to the composer as ONE joined turn, once, and the send reports itself kept.
 */
/** What the host's `send` is told about the send it is asked to make. */
interface SendContext {
    /**
     * The draft token this send began with (`draftBinding.begin`), when it starts from a draft: hand it to the conversation's
     * `send` so the creation it triggers is THIS draft's (`ensureChatId(token)`), never whichever draft is on screen by then.
     */
    readonly draft?: DraftToken;
}

/**
 * THE ONE DOOR a user turn leaves a composer through — typed, an answered question, a
 * "Send again", a neighbouring surface handing text over — and the ONE Stop. Extracted
 * from the web Brain panel's controller (`useBrainPanelController`), which the editor
 * chat (`useChatSend`), Rovr (`ChatView`) and the Creation Canvas (`useCanvasTurnQueue`)
 * each re-wrapped around the shared queue.
 *
 * Order of a submit:
 *  1. `steer` (optional port) — a turn the host routes INTO a live run (the editor's
 *     live sub-agent, or a run waiting on its sub-agents) is delivered there, never
 *     queued behind the chat's own run;
 *  2. mid-run, the chat's own run is STEERED by default (PRD 35 E10) - by the door itself, or by
 *     the host's `steer` port, which asks the door's own predicate (`turns.steers`):
 *     the message is posted to the run's inbox, interrupts the step in flight and reaches the
 *     next model call — it does not wait behind a run that may hold for minutes. Holding it
 *     for after the run is the explicit alternative: `queueAfter`. Direction that arrives
 *     after the run's last drain is made the chat's NEXT turn by the run store when the run
 *     settles (`runStore/continueChat.ts`; the web twin of the editor's `runSteer.settled`) - not
 *     here: this hook holds only the turns the UI itself holds. A Stop drops what is still waiting;
 *  3. the queue — a turn that cannot steer (addressed to a participant, a canvas key, a run
 *     being stopped, or one behind turns already held, which it must not jump) is HELD and
 *     sent on the run's falling edge (`useQueuedTurns`: FIFO, one per completed run,
 *     discarded on a `runKey` switch);
 *  4. otherwise `send` now.
 *
 * A stop ("Stop the run") is the Stop: mid-run it stops the run and drops what is held
 * (nothing waits behind it); idle it is sent, kept as the answer, and starts nothing
 * (`userTurnRuns.ts`). A stop addressed to a participant is a message, never the Stop.
 *
 * Stop drops everything queued (the person stopped the conversation, not one sentence)
 * and stops the run: the `stop` port when given, else `stopRun(runKey)` on the store.
 *
 * Policy that differs per host stays with the host and runs BEFORE `submit`: an exam
 * gate, an activity signal, clearing the draft. Draft restore uses `submit`'s result.
 * Chat creation is NOT here — mount `useChatCreation` before the conversation (its
 * `ensureChatId` is a conversation option, and this hook needs the conversation's
 * `running`), and call `ensureChatId` from inside `send` when the host has no
 * conversation hook to do it.
 */
interface ChatTurnsBase<T> {
    /** True while a turn is in flight on this conversation: what a typed message is HELD behind. */
    running: boolean;
    /**
     * Optional: true while the chat's own run is live (executing, or being made - the run store's
     * `isLive`) and can be spoken to now. Default `running`. A host's "in flight" can begin before any
     * run exists (a send saving its row, the editor fetching a limbic block): in that window a message
     * is HELD in order, never steered into an inbox no run reads. Hosts take both flags from the one
     * store state with `chatDoorLiveness`.
     */
    steerable?: boolean;
    /** The run being driven (chat id, `canvasRunKey(sessionId)`, …); null for a draft. Also the queue's reset key. */
    runKey: RunKey | null;
    /**
     * Optional: the draft binding (`useChatCreation().drafts`). A send that starts from a draft is minted a token, and what is
     * typed while it creates the chat is held under THAT token - landing in the chat the creation made, or back in the composer
     * when it made none - whichever chat the person is looking at by then. Hosts that create chats from a draft pass it.
     */
    drafts?: DraftBinding;
    /**
     * Deliver one turn now. Resolve `false` when it failed before it was kept (restore the draft). From a draft only, `ctx.draft`
     * is the token this send began with: pass it on to the conversation's `send` (`{ draft }`), which hands it to
     * `ensureChatId(token)` - the creation this send triggers belongs to THIS token. When that creation fails the door restores
     * the turn itself, together with everything held behind it, and reports the send kept - the host puts nothing back twice.
     */
    send: (turn: T, ctx?: SendContext) => Promise<boolean | void> | boolean | void;
    /**
     * Optional: route a turn into a live run instead; return true when it was taken. To speak to the
     * chat's OWN run it asks the door - `turns.steers(...)`, the predicate the composer's Send label
     * reads - and never recomputes it.
     */
    steer?: (turn: T) => boolean;
    /** Optional: how this host stops its run. Default `stopRun(runKey)`. */
    stop?: () => void;
    /** The text a non-string turn carries (blank check). Omit for string turns. */
    textOf?: (turn: T) => string;
    /** Optional: the attachments a non-string turn carries — they ride a steer so a mid-run image is not dropped. */
    attachmentsOf?: (turn: T) => ChatInputAttachment[] | undefined;
}
/**
 * A host that ADDRESSES turns (to a participant, not the run) must also say where one goes back to when
 * its send is not kept after the chat changed: the COMPOSER - text, files, addressee - never the queue now
 * showing (another chat's) and never a run. The two come as a pair; neither alone is accepted. A turn that
 * is not addressed goes to ITS chat's run through `chatDelivery` - the run driver's `steer` where the run
 * executes elsewhere, the run store's inbox otherwise: one delivery rule on every host.
 */
type ChatTurnsOptions<T> = ChatTurnsBase<T> & ({
    isDirected?: undefined;
    restore?: undefined;
    join?: undefined;
} | {
    isDirected: (turn: T) => boolean;
    restore: (turn: T) => void;
    /**
     * Several turns given back at once (everything held when the person moved to another chat) as the ONE turn the
     * composer takes back - texts in order, files together, the first addressee (`joinRestorableTurns`). The box
     * holds one draft: restoring them one by one would drop every text after the first. Without it they are
     * restored one by one.
     */
    join?: (turns: readonly T[]) => T;
});
interface ChatTurns<T> {
    /** The held turns (render them; let the user remove one). `queued.submit` is the raw hold-or-not primitive. */
    queued: QueuedTurns<T>;
    /**
     * Steer, queue or send one turn. Resolves `false` only when the turn was blank or
     * `send` reported it was not kept — the cue to restore the draft; `true` otherwise.
     * Stable identity.
     */
    submit: (turn: T) => Promise<boolean>;
    /** The explicit alternative to steering: hold the turn for after the run (sent on its falling edge). Stable identity. */
    queueAfter: (turn: T) => Promise<boolean>;
    /** Clear the queue and stop the run. Stable identity. */
    stop: () => void;
    /**
     * Would a message typed NOW steer the live run, or be held? The composer words its Send button
     * from this - the same predicate `submit` decides with, over the same state (a run being
     * stopped, turns already held this run). `preview` is what the box holds now. Read it during render.
     */
    steers: (preview: {
        directed: boolean;
        attachments?: readonly {
            imageUrl?: string;
        }[];
    }) => boolean;
}
/**
 * Does a message typed mid-run STEER the live run (true), or is it held for after it (false)?
 * ONE predicate - `submit` decides with it and the composer words its Send button from it, so
 * the button never promises a steer the turn will not get. A turn addressed to a participant
 * is a message to them, not to the run; one behind turns already held waits its turn rather
 * than jump them; one carrying a file the model cannot read inline (anything but a picture)
 * is held, because a steer would drop the file.
 */
declare function steersByDefault(turn: {
    directed: boolean;
    held: number;
    attachments?: readonly {
        imageUrl?: string;
    }[];
}): boolean;
/**
 * What a host tells the door about the chat's run, from ONE source - the run store's state for that
 * chat (`useBrainConversation`): `running` is everything in flight (a send still saving its row
 * included - typed messages are HELD behind it), `steerable` is the run being live (`runLive`:
 * executing or being made - messages STEER it). `extraInFlight` is a host's own pre-send work (the
 * editor's limbic fetch). Web, Rovr and the editor all pass this, so none computes its own.
 */
declare function chatDoorLiveness(conv: {
    sending: boolean;
    runLive: boolean;
}, extraInFlight?: boolean): {
    running: boolean;
    steerable: boolean;
};
declare function useChatTurns<T = string>({ running, steerable, runKey, drafts, send, steer, stop, restore, join, textOf, isDirected, attachmentsOf }: ChatTurnsOptions<T>): ChatTurns<T>;

/**
 * THE one rule for a turn that could not go - the same on every host (web panel, Rovr, the editor chat):
 * it goes back to the composer that is SHOWING, never dropped and never auto-sent into another chat.
 *
 *  - its files come back (merged by key);
 *  - its text comes back. Into an empty box it comes back alone, and with it the ADDRESSEE (reset to what the turn had, so a
 *    turn for the Brain never comes back pointed at a participant the composer happened to hold). If the person has typed
 *    something newer since, the turn's words go IN FRONT of it, a blank line between (they were said first: the same order
 *    `joinRestorableTurns` keeps) - nothing a person said is dropped - and the newer draft keeps the addressee it was
 *    written for.
 *
 * The box is written with an UPDATER, not a string: the prepend is computed against what the box holds when the write lands,
 * so a clear or a keystroke that happens between this call and React's commit is respected, never overwritten.
 *
 * ACCEPTED CONSEQUENCE of putting the older words in front rather than refusing to restore: a person who has already
 * retyped the same words sees them twice (older, blank line, newer) and edits one away. The alternative - dropping a turn
 * because the box was not empty - loses words, which is worse; the two are kept in the order they were said.
 */

/** A turn as the composer takes it back. */
interface RestorableTurn {
    text: string;
    attachments?: readonly ChatInputAttachment[];
    recipient: DirectedRecipient | null;
}
/**
 * SEVERAL turns that cannot go - every turn a chat left behind when the person moved on - as the ONE turn the
 * composer takes back (one `restoreTurn` call: the box holds one draft, so a second restore would find the first's
 * words "a newer draft" and drop its own). Texts joined in the order they were said, files together, and the addressee
 * of the first turn that had one. A single turn is itself.
 */
declare function joinRestorableTurns(turns: readonly RestorableTurn[]): RestorableTurn;
declare function restoreTurn(turn: RestorableTurn, composer: {
    /** The composer's text right now (read at call time - a ref, not a render-time capture): decides the addressee only. */
    draft: () => string;
    /** Write the box through an updater (`useComposerDraft().setInput`): the turn's words alone, or in front of what the box holds then. */
    setInput: (next: (current: string) => string) => void;
    restoreAttachments: (files: readonly ChatInputAttachment[]) => void;
    chooseRecipient: (to: DirectedRecipient | null) => void;
}): void;

/**
 * The composer's text as the SEND PATH sees it. A host clears the box as an offer starts and gives the words back
 * if the turn is not kept; "is the box empty?" must answer from what was just written, not from the last render -
 * a read that lags the clear would take the cleared words for a newer draft and not restore them. So every write
 * goes through here: the ref changes synchronously, before React's state does. ONE hook for the web panel, Rovr and
 * the editor chat; none keeps its own copy.
 *
 *  - `draft()` the text right now;
 *  - `setInput(text)` write it (clear, seed), or `setInput(cur => next)` - an UPDATER, computed against what the box holds
 *    when the write lands (`restoreTurn` gives a turn back this way, so a concurrent clear or keystroke is respected). The
 *    ref follows the updater's result at once; the same updater goes to the state setter.
 */
declare function useComposerDraft(input: string, setInput: Dispatch<SetStateAction<string>>): {
    draft: () => string;
    setInput: (next: SetStateAction<string>) => void;
};

/**
 * THE decision every message store makes for a row that carries a key (`eventKey`): a row sent AGAIN under the key
 * it was saved with is the SAME row - the saved one comes back and nothing is written (the server upserts on
 * `(chat, event_key)`; the device stores do the same). Pure: the store supplies how to look a key up and how to
 * write a row; this says which rows are known, which are new, and which repeat an earlier row of the same batch.
 * Used by the device store (`localFirstPersistence.ts`) and both Rovr stores (memory and IndexedDB).
 */
type KeyedSlot<R, M> = 
/** Saved before under this key: return `prior`, write nothing. */
{
    kind: 'known';
    prior: M;
}
/** Not seen: write it (under `key`, when it has one). */
 | {
    kind: 'new';
    row: R;
    key: string | undefined;
}
/** The same key as an EARLIER row of this batch (`of` is that row's index): return that row's result. */
 | {
    kind: 'repeat';
    of: number;
};
declare function slotKeyedRows<R extends {
    eventKey?: string;
}, M>(rows: readonly R[], find: (key: string) => M | undefined): Array<KeyedSlot<R, M>>;

/** How often a running chat re-reads its row (the server caches a chat's spend this long). */
declare const RUN_REFRESH_MS = 30000;
/**
 * THE refresh beat for what a run moves on the chat row (its spend & savings): a counter
 * that bumps when a run SETTLES and every `intervalMs` WHILE it runs — so a long run's
 * spend pill climbs as it goes instead of jumping only at the end — and never ticks
 * while the chat is idle. Hosts re-read the chat when it changes (web, VS Code, Rovr).
 */
declare function useRunRefreshTick(running: boolean, intervalMs?: number): number;

/**
 * "The first message creates the chat" — the ONE implementation. Extracted from the
 * web Brain panel (`useBrainChatStart.ensureChatId`), the editor chat list
 * (`useVsCodeChats.ensureChatId` / `autoTitleChat`) and Rovr's in-flight creation ref,
 * which each kept a copy.
 *
 * What it guarantees:
 *  - **One create per draft.** A second send that arrives while the first message's
 *    chat is still being created JOINS that creation instead of minting a second chat
 *    (and splitting the conversation across two). The creation is the DRAFT TOKEN's: a send
 *    names its token (`ensureChatId(token)`) and gets the creation of THAT token - a late send
 *    of an abandoned draft creates its own chat, and never takes the one a newer draft made.
 *    The in-flight promise is dropped on failure (so a retry creates) and once the host is on
 *    a real chat.
 *  - **An open chat is never re-created.** With `chatId` set, `ensureChatId` resolves
 *    to it.
 *  - **Stable identities.** Both callbacks keep their identity across renders and read
 *    the newest ports through refs — a run captures `ensureChatId` at its start.
 *
 * How the chat is created and named is the HOST's (ports): the web and editor create
 * through `useArmedNewChat().createArmed` (so the armed mode/memory ride the first
 * send), title through `useBrainChats.autoTitle` and record the first prompt through
 * `useBrainChats.captureOriginalRequest`; Rovr creates in its device record.
 * A host without chats (the Creation Canvas) does not mount this at all.
 *
 * Mount it BEFORE the conversation: `ensureChatId` and `onFirstUserTurn` are what
 * `useBrainConversation` takes as options.
 */
interface ChatCreationOptions {
    /** The open chat, or null for a draft the first send must create. */
    chatId: number | null;
    /** Create (and select) the chat; resolves its id, or null when it could not. May throw. */
    create: () => Promise<number | null>;
    /**
     * Optional: name a still-untitled chat from its first user turn. Best-effort, and the
     * port owns its failure: it must not reject (`useBrainChats().autoTitle` keeps the
     * placeholder and re-arms a retry). Omit to leave chats untitled.
     */
    autoTitle?: (chatId: number, firstUserText: string) => Promise<unknown> | void;
    /**
     * Optional: keep the user's FIRST prompt verbatim on the chat (migration 1245) so a
     * chat linked to a ticket still shows the request that produced it — the title is a
     * ~60-char derivation and loses the origin text.
     *
     * Same contract as `autoTitle`, deliberately: it is fired from the same place, in the
     * same turn, so the two can never drift apart, and it is NOT awaited — the first user
     * turn must never wait on, or fail because of, a bookkeeping write. Because nothing
     * awaits it, the port OWNS its failure: it must catch and report its own rejection
     * (as `useBrainChats.captureOriginalRequest` does) — one it lets escape is an
     * unhandled rejection. A host that does not pass it is unaffected.
     */
    onCaptureOriginalRequest?: (chatId: number, text: string) => Promise<void> | void;
}
interface ChatCreation {
    /**
     * The open chat's id, or the one the first send creates. Concurrent calls with the same `draft` token share ONE creation;
     * a call under another draft's token never joins it (and is never joined by it). Without a token (a caller outside the
     * turn door) it is the draft on screen's. Rejects when `create` throws; resolves null when it gave up.
     */
    ensureChatId: (draft?: DraftToken) => Promise<number | null>;
    /** Fire the `autoTitle` port for a chat's first user turn; never rejects. */
    onFirstUserTurn: (chatId: number, firstUserText: string) => Promise<void>;
    /**
     * The draft's binding to its creation (`draftBinding.ts`): the token a send from the draft is minted, the creation started for it
     * resolves or fails it. The turn door reads it (`useChatTurns({ drafts })`) so what is typed while the chat is being created
     * lands in THAT chat, whatever is showing when its id arrives. Stable identity.
     */
    drafts: DraftBinding;
}
declare function useChatCreation({ chatId, create, autoTitle, onCaptureOriginalRequest }: ChatCreationOptions): ChatCreation;

export { ADDRESSED_TO_META_KEY, AGENT_POOL_PATHS, API_VERSION_PROBE_TIMEOUT_MS, API_VERSION_TTL_MS, ASK_USER_TOOL, ASK_USER_TOOL_SPEC, AUTHORED_BY_META_KEY, type AgentDispatchActivity, type AllowanceState, type ArmedNewChat, type ArtifactKind, type AskUserMessageLike, type AskUserOption, type AskUserPayload, type AskUserToolSpec, AttachmentRefusedError, BACK_TO_BACK_AT, BASE_BRANCHES, BRAIN_AGENT_ASSIGNMENTS_PATH, BRAIN_UPLOAD_PATH, BRAIN_UPLOAD_SIGN_PATH, BROWSER_ENGINE_FALLBACK_CONTEXT_TOKENS, BROWSER_ENGINE_MODEL, BUILDERFORCE_PRODUCT_NAME, BfiWorkerEngineOptions, type BrainAction, type BrainActionsContextValue, BrainActionsProvider, BrainChat, type BrainConfig, BrainContextProvider, type BrainContextValue, BrainDiagnostics, BrainMessage, BrainModality, type BrainPageContext, type BrainPersistenceAdapter, type BrainPersonaAgent, type BrainPersonaChoice, BrainProvider, type BrainRestInit, type BrainRestOptions, type BrainRestPersistence, type BrainRestRequest, BrainRunActivity, type BrainRunDriver, type BrainRunEngine, BrainRunPersistence, BrainRunRequest, BrainRunSnapshot, type BrainRuntime, BrainStreamFn, BrainToolSpec, BrainTraceEvent, BrainTransport, type BriefContext, type BrowserEngineProber, type BuildChatDiagnosticsReportInput, CHAT_DIAGNOSTICS_SCHEMA_VERSION, CODE_CHANGE_TOOLS, CONNECT_RETRY_DELAYS_MS, type CachedRead, type ChatActivity, type ChatActivityLabels, type ChatBindingPort, ChatCompletionMessage, type ChatCreation, type ChatCreationOptions, type ChatDiagnosticsAccount, type ChatDiagnosticsData, type ChatDiagnosticsEvermind, type ChatDiagnosticsEvermindHead, type ChatDiagnosticsHistory, type ChatDiagnosticsMessageLike, type ChatDiagnosticsMeter, type ChatDiagnosticsModelSurface, type ChatDiagnosticsPlanSnapshot, type ChatDiagnosticsProvenance, type ChatDiagnosticsReport, type ChatDiagnosticsRun, type ChatDiagnosticsRuns, type ChatDiagnosticsSources, ChatErrorAction, ChatInputAttachment, ChatMode, type ChatModelOptions, type ChatModelSelection, ChatRosterAgent, type ChatStateGet, type ChatTicket, type ChatTurns, type ChatTurnsOptions, type ComposerDirectiveOptions, type ComposingActivity, type ComposingOptions, type ComposingSink, type ConnectRetryOptions, ContentPart, type ContextUsage, type CreatedWorkItemLink, DEFAULT_AGENT_MODEL_SENTINEL, DEFAULT_CHAT_ACTIVITY_LABELS, DEFAULT_CHAT_TITLE, DEFAULT_MODEL_CHOICE_LABELS, DEFAULT_MODEL_FALLBACK_TEMPLATE, DEFAULT_MODEL_IDENTITY, DEFAULT_PERSONA, DEFAULT_ROUTE_THRESHOLD, DEFAULT_TOOL_FAILURE_STREAK, DEFAULT_TOOL_LIMIT, type DirectedGroup, type DirectedRecipient, type DraftBinding, type DraftOutcome, type DraftToken, EMPTY_GATEWAY_MODEL_OPTIONS, Effort, EvermindRunHooks, FAILURE_HARD_AT, FAILURE_NUDGE_AT, FILE_DELIVERY_RULE, FailureTally, type GateReport, type GateRouteStats, type GatewayJsonRequest, type GatewayModelOptions, type GatewayModelSurface, type GitShortStatus, GlobalRunState, HAND_OFF_TOOL, HAND_OFF_TOOL_SPEC, type HandOffOutcome, type HandOffPlan, type HandOffPorts, type HandOffTask, type HandoffFitOptions, HfModelStore, type HostLocalPin, type HostModelStreamInput, INFERENCE_MODES, type IdleWatchdogOptions, type IdleWatchdogReader, type ImageEncodeDecision, type ImagePrepOptions, type IndexedDbStepDurabilityOptions, type InferenceMode, type InlinedAttachments, type KeyedSlot, LOCAL_PICKER_GROUPS, LOCAL_SKIP_CONFIDENCE, LOCAL_SKIP_EXPLORE, LOCAL_WORKSPACE_TOOLS, type LinkedTicketToAdvance, type LocalAttemptFit, type LocalBrainPersistenceOptions, type LocalChatIdentity, type LocalChatMessage, type LocalFetch, type LocalFirstStreamInput, type LocalModelRow, type LocalModelState, type LocalModelStore, type LocalPickerGroup, type LocalPickerView, type LocalRatingVerdict, type LocalStreamRoute, type LocalSuccessContribution, type LocalSuccessFederation, type LocalSuccessFleetHead, type LocalSuccessSnapshot, type LocalSuccessStore, MAX_INLINE_TEXT_BYTES, MAX_TOOL_RESULT_CHARS, MODALITY_PERSONAS, MODEL_CATEGORIES, type McpToolEntry, type McpToolResultInfo, type McpToolStatus, type MentionToken, type MessageProvenance, type MessageRatings, type ModalityPersona, type ModelCategory, type ModelChoiceLabels, type ModelFallbackChannel, type ModelFallbackEvent, type ModelFallbackSurface, type ModelIdentityContext, type ModelItem, NOT_STARTED_TASK_STATUSES, ON_DEVICE_ANSWER_THRESHOLD, type OnDeviceAnswerStore, type OnDeviceStoreScope, PERSONA_MODALITY_IDS, PMO_FOCUS_PARAM, PREVIEW_REVIEW_TOOL, PROJECT_EVERMIND_MODEL_PREFIX, PROVENANCE_META_KEY, type PackForModelInput, type PackForModelResult, PageEngine, type PageEngineSet, type PageEngineSetOptions, type PageRuntimePin, type ParsedXmlToolCall, type PayloadBudget, type PayloadBudgetOptions, type PayloadBudgetStats, type PendingAskUser, type PersistedStep, type PersonaModalityId, type PlaceholderHit, type PoolAgent, type PoolRegisteredAgentRow, type PoolRequest, type PoolWorkforceAgentRow, type PrefetchConfirm, type PreparedImage, ProjectMemoryRequest, type PromptApiAvailability, type PromptApiFactory, type PromptApiMessage, type PromptApiSession, PromptInput, type PromptInputProps, type ProvenanceAccount, type ProviderFailureEvent, type QueuedItem, type QueuedTurns, type QueuedTurnsOptions, READ_FILE_RESULT_CHARS, REVISIT_HARD_AT, REVISIT_NUDGE_AT, RUN_REFRESH_MS, type RatableMessage, type RatedTurnContext, ReadCoverage, type ReadVisit, ReasoningIntent, type RecipientChoice, type RecordAvoidedCallInput, type RestorableTurn, type RouteReport, type RouteRunRecord, type RoutedProduct, RunEndOutcome, type RunEngineControl, RunKey, type RunMilestoneActivity, type RunMilestonePhase, type RunNoteStep, type RunOutcomeValue, RunProgress, type RunSteerMessage, type RunUsageLedger, type RunUsageValue, RunWindowSources, STOPPED_TURN_META_KEY, STOPPED_TURN_STEP, STREAM_IDLE_MS, STUDIO_WORKSPACE_TOOLS, type ScoreBin, type SendContext, SpendSavingsSummary, StaffingSummary, type SteerTurn, type StepDurability, type StepOutgoingMessage, type StoppedTurnSource, StreamChatOptions, StreamChatResult, StreamHandlers, StreamIdleError, type SubagentDiagnosticsInput, type SummaryStreamFn, TICKET_RECORDING_TOOLS, TOOL_ROUTER_DESCRIBE, TOOL_ROUTER_FIND, TOOL_ROUTER_INVOKE, type TicketTag, type TicketToken, type ToolCatalogMatch, type ToolConfirmationGate, type ToolConfirmationGateOptions, type ToolConfirmationPersistence, type ToolSelection, type TrimOptions, type TrimmedToolResult, type TurnInterruption, UNSCOPED_MUTATION_TOOLS, type UnreviewedChangeInput, type UnshippedChangeInput, type UsagePipelineRoute, UsageSurface, type UseBrainChats, type UseBrainChatsOptions, type UseBrainConversation, type UseBrainConversationOptions, type UseMcpExtensionsOptions, WEB_FETCH_TOOL_NAME, type WindowFitTrace, XmlToolCallFilter, activeHashtagToken, activeMentionToken, activeModelKey, activeTicketToken, activityIcon, activityMessageCount, activityTone, agentPersonaChoice, agentPersonaPrompt, allowanceState, announcesUntakenAction, appendRunMessage, applyRemoteRun, artifactRoutePath, asProvenanceAccount, askUserAnchorId, askUserBlock, attemptedPublish, bindChatHistoryForSync, brainPersonaAgents, brainUploadUrl, buildChatDiagnosticsReport, buildComposerDirectives, buildModelItems, byoVendorLabel, callCostOrUnknown, canChangeCodeHere, canReviewInPreview, canRunInParallel, canShipHere, catalogToolNamesMentionedIn, chatActivityText, chatDoorLiveness, chatWorkLinkingDirective, childTaskBrief, claimsMissingToolData, classifyModelFunding, clearRunError, codeChangeFile, codeChangesOf, coerceAskUserPayload, completeLocal, completeLocalFirst, composeEvermindHooks, contextUsageOf, createBrainRestPersistence, createBrowserEngineProber, createComposingActivity, createDraftBinding, createHandoffFit, createHostModelStream, createLocalBrainPersistence, createLocalChatIdentity, createLocalFirstStream, createLocalStream, createLocalSuccessFederation, createModelFallbackChannel, createPageEngineSet, createPayloadBudget, createRunUsageLedger, declinesReview, declinesShipping, defaultInferenceMode, deferredLocalModelStore, deriveChatTitle, describeNetworkError, describeTool, directedAgentRecipients, dirtyPathsOf, displayModelName, drainRunSteering, executeHandOff, extractXmlToolCalls, failureReason, fetchApiVersionVia, fetchMcpToolEntries, filterMentionCandidates, filterModelItems, filterTicketCandidates, findTools, forgetResolvedModels, formatAssistantTranscriptHeading, formatChatDiagnostics, formatChatDiagnosticsReportJson, formatRunProgress, formatSubagentDiagnostics, gateAcceptedSince, gatewayCanChooseModel, gatewayModelIdentity, gatewayModelWindows, gatewayPlanIsPaid, gatewayPlanModels, gatherChatDiagnostics, getGlobalRunState, getLastResolvedModel, getMcpToolStatus, getRunDriver, getRunSnapshot, getRunTrace, handleRouterCall, hasPromptApi, hasWebGPU, inferenceModeForModelPick, installIndexedDbStepDurability, installRunDriver, installStepDurability, invalidateGatewayModelOptions, isActivityMessage, isCodeChangeTool, isCoderReask, isConnectFailure, isConnectedAccountUnused, isDirectedToParticipant, isFallbackFailure, isInferenceMode, isLive, isLocalWorkspaceTool, isMalformedToolCall, isManagerRole, isModelReply, isReadOnlyShellCall, isRepoPublishTool, isRouterTool, isRunning, isStoppedBeforeStart, isStoppedTurn, isTicketRecordingTool, isTruncatedTurn, isUnscopedMutationTool, isUserConfiguredModelRef, joinRestorableTurns, lastServedModel, leftChangeUnreviewed, leftChangeUnshipped, linkedTicketsToAdvance, linkedTicketsToComplete, loadAgentPoolVia, loadBrainPersonaAgentsVia, loadGatewayModelOptions, loadOnDeviceAnswerStore, localFirstApplies, localFirstWorkload, localPickerView, localRatingVerdict, localStorageConfirmationPersistence, localToolsIn, localTransport, mcpActionsFrom, mentionRecipient, modalityPersonaChoice, modelCategoryLabel, modelFallbackText, modelInUse, nextFallbackModel, noteRunStep, onDeviceMemoryHooks, packForModel, pageEnginesFetch, pageRuntimePin, parseAskUser, parseChatActivity, parseDirectedRecipients, parseGitShortStatus, parseHandOff, parseMessageAuthor, parseMessageProvenance, parsePmoFocus, parseStepMessage, perMillionUsd, personaAgentOf, personaModalityOf, personaModel, personaOverlay, personaSystemPrompt, personalitySetpoints, placeholderAdvisory, placeholdersWritten, planMessage, pmoFocusDomId, pmoFocusValue, poolAgentsFrom, prefetchConfirmOf, premiumCostLabel, prepareImageDataUrl, previewReviewDirective, probePageEngines, productForPlan, productModelName, progressDuration, promptApiAvailability, promptApiFactory, promptApiInputQuota, promptApiMeasure, promptStreamDeltas, providerFailureEvent, providerFailureTrace, queueRunSteering, ratedTurnContext, ratedTurnTool, readChatRunHistory, readChatTicketLinks, readWithIdleWatchdog, repeatedFailureAdvisory, resetApiVersionCache, resetBrainRunStore, resetOnDeviceStoresForTests, resolveBrainStream, resolveRecipient, resolveRunConfirm, restoreTurn, retryOnConnectFailure, revealsModelId, revisitAdvisory, routeRunRecords, routerToolSpecs, routingModeForSelection, routingQueryForTurn, runAbortSignal, startRun as runBrainLoop, runOutcomesSince, runProgressVerdict, savePendingPrompt, selectPendingAskUser, selectToolsForTurn, selfReviewShipDirective, serializeAskUser, setLastResolvedModel, setMcpToolStatus, shippedToBaseBranch, signedBrainFileUrl, slotKeyedRows, stableStringify, startEngineRun, startRun, startsRun, steerModelContent, steersByDefault, stepRow, stepSig, stopBeforeStart, stopRun, stoppedBeforeStartRow, stoppedTurnMetadata, streamSummaryCompletion, stripAskUser, studioToolsIn, submitLocalTurnVerdict, subscribeRun, subscribeRunStore, subscribeToChatMessages, summarizeGateRuns, summarizeRouteRuns, takePendingPrompt, ticketsReviewedInPreview, toPromptApiTurn, toolCallArgBytes, toolNamesMentionedIn, toolSchemaTokens, toolSpecsFor, traceWithPersistedSteps, transcriptSeedOf, transportRetryTrace, trimToolResult, turnAffectBlock, turnInterruption, turnOptimizationDirective, unreviewedChangeNudge, unshippedChangeNudge, usageRowsSince, useArmedNewChat, useBrainActions, useBrainChats, useBrainConfig, useBrainContext, useBrainConversation, useChatCreation, useChatTurns, useComposerDraft, useMcpExtensions, useOptionalBrainContext, useQueuedTurns, useRegisterBrainActions, useRunRefreshTick, useRunSnapshot, useToolConfirmationGate, utf8ByteLength, webStorageLocalSuccessStore, withAdvisory, withDirectedMetadata, withObservedModel, withProvenanceMetadata, withRating, withReadyPageModels, withRunUsage, withUsageSurface, workItemLinkFromCreate };
