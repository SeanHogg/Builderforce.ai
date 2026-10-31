import * as react from 'react';
import { ReactNode, Dispatch, SetStateAction } from 'react';
import { G as GateOutcome, C as ChatCompletionMessage, B as BrainTraceEvent, a as BrainMessage, b as BrainRunActivity, R as RunTurn, c as BrainRunRequest, d as BrainRunSnapshot, e as RunKnowledgeState, f as RunOutcomeRow, g as RunKey, h as GlobalRunState, i as BrainRunPersistence, j as BrainTransport, k as BrainChat, l as ChatInputAttachment, m as BrainStreamFn, S as SpendSavingsSummary, n as RunEndOutcome, o as CompletionUsage, L as LocalFirstAccount, p as StreamChatOptions, q as StreamHandlers, r as StreamChatResult, s as LocalFirstAttemptRecord, t as LocalFirstAttempt, u as LocalFirstWorkload, P as ProjectMemoryRequest, E as Effort, v as EvermindRunHooks, w as BrainToolSpec, x as BrainModality, y as ChatMode, z as RunWindowSources, A as ReasoningIntent, D as ChatRosterAgent, F as RunEngineId, H as ContentPart, I as CompletionMetadata, J as RunProgress, K as BrainDiagnostics, M as StaffingSummary, U as UsageSurface } from './pendingWords-B_dk9oAp.js';
export { N as AnswerOriginCost, O as AssembledToolCall, Q as AvoidedRunCall, T as BrainDiagnosticsContext, V as BrainRunOutcome, W as BrainRunPhase, X as BuildBrainTriageOptions, Y as ByoUnresolvedEntry, Z as CHAT_MODES, _ as CHAT_MODE_ICON, $ as ChatWorkDirectiveOptions, a0 as DispatchRefusal, a1 as EffortProfile, a2 as EvermindLearnOutcome, a3 as EvermindLearnTarget, a4 as ImageUrlContentPart, a5 as LocalFirstAttemptSummary, a6 as MAX_STOP_HOOK_ROUNDS, a7 as MemoryAnswerOptions, a8 as MemoryFirstAnswer, a9 as MemorySurface, aa as ModelPreflightResult, ab as ModelScore, ac as ModelTurn, ad as ModelWindowSources, ae as NEW_CHAT_MODE, af as PersonaSubagent, ag as PrefetchResult, ah as RESTING_CHAT_MODE, ai as ReasoningLevel, aj as RepeatStreak, ak as RepeatedTarget, al as RepetitionLoopError, am as RunLineage, an as RunOutcomeReport, ao as RunPipelineSettings, ap as RunStageModels, aq as RunStopHook, ar as RunStopInput, as as STEP_MESSAGE_ROLE, at as SUBAGENT_OF_META_KEY, au as SavingsBreakdown, av as SavingsBySource, aw as SavingsSourceKey, ax as ServedRead, ay as SpendBreakdown, az as StreamInterruptedError, aA as SubagentOrigin, aB as TextContentPart, aC as ToolExposure, aD as TransportError, aE as UNBACKED_TICKET_CLAIM_NOTICE, aF as UNBACKED_WRITE_CLAIM_NOTICE, aG as USAGE_SURFACES, aH as USAGE_SURFACE_HEADER, aI as UpstreamTurnEvidence, aJ as accountUsedInTrace, aK as activityTarget, aL as askStopHook, aM as attachEvermindLearn, aN as buildBrainTriageReport, aO as byoReasonHint, aP as byoUnresolvedInTrace, aQ as byoUnresolvedSummary, aR as chatConversationDirective, aS as chatModeDirective, aT as chatRosterFromParticipants, aU as chatWorkDirective, aV as clearPendingWords, aW as computeBrainDiagnostics, aX as computeRunProgress, aY as contextWindowOf, aZ as describeLiveStep, a_ as detectAnnouncedButUnmadeToolCall, a$ as detectUnbackedTicketClaim, b0 as detectUnbackedWriteClaim, b1 as effortProfile, b2 as formatBrainDiagnostics, b3 as formatBrainProvenance, b4 as formatBytes, b5 as formatDispatchRefusals, b6 as formatEvermindLearnStep, b7 as formatModelScorecard, b8 as formatModelTurnLog, b9 as formatStaffingSummary, ba as hasEditIntent, bb as isChatMode, bc as isDispatchTool, bd as isEffort, be as isEvermindModel, bf as isFailedToolResult, bg as isMutationTool, bh as isStepMessage, bi as isTicketWriteTool, bj as isUsageSurface, bk as localFallbackTrace, bl as midRunNotice, bm as modelFailoversInTrace, bn as modelScorecard, bo as modelTurnLog, bp as modelsUsedInTrace, bq as narratedUnadvertisedInTrace, br as normalizeChatMode, bs as parseByoUnresolved, bt as parseSubagentOrigin, bu as projectMemoryHooks, bv as reasoningForRun, bw as resolveContextWindow, bx as savedChatOf, by as serverChatIdOf, bz as setPendingWordsOwner, bA as shortenTarget, bB as staffingSummaryInTrace, bC as stallRecoveriesInTrace, bD as stallUnrecoveredInTrace, bE as streamChatCompletion, bF as summarizeLocalFirstAttempt, bG as toolActivity, bH as toolExposureInTrace, bI as workFiledNotStaffedVerdict } from './pendingWords-B_dk9oAp.js';
import { CompactMemo, SummaryCompletion } from '@seanhogg/builderforce-memory/working';
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
/** The persisted form: `[key, visit]` pairs, insertion order. */
type VisitTallyState = Array<[string, ReadVisit]>;
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

/** Per path, the run's successful changes in order: `w:<hash>` or `e:<old>><new>`. */
type EditRevertState = Array<[string, string[]]>;

interface NoProgressState {
    seen: string[];
    idleTurns: number;
    /** The last check/test result digest, so an unchanged re-run is not progress. */
    lastCheck?: string;
}

interface UnkeptClaimState {
    unkept: number;
}

/**
 * THE progress detector (cost PRD A3): the guards above, composed into one per-run
 * judgement — is this run still converging, and if not, what happens next?
 *
 * It watches five shapes of a stuck run, strongest first:
 *  - `edit_revert` — a change that puts a file back the way it was ({@link EditRevertTracker});
 *  - `repeated_failure` — the identical call failing {@link FAILURE_HARD_AT} times ({@link FailureTally});
 *  - `circling_read` — one target read {@link REVISIT_HARD_AT} times with nothing changing it ({@link VisitTally});
 *  - `unkept_ready` — {@link UNKEPT_READY_AT} turns that said the run had what it needed, then only read ({@link UnkeptClaimTracker});
 *  - `no_progress` — {@link NO_PROGRESS_TURNS} turns with no new file and no test change ({@link NoProgressTracker}).
 *
 * A turn that showed any of them is a TRIP, and trips escalate: the first is a steer
 * (a note the host shows the model on its next turn), the second asks the host to move
 * the run up one model tier, the third asks it to pause the run for a human. After a
 * trip the windows start over, so one stuck stretch is one trip, not one per turn.
 *
 * Pure and host-agnostic: the host says which calls only read and which mutate
 * unscoped. Its state is plain JSON, so the cloud durable loop — one model turn per
 * tick — carries it in its loop state and every tick judges the whole run.
 */

type ProgressSignalKind = "edit_revert" | "repeated_failure" | "circling_read" | "unkept_ready" | "no_progress";
interface ProgressDetectorState {
    visits?: VisitTallyState;
    failures?: FailureTallyState;
    edits?: EditRevertState;
    progress?: NoProgressState;
    claims?: UnkeptClaimState;
    /** Trips so far this run. */
    trips?: number;
    /** Trips so far this run, by the signal that caused each (run telemetry, PRD 35 §8.2). */
    tripsBySignal?: Partial<Record<ProgressSignalKind, number>>;
    /** Turns this run that claimed readiness and then only read — every one, never reset
     *  by a trip (the claim tracker's own count is the CURRENT streak). */
    unkeptTurns?: number;
    /** The steer the NEXT turn shows the model, until that turn ends. */
    steer?: string;
}

/**
 * Consecutive identical calls ({@link callFingerprint}) at which a back-to-back streak
 * becomes a verdict on its own. Two in a row is a retry; three is the model asking the
 * same question a third time after hearing the same answer twice, whatever the rest of
 * the run looks like. Shared by the post-hoc run report and the live guards.
 */
declare const BACK_TO_BACK_AT = 3;

interface ReadsWithoutSpawnState {
    /** Read calls since the run started, while no spawn had been attempted. */
    reads: number;
    /** A spawn was attempted — the counter stops for the rest of the run. */
    spawned: boolean;
    /** The nudge was given — it fires once per run. */
    nudged: boolean;
}

/**
 * Symbol extraction — "what does this file DEFINE, and on which line" — for every
 * surface that needs a code map without reading whole files.
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────────────
 * An agent that wants one function out of a 5,000-line service file had exactly two
 * moves: `search_code` for the name (a list of every line that MENTIONS it — calls,
 * imports and comments included) or `read_file` in 2,000-line windows. Measured on a
 * VS Code Brain run: one 153 KB service read twelve times and searched six more, 31%
 * of the run's calls revisiting ground it had already covered. A definition index —
 * name → file:line — answers "where is X defined" in one call, and a file OUTLINE
 * turns "page through the file" into "jump to line N".
 *
 * Three copies of this idea had grown apart: the creation canvas's `exportedSymbols`
 * (JS/TS exports only), the on-prem semantic searcher's `ssExtractSymbols` (names only,
 * no lines), and nothing at all in the editor. This is the one extractor all of them
 * read, so "what counts as a symbol" has one answer.
 *
 * Heuristic, line-anchored regexes — deliberately NOT a parser: it must run in the
 * Worker, the browser and Node with zero dependencies, over any language, and a
 * missed or spurious symbol costs one extra read, never a wrong edit. Pure: no I/O.
 */
/** What a definition is. `heading` is a Markdown section, `table` a SQL object. */
type SymbolKind = "function" | "method" | "class" | "interface" | "type" | "enum" | "const" | "struct" | "trait" | "module" | "table" | "heading";

/**
 * Model roles — WHAT KIND OF CALL this is, so routing can pick a model suited to the
 * work instead of one global provider order for every call.
 *
 * A closed set of CALL-PURPOSE tags, orthogonal to the arc stage (idea/make/run/
 * measure/reach) a canvas session reports: a role changes within a single run — a
 * coding agent that delegates a read-only investigation is still one "make"-stage
 * session, but the delegated call is `explore`, not `code`.
 *
 * Lives in this zero-dependency package because every surface that declares
 * `spawn_agent` (the cloud engine, the extension host) needs the SAME vocabulary. The
 * api adds the objective each role implies on top (`api/src/application/llm/modelRoles.ts`).
 */
type ModelRole = "plan" | "code" | "verify" | "explore" | "chat" | "utility";

/**
 * The shell's per-call options and its BACKGROUND job shapes — split from
 * `capabilities.ts` (already the whole capability catalog) because they are one
 * subsystem: Stop reaching the process (`signal`), and a long command that runs on
 * while the agent keeps working (`start` → `poll` → `kill`).
 */
interface ShellRunOptions {
    /**
     * The directory the command runs in: a WORKSPACE-RELATIVE path, already validated by the
     * tool (no `..`, not absolute, no shell metacharacters). The host spawns the command with
     * that working directory — the command text is never prefixed with a `cd`, because `cd X &&
     * cmd` is not one language (Windows PowerShell 5.1 cannot parse `&&`). Omitted ⇒ the
     * workspace root. A host whose transport cannot take a working directory scopes the command
     * itself, behind its own adapter.
     */
    cwd?: string;
    /**
     * The run's (or the step's) cancel signal. Aborting it kills the command — its whole
     * process tree — and the result comes back `{ ok: false, aborted: true }`. A shell that
     * cannot kill simply finishes; the caller still drops the late result.
     */
    signal?: AbortSignal;
}
/** A background job's state as `poll` / `kill` report it. */
interface ShellJobStatus {
    ok: boolean;
    id: string;
    status: "running" | "exited" | "killed" | "unknown";
    exitCode?: number;
    /** The tail of the combined stdout/stderr, bounded by the shell. */
    output?: string;
    /** True when earlier output was dropped from the bounded buffer. */
    truncated?: boolean;
    error?: string;
}
interface ShellJobStart {
    ok: boolean;
    id?: string;
    error?: string;
}

/**
 * The `local.research` capability — a LOCAL model on the developer's machine that reads
 * files and answers the paid model's question about them (`local_research`).
 *
 * The surface owns everything machine-specific: which local runtime serves (the hybrid
 * local tier — Synapse native first, Ollama last), how a file is fingerprinted, and where
 * the answer cache persists. The tool (`local-research-tool.ts`) owns the policy: which
 * files to read, the excerpt budget, the time limit, and the cache key. Runtime-agnostic.
 */
/** One message the local model is sent. */
interface LocalResearchMessage {
    role: "system" | "user";
    content: string;
}
/** What a cached answer is valid for: a file's identity at the moment it was read. */
interface ResearchFileFingerprint {
    path: string;
    mtimeMs: number;
    size: number;
}
/** The surface's answer cache (persisted, bounded). Keys are opaque to the store. */
interface ResearchAnswerStore {
    get(key: string): Promise<string | undefined>;
    set(key: string, answer: string): Promise<void>;
}
interface LocalResearchCapability {
    /** One non-streaming completion on a LOCAL model only — never the gateway. Throws when
     *  nothing on this machine can serve, or on `signal`. */
    complete(messages: readonly LocalResearchMessage[], signal: AbortSignal): Promise<string>;
    /** mtime + size per readable file; a path that is missing or not a file is omitted. */
    fingerprint(paths: readonly string[]): Promise<ResearchFileFingerprint[]>;
    /** The answer cache. Absent ⇒ every call asks the model. */
    readonly cache?: ResearchAnswerStore;
    /** Wall-clock budget for the model call (default in the tool). */
    readonly timeLimitMs?: number;
}

/**
 * Runtime capabilities — the contract between a surface (where an agent runs) and
 * the tools it can offer.
 *
 * A {@link ToolDefinition} declares which capabilities it `requires`; a surface
 * (cloud Worker, cloud Container, on-prem Node) supplies a {@link CapabilityProvider}
 * that advertises which capabilities it can actually back. The {@link ToolRegistry}
 * offers a tool to a surface ONLY when that surface advertises every capability the
 * tool needs — so a tool set is never hand-maintained per surface, and surfaces
 * differ only by *what they can physically do*, never by a curated allow-list.
 *
 * **Capability gating vs. authorization policy are ORTHOGONAL LAYERS (not competing
 * models).** A `Capability` answers "can this SURFACE physically perform this op" (no
 * shell in a Worker → no `shell` cap). It is NOT an authorization decision. On-prem
 * additionally runs an authorization PIPELINE (owner-only / subagent-depth / group /
 * profile allow-lists) that answers "is THIS caller allowed to use this tool here."
 * The convergence (PRD 12) keeps BOTH as layers: a tool gains `requires: Capability[]`
 * for physical backing, while the surface keeps applying its policy pipeline as a
 * decorator on top. They never merge — capability is about the machine, policy is
 * about the caller — so adopting the shared contract on-prem loses no authorization.
 *
 * This module is deliberately runtime-agnostic: no `node:*`, no Cloudflare `Env`,
 * no `pi-agent-core`. It is imported verbatim by both the Cloudflare Worker `api`
 * package and the Node `agent-runtime` package, so it must type-check and bundle
 * under both `moduleResolution: bundler` and `NodeNext`.
 */

/**
 * The set of capabilities a tool can require / a surface can provide. Adding a new
 * capability here is the ONLY place a new class of tool↔surface gating is declared
 * (Open/Closed: register a tool against an existing capability without editing any
 * dispatch switch).
 */
type Capability = 
/** List + read the working tree. */
"repo.read"
/** Indexed code search across the whole tree. A DISTINCT capability from read:
 *  a surface with a real shell (the Container) greps natively and intentionally
 *  does not back the indexed searcher, so this gates `search_code` separately. */
 | "repo.search"
/** A DEFINITION index over the tree — symbol name → file:line — backing `find_symbol`
 *  and `file_outline`. Separate from `repo.search` because it needs a maintained index
 *  (a surface on a real disk keeps one warm; a git-over-HTTP surface has none), and a
 *  surface that cannot back it must not advertise tools that promise "one instant call". */
 | "repo.symbols"
/** Semantic code search and repo mapping — powered by a local embeddings index (a warm
 *  local index: Builderforce Desktop). Distinct from `repo.search` because it answers
 *  questions phrased in words ("where do we enforce plan limits?") by meaning, not
 *  exact substring. */
 | "repo.semantic"
/** LLMLingua-2 compression of prose (`read_compressed`). Split from `repo.semantic`
 *  because the service backs it only when built with the compressor, which its health
 *  probe reports — a surface advertises it only while `semantic.compress` is present. */
 | "repo.compress"
/** A LOCAL model on this machine that reads files and answers a question about them
 *  (`local_research`) — free tokens beside the paid model. Backed by
 *  {@link LocalResearchCapability}; advertised only while a local runtime can serve. */
 | "local.research"
/** Create / update whole files in the working tree (committed or on disk). */
 | "repo.write"
/** Surgical in-place string edits. Separate from write so a surface can offer whole
 *  -file writes without the edit op (e.g. the container image, which only commits). */
 | "repo.edit"
/** Delete files from the working tree. Separate from write so a surface can offer
 *  write without delete (e.g. a container image that implements commit but not rm). */
 | "repo.delete"
/** Run a real shell command in the checked-out repo (only true Linux processes). */
 | "shell"
/** BACKGROUND shell jobs (`ShellCapability.start` / `poll` / `kill`): `command_status`
 *  and `command_stop`. Separate from `shell` so a surface whose shell runs only in the
 *  foreground never advertises two tools it cannot back. */
 | "shell.jobs"
/**
 * PUBLISH work from the checked-out repo: commit, push, open a pull request.
 *
 * Split from `shell` even though it is implemented with one, because the two answer
 * different questions. `shell` asks "is there a process that can run a command"; this
 * asks "may this surface move work out of the working tree and onto a remote" — a
 * governance question with a different answer per surface, and one whose blast radius
 * ends at someone else's `main` rather than at the run.
 *
 * The CLOUD surfaces deliberately do NOT back it. They already publish, by a different
 * mechanism: a durable-surface write IS a commit (the provider returns a `commitUrl`)
 * and `cloudAgentEngine` opens the pull request when the run finishes. Advertising
 * these tools there would offer a second, unimplemented route to the same act — and
 * because the container derives its schema from its capabilities, a tool its image has
 * no handler for 400s mid-run.
 */
 | "git.write"
/** Manage long-lived background processes spawned by `shell`. */
 | "process"
/** Statically validate written config (JSON/YAML) WITHOUT a shell. */
 | "static-check"
/** Escalate to a human and block until answered (approval / question / feedback). */
 | "human"
/**
 * Record a change on the TICKET'S PRD — the shared spec every agent on the ticket
 * reads. Separate from `repo.write` because it is not a file write: the PRD lives in
 * the platform's spec store (and is mirrored onto the ticket branch by the surface),
 * so a surface backs this only when it can reach that store. A surface that hands the
 * agent a PRD in its prompt but cannot back this leaves the agent able to READ the
 * shared spec and unable to correct it.
 */
 | "prd.write"
/** Persist / recall cross-run knowledge (memory, handoff, project knowledge). */
 | "memory"
/** Authoritatively DELETE a stored memory entry. Split from `memory` for the same
 *  reason `web.search` is split from `web`: a surface can back recall/remember
 *  without a real erase (the on-prem SSM store SUPERSEDES a belief rather than
 *  deleting it), so a surface advertises this only when `forget` truly removes. */
 | "memory.forget"
/** Claim shared resources and read/write the run's shared workspace, so concurrent
 *  agents on one ticket can serialize conflicting work instead of clobbering it. */
 | "coordinate"
/** Fetch a known URL's content. */
 | "web"
/** Search the public web (needs a search backend; separate from plain fetch). */
 | "web.search"
/** Delegate part of the task to a SUB-AGENT: a child run with its own isolated
 *  transcript that reports back only its answer. Backed by
 *  {@link OrchestrationCapability}; the surface decides whether it can afford a
 *  nested run at all (a per-tick durable surface and a long-lived container do
 *  not answer that the same way), which is why this is a capability and not a
 *  tool everyone gets. */
 | "orchestrate"
/** Run SEVERAL sub-agents side by side (`spawn_agents`) on the `orchestrate` backing.
 *  Its own capability because "can run a child" does not imply "can run four at
 *  once in one tree": that also needs scoped writers and serialized commits, which a
 *  surface backs or does not. The editor runs its own fan-out outside the registry. */
 | "orchestrate.fanout"
/** The surface runs its children IN THE BACKGROUND: `spawn` returns a handle at once,
 *  the parent keeps working, and it can wait for, redirect and stop its children
 *  (`wait_agents` / `message_agent` / `stop_agent`). Backed by
 *  {@link OrchestrationCapability.live}. A surface that runs a child inside the spawn
 *  call (the images) does not grant it. */
 | "orchestrate.live"
/** Send messages on a docked channel (Slack/Discord/Telegram/…). */
 | "message"
/** Render / generate media (image, tts, canvas). */
 | "media"
/** Propose a reusable SKILL from what this run learned. Distinct from `memory`:
 *  a memory is a fact the agent recalls, a skill is a PROCEDURE another agent
 *  follows, and it reaches other runs only after a human approves it. */
 | "skill.author";
/** A capability-scoped service. Each concrete capability interface extends this so
 *  the registry can reason about providers uniformly. Marker only — no members. */
/** List/read/search the working tree. Backed by git-over-HTTP (cloud) or disk (Node). */
interface RepoReadCapability {
    /** List working-tree files. `subdir` scopes to a folder; `glob` filters by name
     *  (e.g. `ROADMAP.md`, `**\/*.test.ts`) — case-insensitive, and a slash-free glob
     *  matches the basename at any depth. A `glob` also bypasses the big-repo directory
     *  summary so a matched file is always returned in full. */
    listFiles(subdir?: string, glob?: string): Promise<RepoListResult>;
    readFile(path: string): Promise<RepoReadResult>;
    /** Search the tree for `query`. Pass `scope` (a repo-relative subdirectory) to
     *  restrict the search — essential on a large monorepo where an unscoped walk can
     *  be truncated before it reaches the relevant subtree. `opts.signal` stops this one
     *  search (a caller's deadline or the run's Stop): a surface that spawns a searcher
     *  kills it. */
    searchCode(query: string, scope?: string, opts?: {
        signal?: AbortSignal;
    }): Promise<RepoSearchResult>;
}
/** Look up where symbols are DEFINED (capability `repo.symbols`). The surface owns the
 *  index — how it is built, kept fresh and persisted; the tool only asks it. */
interface RepoSymbolsCapability {
    /** Definitions whose name matches `query` (case-insensitive; exact matches first).
     *  `scope` narrows to a repo-relative subdirectory, `kind` to one {@link SymbolKind}. */
    find(query: string, opts?: {
        scope?: string;
        kind?: SymbolKind;
        limit?: number;
    }): Promise<SymbolFindResult>;
}
/** Semantic code search and repo mapping (capability `repo.semantic`). Powered by a local
 *  embeddings index — the surface owns the index and its persistence; the tool only asks it.
 *  Distinct from `repo.search` because it answers questions phrased in words by meaning. */
interface RepoSemanticCapability {
    /** Search code by MEANING, not exact substring. Returns whole functions/classes ranked
     *  by identifier-aware keyword match plus local embeddings. */
    search(query: string, opts?: {
        scope?: string;
        limit?: number;
    }): Promise<SemanticSearchResult>;
    /** Get the repository's shape: files ordered by how much the rest of the code depends on
     *  them, each with its most-referenced definitions. */
    repoMap(opts?: {
        focus?: string[];
        maxTokens?: number;
        query?: string;
    }): Promise<RepoMapResult>;
    /** LLMLingua-2 token compression of large prose (PRD C8). Present only when the backing
     *  service reports the compress feature — callers feature-detect, never assume it.
     *  `rate` is the share of tokens to keep (0..1). Code fences, paths and numbers are
     *  never altered by the service. Gate use on cost lever `c8_token_compression`. */
    compress?(text: string, rate: number): Promise<CompressResult>;
    /** The host's cost-lever C4 decision (`isCostLeverOn(env, "c4_adaptive_context", tenantId)`).
     *  When true, `semantic_search` without an explicit `limit` sends only as many hits as
     *  {@link chooseK} judges the score distribution needs. Absent/false = the fixed default. */
    readonly adaptive?: boolean;
}
/** Mutate the working tree. The provider owns the side effects of a write —
 *  commit/disk-write AND the run bookkeeping (tracking written paths, recording a
 *  file-change event) — so a tool stays a thin schema + result shaper. */
interface RepoWriteCapability {
    writeFile(path: string, content: string, summary?: string): Promise<RepoWriteResult>;
    deleteFile(path: string, reason?: string): Promise<RepoDeleteResult>;
    /** In-place edit: replace `oldString` with `newString` in an existing file
     *  (surgical change, no full rewrite). `replaceAll` replaces every occurrence;
     *  otherwise `oldString` must be unique. Shares the same bookkeeping as writeFile. */
    editFile(path: string, oldString: string, newString: string, replaceAll?: boolean): Promise<RepoEditResult>;
}
/** Fetch / search the public web. The two halves are still gated SEPARATELY — `fetch`
 *  by capability `web`, `search` by `web.search` — because they need different
 *  backings: fetching a known URL is just an HTTP client, while search needs a
 *  search-engine vendor. `search` stays OPTIONAL for surfaces that wire no vendor at
 *  all (the registry then never surfaces `web_search`); the cloud surface always wires
 *  one, because a keyless encyclopedic vendor is the floor beneath every BYO key. */
interface WebCapability {
    fetch(url: string): Promise<WebFetchResult>;
    search?(query: string): Promise<WebSearchResult>;
}
/** Run a real shell command. Present only on surfaces with a true process (the
 *  cloud Container, on-prem Node) — never on the bare Worker/DO. */
interface ShellCapability {
    run(command: string, opts?: ShellRunOptions): Promise<ShellResult>;
    /**
     * The run's default checkout, when the workspace root CONTAINS checkouts rather than
     * being one — resolved once per run by the surface (`resolveDefaultRepo`). Set ⇒ the
     * git tools retry there before naming candidates, and `run_command` runs there.
     */
    defaultRepo?: string;
    /** Start a BACKGROUND job (`run_command` `background` / `yieldMs`). Omitted ⇒ the
     *  surface runs everything in the foreground. The job is the RUN's, not the step's: it
     *  outlives an interrupted wait, and the surface kills it when the run settles. */
    start?(command: string, opts?: ShellRunOptions): Promise<ShellJobStart>;
    /** A background job's state, waiting up to `waitMs` for it to finish first. Aborting
     *  `signal` ends the WAIT early (the status so far); the job itself runs on. */
    poll?(id: string, opts?: {
        waitMs?: number;
        signal?: AbortSignal;
    }): Promise<ShellJobStatus>;
    /** Kill a background job (its process tree). */
    kill?(id: string): Promise<ShellJobStatus>;
    /**
     * The remote ticket branch this shell's clone mirrors, when the SURFACE owns that
     * branch rather than the clone (a cloud run commits through its git provider; the
     * sandbox clone only follows). Set ⇒ the history-moving git verbs (`sync_latest`,
     * `undo`, `redo`) first absorb the branch (fast-forward) and then publish to it, so
     * a rewind or merge reaches the pull request. Unset (the editor, on-prem) ⇒ the clone
     * IS the source of truth and the commands are unchanged.
     */
    trackedBranch?: string;
}
/** Static, shell-free validation of written config files. */
interface StaticCheckCapability {
    verify(): Promise<StaticCheckResult>;
}
/** Human-in-the-loop. Returns a marker the engine uses to PAUSE the run; the answer
 *  arrives on resume, so this never blocks the loop in-process on the cloud. */
interface HumanCapability {
    ask(question: string, context?: string): Promise<HumanAskResult>;
}
/**
 * Write to the ticket's PRD (capability `prd.write`).
 *
 * The run is handed its ticket's PRD as context, so the agent knows the spec; without
 * this it cannot record a decision it made or correct a section it discovered was
 * wrong, and the next run re-derives (or repeats) the same mistake.
 *
 * TWO verbs, not one, because they are different acts on the document:
 *   • `append`      — add a dated, signed revision block at the end. Additive; nothing
 *     already written can be lost. This is the "I decided X / I found Y" verb.
 *   • `editSection` — replace the BODY of one named `## Heading` section. Destructive
 *     within that section only, which is why it names the section and refuses when the
 *     heading does not exist (returning the headings that do) rather than guessing.
 *
 * The surface — never the model — decides WHICH ticket's PRD is written and how the
 * change is attributed and mirrored, exactly as `memory` resolves its own scope.
 */
interface PrdWriteCapability {
    /** Append a dated, attributed revision block to the ticket's PRD. */
    append(note: string): Promise<PrdUpdateResult>;
    /** Replace the body of the `## <heading>` section. Fails (never throws) with the
     *  available headings when `heading` names no section. */
    editSection(heading: string, body: string): Promise<PrdUpdateResult>;
}
/**
 * Propose a SKILL — a reusable procedure — from what a run just did (capability
 * `skill.author`).
 *
 * A run that produced graded proof has, by definition, executed a procedure that
 * worked. Nothing in the product could turn that into something the next agent
 * follows: every skill write path was human-gated, so the only way a procedure
 * spread was a person writing it down. This is the agent's half of that loop, and
 * it stops at a DRAFT on purpose — an agent proposes, a human approves, and only
 * an approved skill is injected into anyone's prompt. The surface stamps the
 * workspace, the project and the authoring run; the model supplies only the
 * procedure, exactly as `memory` lets it narrow a scope but never choose an owner.
 */
interface SkillAuthoringCapability {
    /** Draft a skill for review. Re-using a slug revises that draft, never an
     *  approved skill — an approved procedure changes only through a human. */
    propose(input: SkillProposal): Promise<SkillProposalResult>;
    /** The skills already available to this run (approved) or awaiting review, so a
     *  run can revise its own draft rather than proposing a near-duplicate. */
    list(): Promise<SkillListResult>;
}
/** What an agent proposes as a skill. */
interface SkillProposal {
    /** Stable, kebab-case identifier — reusing it revises this workspace's draft. */
    slug: string;
    /** Short human title, e.g. "Ship a schema change end to end". */
    name: string;
    /** One line saying WHEN to use it — this is what a future agent matches on. */
    description: string;
    /** The procedure itself, as Markdown: steps, commands, and what "done" looks like. */
    body: string;
    /** Evidence the procedure worked, e.g. the graded proof or the merged PR. */
    evidence?: string;
}
interface SkillProposalResult {
    ok: boolean;
    slug?: string;
    /** 'created' for a new draft, 'revised' when an existing draft was rewritten. */
    outcome?: "created" | "revised";
    error?: string;
}
interface SkillListResult {
    ok: boolean;
    skills?: Array<{
        slug: string;
        name: string;
        description: string;
        status: "draft" | "approved" | "rejected";
    }>;
    error?: string;
}
/**
 * Delegate a slice of the task to a SUB-AGENT (capability `orchestrate`).
 *
 * The child runs the same kernel against the same surface backing, but on its OWN
 * transcript: the parent sends one instruction and receives one answer, so a long
 * search that would otherwise fill the parent's window with dead ends costs it a
 * paragraph. That context isolation is the whole point — a child that shared the
 * parent's messages would be a more expensive way to take another turn.
 *
 * Depth is the surface's business, not the tool's: an implementation withholds
 * `orchestrate` from the capability set it hands the child, so a child cannot spawn
 * and recursion is impossible by construction rather than by a counter.
 */
interface OrchestrationCapability {
    spawn(input: SubagentRequest): Promise<SubagentResult>;
    /** Present when children run in the background (capability `orchestrate.live`). */
    live?: LiveChildControls;
}
/**
 * An owner's verbs for children it is NOT blocked on. A child's report reaches its owner
 * exactly once — returned by a `wait` that is waiting for it, or else delivered to the
 * owner as a message before its next turn — so `wait` is only for an owner that cannot
 * go on without the result.
 */
interface LiveChildControls {
    /** Until the named (or all live) children settle, or the timeout. */
    wait(handles: readonly string[], timeoutMs: number, signal?: AbortSignal): Promise<LiveWaitResult>;
    /** Put direction in front of a running child's next turn. */
    message(handle: string, text: string): Promise<{
        ok: true;
    } | {
        ok: false;
        error: string;
    }>;
    /** Stop children by handle, or every live one. Returns the handles stopped. */
    stop(handles: readonly string[] | "all"): Promise<string[]>;
}
interface LiveWaitResult {
    /** Reports collected by this wait (each reaches the owner only once). */
    reports: ChildReportLike[];
    /** Handles still running at the timeout. */
    running: string[];
    /** What the owner should know about this wait — that its reports arrive as messages
     *  instead, or that the person interrupted it. */
    note?: string;
}
/** A finished child, as its owner reads it. */
interface ChildReportLike {
    handle: string;
    /** Who did the slice — the agent it ran as, or the plain sub-agent's label. */
    name: string;
    state: "done" | "failed" | "stopped";
    label: string;
    output: string;
    ticket?: string;
    changedFiles?: string[];
    /** What the child's report left for its owner (`parseSubagentReport` in agent-loop). */
    openIssues?: string[];
}
/** What the parent asks a sub-agent to do. */
interface SubagentRequest {
    /** Short label for the timeline, e.g. "find the auth middleware". */
    label: string;
    /** The child's ENTIRE brief. It sees none of the parent's conversation, so this
     *  must carry every fact the child needs. */
    task: string;
    /** What KIND of call the child's turns are — lets the surface pick a model suited
     *  to the delegated work (e.g. a cheap reader for `explore`) instead of pinning
     *  the child to whatever the parent happens to be running as. The default is applied
     *  by the tool itself before this ever reaches the capability. The child is a clone of
     *  its parent either way: the role routes its model, never what it may do. */
    role?: ModelRole;
    /**
     * Run the child AS one of the WORKSPACE's agents — an agent id or its name ("Ada").
     *
     * A delegation without this is an anonymous helper with the surface's generic
     * instructions. With it, the child adopts that agent's role, bio, skills and
     * personality, so the slice is done by the teammate whose job it actually is. The
     * surface resolves the ref; an unknown one comes back as `{ok:false}` for the parent's
     * model to read, never as a silently anonymous child wearing the wrong name.
     */
    asAgent?: string;
    /** The ticket this child delivers — echoed on the result and in its chat report. */
    ticket?: string;
    /** Cap on the child's answer — a fan-out shares one result between its children. */
    outputChars?: number;
}
interface SubagentResult {
    ok: boolean;
    /** The child's final answer — what the parent asked for, and all it receives. */
    output?: string;
    /** Turns the child spent, so the parent can see what the delegation cost. */
    steps?: number;
    /** True when the child hit its step budget before answering: `output` is then its
     *  last word rather than a conclusion, and the parent should treat it as partial. */
    truncated?: boolean;
    /** WHO the child ran as, echoed back when `asAgent` resolved. The parent asked for
     *  "Ada" and this says which agent that turned out to be, so the answer can be
     *  attributed to a real teammate rather than to the string the parent guessed. */
    asAgent?: {
        ref: string;
        name: string;
    };
    /** Set when the named agent lacked the slice's delivery role and the child ran as an
     *  on-demand role persona instead (`staffDelegation`) — says who really did the work. */
    staffing?: string;
    /** Files the child wrote — its writes happen inside one call the parent cannot see. */
    changedFiles?: string[];
    /** The ticket the child delivered, echoed from the request. */
    ticket?: string;
    /** A BACKGROUND child's handle (`orchestrate.live`) — the result then means "started". */
    handle?: string;
    /** True when the child is still working: its report comes later, not in `output`. */
    running?: boolean;
    /** What the parent should do next, when the surface has something to say. */
    note?: string;
    error?: string;
}
/** Result of a {@link PrdWriteCapability} write. */
interface PrdUpdateResult {
    ok: boolean;
    mode?: "append" | "section";
    /** The section actually rewritten (echoed back, canonically cased). */
    section?: string;
    /** The `## ` headings the PRD carries — returned when `section` matched none, so the
     *  model can retry against a real one instead of guessing again. */
    sections?: string[];
    /** The ticket branch the revision was committed to, when the surface mirrors it. */
    branch?: string;
    /** Model-facing guidance on a SUCCESSFUL write (see {@link RepoWriteResult.note}). */
    note?: string;
    error?: string;
}
/** Persist / recall cross-run knowledge (capability `memory`). On-prem it is backed by
 *  the SSM memory store (semantic recall via on-device embeddings, lexical fallback); a
 *  Worker surface can back it with KV/D1 or a hosted HTTP memory endpoint. The tool
 *  contract is identical across surfaces — only the backing differs (Dependency
 *  Inversion), so `memory_recall`/`memory_remember` are defined ONCE. */
interface MemoryCapability {
    /** Store one durable fact under `key`. Re-using a key overwrites it. */
    remember(key: string, content: string, opts?: MemoryWriteOpts): Promise<MemoryRememberResult>;
    /** Return the entries most relevant to `query` (semantic where backed, else lexical),
     *  capped to `limit`. */
    recall(query: string, limit?: number): Promise<MemoryRecallResult>;
    /** Delete the entry stored under `key`. OPTIONAL — present iff the surface
     *  advertises `memory.forget` (see that capability's note). */
    forget?(key: string): Promise<MemoryForgetResult>;
}
/**
 * How WIDELY a remembered fact is visible. The narrower the scope, the smaller the
 * contamination blast radius: a `ticket` fact is invisible to the next ticket, a
 * `project` fact never reaches another project, and only `tenant` facts are global.
 * A surface resolves the concrete owner (which project / which ticket) from the RUN —
 * never from the model — so an agent cannot widen its own scope or aim a write at a
 * project it is not running in.
 */
type MemoryScopeKind = "tenant" | "project" | "ticket";
/** Write-side options for {@link MemoryCapability.remember}. */
interface MemoryWriteOpts {
    tags?: string[];
    importance?: number;
    /** Visibility of this fact. Defaults to the run's own narrowest scope. */
    scope?: MemoryScopeKind;
    /** Forget automatically after this many days. Omit for a durable fact. */
    ttlDays?: number;
    /** Files the fact names (`contentHash` = the file's hash at write time, when known), so
     *  it joins the knowledge graph and goes stale when they change. Stored where the
     *  backing store anchors facts (project scope); ignored elsewhere. */
    fileAnchors?: Array<{
        path: string;
        line?: number;
        contentHash?: string;
    }>;
}
/** One recalled memory entry. `key`/`content` are the model-facing pair; the rest is
 *  PROVENANCE — where the belief came from, how wide it is, and when it lapses. */
interface MemoryEntry {
    key: string;
    content: string;
    scope?: MemoryScopeKind;
    /** Free-form origin marker, e.g. `cloud-run`, `ide`, `brain`, `user`. */
    origin?: string;
    /** ISO-8601 expiry, when the entry carries a TTL. */
    expiresAt?: string | null;
}
/**
 * Multi-agent coordination (capability `coordinate`). Two agents in the same stage —
 * or two stages of two tickets pointed at one repo — are concurrent writers with no
 * arbiter. This capability is that arbiter, and it has two halves:
 *
 *   • LEASES (`claim`/`release`/`listClaims`) — a mutual-exclusion lock on a named
 *     resource (a file path, a branch, a whole repo). The surface ALSO enforces
 *     leases implicitly on writes, so correctness never depends on the model
 *     choosing to call `claim` first; the tool exists so an agent can reserve work
 *     ahead of doing it and can see WHO holds what.
 *   • BLACKBOARD (`postNote`/`readNotes`) — a shared, run-scoped scratchpad so
 *     concurrent agents can publish intent ("I own the migration") and read their
 *     peers' notes, instead of each rediscovering the same context in isolation.
 */
interface CoordinationCapability {
    /** Take a lease on `resource`. Fails (never throws) when another live holder has it. */
    claim(resource: string, opts?: {
        mode?: LeaseMode;
        reason?: string;
        ttlSeconds?: number;
    }): Promise<LeaseClaimResult>;
    /** Release a lease this run holds. Releasing one it does not hold is a benign no-op. */
    release(resource: string): Promise<LeaseReleaseResult>;
    /** Every live lease in this run's coordination scope, including other agents'. */
    listClaims(): Promise<LeaseListResult>;
    /** Publish/overwrite one note on the shared workspace under `key`. */
    postNote(key: string, content: string): Promise<WorkspaceNoteResult>;
    /** Read the shared workspace, optionally filtered by a lexical `query`. */
    readNotes(query?: string, limit?: number): Promise<WorkspaceReadResult>;
}
/** `exclusive` = one holder. `shared` = many readers, but blocks an exclusive claim. */
type LeaseMode = "exclusive" | "shared";
/** A surface's bag of capability services. A service is present iff the matching
 *  capability is in {@link capabilities}; the registry guarantees a tool's handler
 *  only runs when every required service is present, so handlers may assert them. */
interface CapabilityProvider {
    /** Every capability this surface can physically back. */
    readonly capabilities: ReadonlySet<Capability>;
    readonly repoRead?: RepoReadCapability;
    readonly repoWrite?: RepoWriteCapability;
    readonly symbols?: RepoSymbolsCapability;
    readonly semantic?: RepoSemanticCapability;
    readonly research?: LocalResearchCapability;
    readonly shell?: ShellCapability;
    readonly staticCheck?: StaticCheckCapability;
    readonly human?: HumanCapability;
    readonly prd?: PrdWriteCapability;
    readonly web?: WebCapability;
    readonly memory?: MemoryCapability;
    readonly coordination?: CoordinationCapability;
    readonly skillAuthor?: SkillAuthoringCapability;
    readonly orchestration?: OrchestrationCapability;
}
interface RepoListResult {
    ok: boolean;
    ref?: string;
    paths?: string[];
    truncated?: boolean;
    /** Set when a glob matched nothing — an incomplete walk must say so, never "no such file". */
    note?: string;
    error?: string;
}
interface RepoReadResult {
    ok: boolean;
    path?: string;
    content?: string;
    /** True when `content` is only part of the file (a paginated line window, or the
     *  provider hit its own byte cap) — more remains beyond what was returned. */
    truncated?: boolean;
    /** Total line count of the file, so the model knows how far it has left to page. */
    totalLines?: number;
    /** 1-based line number `content` starts at (for the paginated `read_file` window). */
    offset?: number;
    /** Human/model-facing guidance, e.g. how to read the next chunk of a large file. */
    note?: string;
    error?: string;
}
interface RepoSearchResult {
    ok: boolean;
    query?: string;
    total?: number;
    truncated?: boolean;
    matches?: Array<{
        path: string;
    } & Record<string, unknown>>;
    error?: string;
}
/** One definition a {@link RepoSymbolsCapability} found. */
interface SymbolMatch {
    path: string;
    line: number;
    kind: SymbolKind;
    name: string;
    exported: boolean;
}
interface SymbolFindResult {
    ok: boolean;
    query?: string;
    /** Every definition that matched, before `limit`. */
    total?: number;
    truncated?: boolean;
    matches?: SymbolMatch[];
    /** Files the index covers, so "0 matches" can be read against how much was searched. */
    indexedFiles?: number;
    /** True when the index hit its file cap — a miss is then not proof of absence. */
    partialIndex?: boolean;
    error?: string;
}
interface RepoWriteResult {
    ok: boolean;
    branch?: string;
    commitUrl?: string | null;
    change?: "created" | "modified";
    /** Model-facing guidance about the write, e.g. that it was recorded rather than
     *  applied (rehearsal). Present on a SUCCESSFUL result — `error` is for failures. */
    note?: string;
    error?: string;
}
interface RepoDeleteResult {
    ok: boolean;
    deleted?: boolean;
    branch?: string;
    commitUrl?: string | null;
    note?: string;
    code?: "not_found" | "error";
    error?: string;
}
interface RepoEditResult {
    ok: boolean;
    branch?: string;
    commitUrl?: string | null;
    change?: "modified";
    /** How many occurrences were replaced. */
    replaced?: number;
    /** Model-facing guidance on a SUCCESSFUL edit (see {@link RepoWriteResult.note}). */
    note?: string;
    error?: string;
    /** On a "not found" failure: the most similar line and its ±3 neighbourhood (see `StringEditResult.nearest`). */
    nearest?: {
        line: number;
        excerpt: string;
    };
    /** On success: the 1-based line span of the first replacement (see `StringEditResult.region`). */
    region?: {
        startLine: number;
        endLine: number;
    };
    /** On success: the edited lines plus context, numbered (see `StringEditResult.excerpt`). */
    excerpt?: string;
}
/** One semantic search hit — a function/class that matched the query by meaning. */
interface SemanticSearchHit {
    path: string;
    startLine: number;
    endLine: number;
    symbol?: string;
    kind?: string;
    snippet: string;
    source: "embedding" | "keyword" | "hybrid";
    /** Relevance score, higher is better, when the backing reports one (feeds adaptive K, C4). */
    score?: number;
}
interface SemanticSearchResult {
    ok: boolean;
    query?: string;
    total?: number;
    results?: SemanticSearchHit[];
    /** True when the index is still being built — results may be incomplete. */
    indexing?: boolean;
    error?: string;
}
interface CompressResult {
    ok: boolean;
    /** The compressed text, present only when ok is true. */
    text?: string;
    /** Model tokens before / after compression. */
    originalTokens?: number;
    keptTokens?: number;
    error?: string;
}
interface RepoMapResult {
    ok: boolean;
    /** The map string, present only when ok is true. */
    map?: string;
    /** True when the index is still being built — the map may be incomplete. */
    indexing?: boolean;
    error?: string;
}
interface ShellResult {
    ok: boolean;
    stdout?: string;
    exitCode?: number;
    error?: string;
    /** The command was killed by its cancel signal (Stop, or the person's steer). */
    aborted?: boolean;
}
interface WebFetchResult {
    ok: boolean;
    url?: string;
    status?: number;
    contentType?: string;
    content?: string;
    truncated?: boolean;
    error?: string;
}
interface WebSearchResult {
    ok: boolean;
    query?: string;
    results?: Array<{
        title?: string;
        url?: string;
        snippet?: string;
    }>;
    error?: string;
    /** Licence/credit line the answering surface must carry when it uses these
     *  results (e.g. the keyless encyclopedic index is CC-BY-SA). */
    attribution?: string;
    /**
     * How WIDE the index behind these results is. `owned_index` is the tenant's own
     * crawled corpus — the widest and most trustworthy, since every document in it was
     * actually fetched and indexed rather than merely returned by a third party. `web` is
     * a general vendor search engine, used to discover new pages when the owned index has
     * nothing yet; `encyclopedic` is the keyless floor — real, citable, but narrower. The
     * model is told which it got so it can say "this is what an encyclopedic index has"
     * rather than implying it swept the open web.
     */
    coverage?: 'web' | 'encyclopedic' | 'owned_index';
    /**
     * Present only for a TENANT-scoped search that MISSED the owned index: discovery ran
     * against a vendor and the found pages were queued to crawl and index in the
     * background, so a later identical query reads the owned corpus instead. `null` on an
     * owned-index hit; absent for a tenant-less vendor-only call (the logged-out guest
     * canvas), which has no index to capture into. See
     * `application/webSearch/demandSearch.ts` (`searchOwnedThenDiscover`).
     */
    research_request?: {
        id: string;
        status: 'crawling' | 'failed';
        queued_urls: number;
    } | null;
}
interface StaticCheckResult {
    ok: boolean;
    ran: boolean;
    kind?: string;
    checked?: string[];
    skipped?: string[];
    errors?: Array<{
        path: string;
        message: string;
    }>;
    note?: string;
}
interface HumanAskResult {
    /** True when the run must pause until a human answers (cloud surfaces). */
    paused: boolean;
    /** Opaque id the engine parks the run against. */
    approvalId?: string;
    /** Inline answer when the surface can resolve synchronously (e.g. standalone Node). */
    answer?: string | null;
    note?: string;
    error?: string;
}
interface MemoryRememberResult {
    ok: boolean;
    key?: string;
    error?: string;
}
interface MemoryRecallResult {
    ok: boolean;
    query?: string;
    entries?: MemoryEntry[];
    error?: string;
}
interface MemoryForgetResult {
    ok: boolean;
    key?: string;
    /** False when no entry matched (benign — the fact is gone either way). */
    deleted?: boolean;
    error?: string;
}
/** A live lease as the coordination capability reports it. */
interface LeaseInfo {
    resource: string;
    mode: LeaseMode;
    /** Display name of the agent holding it. */
    holder: string;
    /** True when THIS run is the holder. */
    mine: boolean;
    reason?: string | null;
    expiresAt?: string | null;
}
interface LeaseClaimResult {
    ok: boolean;
    resource?: string;
    mode?: LeaseMode;
    /** True when the lease was granted (or already held by this run). */
    granted?: boolean;
    /** Present when refused: who holds it and why, so the model can coordinate. */
    heldBy?: string;
    expiresAt?: string | null;
    note?: string;
    error?: string;
}
interface LeaseReleaseResult {
    ok: boolean;
    resource?: string;
    released?: boolean;
    error?: string;
}
interface LeaseListResult {
    ok: boolean;
    leases?: LeaseInfo[];
    error?: string;
}
interface WorkspaceNoteResult {
    ok: boolean;
    key?: string;
    error?: string;
}
interface WorkspaceReadResult {
    ok: boolean;
    notes?: Array<{
        key: string;
        content: string;
        author: string;
        updatedAt: string;
        mine: boolean;
    }>;
    error?: string;
}

/**
 * The unified tool contract. ONE shape, defined once, runnable on every surface.
 *
 * A {@link ToolDefinition} pairs an OpenAI-compatible function schema (what the
 * model sees) with a `requires` capability list (what surface can run it) and a
 * pure-ish `execute` that reaches the runtime ONLY through the injected
 * {@link ToolContext} — never through a Worker `Env`, `node:fs`, or a closure over
 * one runtime. That indirection is what lets the SAME definition run in the cloud
 * Worker, the cloud Container, and on-prem Node (Dependency Inversion: the tool
 * depends on the capability abstraction, the surface supplies the concretion).
 */

/** An OpenAI-compatible function-tool schema (the wire format every provider in the
 *  gateway pool accepts). Kept structural rather than importing a vendor type so the
 *  shared package stays dependency-free. */
interface ToolSchema {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: {
            type: "object";
            properties?: Record<string, unknown>;
            required?: string[];
        };
    };
}
/** What a tool handler receives. The capability provider is the surface; `signal`
 *  lets a tool cooperate with run cancellation; `emit` records a timeline event. */
interface ToolContext {
    readonly caps: CapabilityProvider;
    readonly signal?: AbortSignal;
    /** Absolute path of the working tree, when the surface has one on a real
     *  filesystem (on-prem Node, the cloud Container). Runtime-agnostic tools never
     *  read this — they go through {@link CapabilityProvider}. It exists for
     *  surface-NATIVE tool definitions (e.g. the Node code-intelligence tools that
     *  shell out to `git`/`rg` against the checked-out repo) that are registered only
     *  on a filesystem-backed surface and would otherwise have no path to operate on. */
    readonly workspaceRoot?: string;
    /** Optional structured logging/telemetry sink (a no-op when unset). */
    readonly emit?: (event: {
        level?: "debug" | "info" | "warn";
        message: string;
        detail?: unknown;
    }) => void;
    /**
     * Stream a PARTIAL result while the call is still running, so a long tool (a shell
     * command, a build, a download) shows output as it happens instead of appearing to
     * hang and then dumping everything at once.
     *
     * This is the piece a converged `exec`/`process` needs: the native on-prem `AgentTool`
     * has always had an `onUpdate` callback, but the shared contract had none, so adapting
     * a shared definition silently dropped streaming — which is why those two tools could
     * not converge without regressing the on-prem terminal to a frozen prompt.
     *
     * Every parameter is optional and every surface may omit it: a tool MUST treat the
     * absence of `onUpdate` as "nobody is watching" and still return its full result. The
     * partial shape is the same {@link ToolResult}, so a surface renders progress with the
     * exact code path it uses for the final value.
     */
    readonly onUpdate?: (partial: ToolResult) => void;
    /**
     * The host's cost-lever C8 decision (`isCostLeverOn(env, "c8_token_compression", tenantId)`),
     * resolved once by the host — agent-tools has no env. When true AND the surface backs
     * `semantic.compress`, prose-heavy outputs (shell stdout, fetched pages) are compressed.
     * Absent/false = outputs are returned verbatim.
     */
    readonly compressLargeOutputs?: boolean;
}
/**
 * A tool's return. `data` is JSON-serialized as the tool message the model reads.
 * `control` lets a tool ask the ENGINE to do something orchestration-level that a
 * tool must not do itself (end the run, pause for a human) — keeping loop policy
 * (finish gates, pause/park) in the engine while the tool stays a thin adapter.
 */
interface ToolResult {
    /** The payload serialized back to the model. */
    data: Record<string, unknown>;
    /** Optional control signal for the engine to interpret after this call. */
    control?: ToolControl;
    /** Optional rich output blocks (generated/fetched media + extra text) for tools that
     *  produce more than JSON — e.g. image/tts/canvas/browser-snapshot. The engine
     *  surfaces these to its host (channel delivery, transcript) ALONGSIDE `data`; a
     *  surface that cannot render media simply ignores them. Keeps `data` the
     *  model-readable JSON while letting media tools live under the one contract. */
    content?: ToolContentBlock[];
}
/** A rich output block a tool can emit via {@link ToolResult.content}. Runtime-agnostic:
 *  `media` carries a path/uri or inline base64 the host resolves; `text` is extra prose. */
type ToolContentBlock = {
    type: "text";
    text: string;
} | {
    type: "media";
    mediaType: "image" | "audio" | "video";
    path?: string;
    uri?: string;
    base64?: string;
    mimeType?: string;
    hint?: string;
};
type ToolControl = {
    kind: "finish";
    summary: string;
} | {
    kind: "ask_human";
    approvalId?: string;
    question: string;
};
/**
 * One tool: schema + capability requirements + handler. `args` is the parsed JSON
 * arguments from the model's tool call (validated against the schema by the loop).
 */
interface ToolDefinition {
    readonly name: string;
    readonly schema: ToolSchema;
    /** Capabilities the surface MUST advertise for this tool to be offered. Empty =
     *  always available (e.g. `finish`). */
    readonly requires: readonly Capability[];
    /**
     * The description to OFFER under a given capability set, when it depends on what the surface
     * grants (a delegation tool that promises background children only where they run live). Absent =
     * `schema` as it stands. The registry applies it when it builds the schemas for a surface.
     */
    describeFor?(caps: ReadonlySet<Capability>): string;
    execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

/**
 * A governance gate compiled onto the spec (the `policy` modality). Because a gate
 * lives *on the spec* — not inside one front door — it reaches every surface for
 * free: a gate authored once applies in the IDE exactly as it does on a cloud tick
 * or a workflow node, because every surface lowers through {@link lowerAgentSpec}.
 *
 * - `inject-directive` — prepend a governing instruction to the system prompt
 *   (live on every surface today, via the lowering below).
 * - `require-approval` — the engine must pause for human approval before invoking
 *   `tool` (or any tool when `tool` is omitted). Evaluated by {@link evaluatePolicyGate}.
 * - `block` — the engine must refuse `tool` outright.
 */
interface PolicyGate {
    id: string;
    /** Tool this gate governs; omit (or `"*"`) to govern every tool call. */
    tool?: string;
    /**
     * Optional path globs / directory prefixes this gate is scoped to. A path-scoped
     * gate matches only when the tool call's path hits one of these (via the existing
     * {@link matchGlob} / {@link inScope} helpers — not a second matcher). Omit to
     * govern the tool regardless of path. Empty after coerce is treated as omitted.
     */
    paths?: string[];
    effect: "inject-directive" | "require-approval" | "block";
    /** The instruction injected (inject-directive) or the human-readable reason. */
    directive?: string;
    reason?: string;
}

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

/** A run's summed usage — the production cost its answer is cached with, so a later
 *  replay of that answer is priced from a recorded figure. */
interface RunUsageTally {
    promptTokens: number;
    completionTokens: number;
    /** The last model that actually served a call in this run. */
    model: string | null;
}

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
 * The deterministic-first PreFetch gate in the run preamble (docs/design/deterministic-prefetch.md)
 * — the ONE place a Brain run consults `@builderforce/prefetch`, before memory and the model.
 * The pass itself (classify → ANSWER → PREFETCH) is the package's `runGate`, shared with
 * the on-prem preamble; this file is its run-cell glue:
 *
 *   - ANSWER, read  → `adoptAnswerWithoutModel` settles the run (its chips ride the step);
 *   - ANSWER, write → the run's OWN confirm channel (`requestRunConfirm`: the composer's
 *                     confirm chip, declined by Stop) unless the host overrides
 *                     `port.confirm`; only a yes runs it;
 *   - PREFETCH      → the run's VOLATILE tail (returned to `runPreamble`, which rides it
 *                     after the history beside the host's task context — never the
 *                     system prompt);
 *   - LLM           → nothing here; memory and the model proceed as before.
 *
 * Every decision is a `prefetch.decision` trace step. An ANSWER is recorded as an avoided
 * call (`req.recordAvoidedCall` → the device usage ledger's `deterministic` saving). The
 * outcome reaches `port.record` on the chat's NEXT request — accepted unless it re-asks —
 * and the run's outcome record (`req.recordRunOutcome`, `gateAccepted`), which the
 * pipeline route report's gate column reads as accuracy.
 */

/** An outcome waiting for the chat's next request to say whether it was accepted. */
interface PendingGateOutcome {
    request: string;
    outcome: Omit<GateOutcome, 'accepted'>;
    /** The run the decision was made in — where its accuracy is recorded. */
    runId?: string;
}

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
 * One chat's run CELL — the state a run lives in, hoisted out of React so it survives
 * the unmount of the panel that started it (see `brainRunStore.ts`). The shape and its
 * empty values only; the registry and every write live in `runCells.ts`.
 */

/** The completion streaming right now — and, once the gateway names it, the model serving it. */
interface LiveTurn {
    model?: string;
    account?: string;
}
/** What a user Stop cut off, held until the run unwinds and can persist it. */
interface StoppedTurn {
    /** What the model had streamed when Stop was pressed. */
    text: string;
    source: LiveTurn;
    /** The `agent.stopped` step — already on the live trace, persisted with the reply. */
    event: BrainTraceEvent;
}
interface RunCell {
    /** Rich working transcript (user + assistant tool-call turns + tool results). */
    transcript: ChatCompletionMessage[];
    /**
     * The earlier turns' tool work the transcript was seeded WITHOUT
     * ({@link BrainRunRequest.priorResearch}). Set when the transcript is seeded and kept
     * for the chat's later runs this session: the tool rows it summarises never enter
     * the transcript, so dropping it on the next run would lose them a second time.
     */
    priorResearch: string | null;
    trace: BrainTraceEvent[];
    running: boolean;
    streamingText: string;
    error: string;
    /** Actionable verdict for {@link error} — see BrainRunSnapshot.errorAction. */
    errorAction: ChatErrorAction | null;
    pendingConfirm: {
        name: string;
        args: unknown;
    } | null;
    confirmResolver: ((ok: boolean) => void) | null;
    appended: BrainMessage[];
    messagesEpoch: number;
    listeners: Set<() => void>;
    /** A pending coalesced repaint for streamed tokens — see {@link emitStreaming}. */
    emitTimer: ReturnType<typeof setTimeout> | null;
    /**
     * Abort handle for the run currently in flight. Created fresh in `startRun` and
     * used to (a) cancel the streaming LLM fetch and (b) let the loop unwind
     * cleanly when the user hits Stop. Null while idle. A fresh controller per run
     * means a stale aborted one never bleeds into the next run.
     */
    abort: AbortController | null;
    /** The in-flight step (see BrainRunSnapshot.activity). Null while idle. */
    activity: BrainRunActivity | null;
    /** Connected-but-unresolved BYO providers accumulated across this run's turns. */
    byoUnresolved: string[];
    /** BYO providers that hit a capacity/usage cap accumulated across this run's turns. */
    providerCap: string[];
    /** The engine turn being narrated (see BrainRunSnapshot.turn). */
    turn: RunTurn | null;
    /**
     * Backstop bookkeeping for the current run (reset each {@link startRun}): whether a
     * workspace code-change tool succeeded, whether the model itself recorded a ticket
     * (from_delta / link / review), and the files it touched — so a code-changing run
     * that never linked its work gets a ticket minted for it. IDE-only in practice.
     */
    codeChanged: boolean;
    /** The model that made this run's code changes — what its outcome grades as a coder. */
    codeModel: string | null;
    /** This run's outcome idempotency key ({@link runOutcomeId}). */
    runId: string;
    ticketRecorded: boolean;
    touchedFiles: string[];
    /**
     * The ticket this run opened for its own code change, the MOMENT it made the first
     * one — not at the end.
     *
     * Traceability that only happens in the `finally` block is traceability that a long
     * run does not get: the finally is skipped on a user Stop, and never reached at all
     * if the surface is closed or reloaded mid-run. A measured run edited files for
     * thirteen hours and ended with nothing on the board, because the one moment it would
     * have recorded anything was a moment it never reached. Opening the ticket on the
     * FIRST edit means the work is visible and linked to the chat from the first edit
     * onward, whatever happens to the rest of the turn; the end-of-run pass then attaches
     * the remaining files to THIS id rather than minting a second ticket.
     */
    deltaTicketId: number | null;
    /** Files already attached to {@link deltaTicketId}, so the settle pass only sends what
     *  is new (and sends nothing when the first edit was the only one). */
    deltaRecordedFiles: string[];
    /**
     * Index in `trace` of the CURRENT run's first event. The trace is a per-CHAT sliding
     * window that spans every run in the session, so any question about "what did THIS run
     * do" must be asked of {@link runTrace}, never of `trace` — reading the whole window let
     * an earlier run's push-to-main close a later run's unshipped ticket. An index, kept
     * true as the window splices from the front ({@link pushTrace}), rather than a start
     * timestamp: at millisecond resolution a run that starts in the same millisecond as
     * the previous run's last step inherited that step.
     */
    runTraceFrom: number;
    /**
     * Where THIS run's trace events are made durable — set by `startRun` for the run's
     * lifetime and cleared when it ends. Every event {@link pushTrace} records while it is
     * set becomes a step row, so the trace and its durable copy cannot drift: there is one
     * writer and one store. Null outside a run — a mirrored run (`applyRemoteRun`) is
     * persisted by the host that actually runs it, never twice.
     */
    persistStep: ((ev: BrainTraceEvent) => void) | null;
    /**
     * Cached compressed-memory of the transcript's older part. When the transcript exceeds
     * the working-transcript token budget (`HISTORY_TOKEN_BUDGET`, `@seanhogg/builderforce-memory/working`)
     * the loop SUMMARIZES `transcript[0, coveredEnd)` into this
     * note (instead of dropping it, which made a weak model re-read and thrash into "LOOP
     * EXHAUSTED") and sends every message from `coveredEnd` on verbatim. Re-folded
     * incrementally only once that remainder no longer fits (see `buildWorkingTranscript`).
     * Null until the first overflow / reset.
     */
    compactMemo: CompactMemo | null;
    /**
     * Which persisted message each known transcript entry is (transcript index → message
     * id): the seeded history and every run's user turn. A fold persists its note as an
     * auto consolidation marker that keeps from the first message it did not cover
     * (`foldKeepFromId`), so the next run — after a reload, on another surface — starts
     * from the note instead of summarizing the whole history again (`runFoldMarker.ts`).
     */
    transcriptAnchors: Array<{
        index: number;
        id: number;
    }>;
    /**
     * The lowest id of a persisted message this run's history holds that the cell's
     * transcript does NOT (another surface's turn, an @agent reply, a teammate's message —
     * persisted between runs, never seen by this cell). A fold's note cannot cover it, so
     * the marker keeps from no later than here. Undefined when the transcript holds it all.
     */
    unseenFromId: number | undefined;
    /** This run's summed usage — what its answer is cached with (`memorySavings.ts`). */
    runUsage: RunUsageTally;
    /** The model that last served a call in this chat — what a memory answer is priced
     *  against when this run has not called a model yet. Survives across runs. */
    lastServedModel: string | null;
    /** The PreFetch gate's last acted decision, settled (accepted / re-asked) by this
     *  chat's next request (`prefetchGate.ts`). Survives across runs. */
    pendingGate: PendingGateOutcome | null;
    /**
     * The completion in flight ({@link asLiveTurn}), null between completions. The only
     * record of which model a Stop cut off: an aborted stream never returns its result.
     */
    liveTurn: LiveTurn | null;
    /** The request this chat last ran with: what a turn handed to it later runs with (`continueChat.ts`). */
    lastRequest: BrainRunRequest | null;
    /**
     * How many times this chat was told to Stop - counted even when nothing was running. A turn
     * being made from direction (`continueChat.ts`) compares it with the count it started at: a
     * Stop pressed in between must not be outrun by a run that starts after it.
     */
    stopEpoch: number;
    /**
     * The claim on this chat's NEXT run (`runClaim.ts`): a continuation is being made - words saved, the
     * host's run-time parts prepared - and no other launch may take the chat meanwhile. The cell counts
     * as live while it is held, so a person's message steers into the claimed run instead of racing it.
     */
    claim: RunClaim | null;
    /** What the last Stop cut off, until the unwinding run persists it ({@link keepStoppedTurn}). */
    stoppedTurn: StoppedTurn | null;
    /** Cached immutable snapshot; identity changes only when something changed. */
    snapshot: BrainRunSnapshot;
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
 * Cost levers — the ONE on/off decision for every LLM cost-optimization lever.
 *
 * Each lever in the PRD (A1…F3) ships behind its own id here instead of a
 * bespoke env flag per feature, so rollout, kill switch and the control group in
 * the cost metrics all read the same answer.
 *
 * Resolution, first match wins:
 *   1. `COST_LEVER_<ID>` in env — `on` / `off` (also 1/0, true/false), or an
 *      integer 0–100 = the share of tenants it is on for.
 *   2. `COST_LEVERS_ALL=off` — global kill switch for every lever.
 *   3. The manifest default (`rollout`, 0–100).
 *
 * A percentage is applied by a stable FNV-1a bucket of `<leverId>:<tenantId>`,
 * so a tenant stays in the same arm across requests and isolates, and different
 * levers split tenants independently. No tenant id → the lever is on only at 100.
 *
 * On-device hosts (the VS Code extension, the on-prem runtime) have no tenant on the
 * local path, so they bucket by a stable INSTALL id instead ({@link isOnDeviceCostLeverOn})
 * — one install stays in one arm, and a 10% lever reaches about 10% of installs rather
 * than none of them.
 */
type CostLeverId = 'a2_run_budget' | 'a3_progress_detector' | 'b1_stable_prefix' | 'b2_semantic_cache' | 'b3_single_flight' | 'b4_agent_answer_replay' | 'c2_observation_masking' | 'c3_task_state' | 'c4_adaptive_context' | 'c5_cloud_repo_map' | 'c6_rerank' | 'c7_tool_output_policy' | 'c8_token_compression' | 'c9_price_tier_budget' | 'd1_verifier_cascade' | 'd2_difficulty_router' | 'd3_routing_exploration' | 'd4_role_reasoning' | 'd5_output_caps' | 'd6_batch_api' | 'd7_deterministic_handlers' | 'd8_parallel_tool_calls' | 'e1_skill_ranking' | 'e2_specialists' | 'e3_free_embeddings' | 'e5_verified_local_label';

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

/** The working phase of a tool-using run. Only ever moves forward. */
type RunPhase = Extract<ModelRole, 'plan' | 'code' | 'verify'>;
interface RunPolicyOptions {
    /** The model the run starts on; absent ⇒ the gateway auto-selects. */
    pinnedModel?: string;
    /** Ask the gateway not to cascade off the model. Applies only while one is set. */
    strictPin?: boolean;
    /**
     * Whether a release status ({@link PIN_RELEASE_STATUSES}) may drop the USER's pin.
     * The browser Brain treats a pin as the user's own choice and never routes around it;
     * the cloud loop pins on the run's behalf and drops it rather than fail the run. A
     * LOCK ({@link lockAfterFirstSuccess}) is always releasable.
     */
    pinReleasable?: boolean;
    /**
     * Keep the run on the model the gateway resolved — once a non-strict turn succeeds,
     * every later turn asks for that model (the cloud durable loop, whose DO ticks must
     * not hop models mid-task). A release status unlocks it; the next success re-locks.
     */
    lockAfterFirstSuccess?: boolean;
    /** Where the run starts — a resumed run that already changed code starts at `code`. */
    startPhase?: RunPhase;
    /** Model swaps one run may make after a stall. Defaults to `MAX_MODEL_FAILOVERS`. */
    maxFailovers?: number;
    /**
     * The role every tool turn asks for when the run was delegated ONE kind of work that
     * is not a working phase (an `explore` or `utility` sub-agent). Absent ⇒ the phase
     * (`plan` → `code` → `verify`) decides, which is every run that plans or ships work.
     */
    fixedRole?: ModelRole;
    /**
     * Model-id prefixes whose backend DECLINES a turn with {@link DECLINE_STATUS} (today
     * `evermind/` — a project's own self-learning head). A decline on one of them releases
     * a releasable pin or a lock like a {@link PIN_RELEASE_STATUSES} status, so the run
     * walks the gateway's cascade instead of dying on a head that is still learning.
     */
    decliningModelPrefixes?: readonly string[];
    /**
     * Pin the model a stall failover moves to STRICTLY. A host that fails over onto a
     * model because it already worked in this run (see {@link preferProvenFailover}) must
     * not let the gateway route straight back off it — a soft hint can be shadowed by the
     * tenant's connected-account seed.
     */
    strictFailover?: boolean;
    /**
     * On a stall, fail over first to a model that already ACTED in this run (a turn that
     * succeeded with tool calls — `turn_succeeded{acted: true}`), most recent first, and
     * only then to the host's `pick` / `surface`. A model that has emitted valid tool calls
     * in this very run is the strongest evidence a host holds about who can do the work.
     */
    preferProvenFailover?: boolean;
    /** Models the run routes around from its first turn (failures the session already
     *  proved). They join {@link RunPolicyState.broken}. */
    excludeModels?: readonly string[];
    /**
     * Optional model per phase, read by {@link nextTurn} for every phase. `verify`
     * overrides the run's own model (a review is never the author's). `plan` and `code`
     * are the DEFAULT beneath it: they apply only while the run holds no model of its
     * own — no pin, lock or stall failover — so a failover that moved the run off its
     * coder is never undone by the phase table, and a fixed-role run (`explore`) is never
     * handed the coder's model. A phase model that broke this run is routed around like
     * any other. `null` means no model for that phase. `reviewModel` is the legacy alias
     * for `phaseModels.verify`.
     */
    phaseModels?: Partial<Record<RunPhase, string | null>>;
    /** Review model for the verify phase. `null` means none is configured. */
    reviewModel?: string | null;
}
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
interface RunPolicyState {
    readonly phase: RunPhase;
    /** The model the next turn asks for; undefined ⇒ auto-select. */
    readonly model: string | undefined;
    /** Whether `model` came from a lock rather than the pin or a failover. */
    readonly locked: boolean;
    /** The configured pin while it stands; cleared for good once a release drops it. */
    readonly pin: string | undefined;
    /** Strictness as configured; cleared for good once a pin is released. */
    readonly strictPin: boolean;
    /** Models that broke mid-turn this run — excluded from every later turn. */
    readonly broken: readonly string[];
    /** Models whose turn succeeded WITH tool calls this run, oldest first — the
     *  {@link RunPolicyOptions.preferProvenFailover} candidates. */
    readonly proven: readonly string[];
    /** Every model a stall failover has already burned, asked-for and resolved. */
    readonly tried: readonly string[];
    readonly failovers: number;
    /** Transport retries spent on the CURRENT turn; a success resets it. */
    readonly turnRetries: number;
    /** Turns answered while the run was still planning — what {@link handOffDue} reads. */
    readonly planTurns: number;
    /** The analysis budget already spent its one forced hand-off turn this run. */
    readonly handOffForced: boolean;
    /** Turns answered while the run was coding — what {@link changeDue} reads. */
    readonly codeTurns: number;
    /** The coding budget already spent its one forced change turn this run. */
    readonly changeForced: boolean;
    readonly outcome: RunPolicyOutcome;
    /**
     * The model that wrote the change, captured when verification starts. Every later
     * verify turn excludes it, even when no distinct review model is configured.
     */
    readonly authorModel?: string;
    readonly options: Readonly<Required<Pick<RunPolicyOptions, 'pinReleasable' | 'lockAfterFirstSuccess' | 'maxFailovers' | 'decliningModelPrefixes' | 'strictFailover' | 'preferProvenFailover'>> & Pick<RunPolicyOptions, 'fixedRole' | 'phaseModels' | 'reviewModel'>
    /** Whether the configured pin was strict — what a pin the run returns to is asked as. */
     & {
        pinStrict: boolean;
    }>;
}
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
 * THE weak-first verifier cascade (cost PRD D1), as pure policy.
 *
 * A run's work comes in UNITS: a batch of code edits made in one turn, a finish attempt,
 * a structured answer. Each unit has a VERIFIER the host already owns — the changed-file
 * checks for code, the finish gates for a finish, a schema for structured output. Today
 * a failed verifier hands the SAME model the same problem again. The cascade says
 * instead: start the unit on the cheapest tier that can plausibly do it; when its
 * verifier fails, move ONE tier up the role's tier list (and raise reasoning one level),
 * carrying the failed attempt and the verifier's reason as a steer; give up escalating
 * after {@link MAX_UNIT_ESCALATIONS}; when the unit passes, step back down to where the
 * unit started so the next unit is weak-first again.
 *
 * Model state stays in the run policy (`reduceRunPolicy` `escalated`); this module only
 * decides. Pure, I/O-free; the state is plain JSON so a durable host carries it.
 */
/** What kind of work a unit is — names the verifier that judges it. */
type CascadeUnitKind = 'code_edit' | 'finish' | 'structured_output';
interface CascadeState {
    /** The unit currently being repaired, if one failed and has not passed since. */
    open?: {
        kind: CascadeUnitKind;
        escalations: number;
        baseModel?: string;
    };
    /** Tier steps taken this run (telemetry; also bounds reasoning escalation). */
    escalations: number;
    /** Reasoning levels raised above the role default for the current unit. */
    reasoningBoost: number;
}

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

/** The counter as it crosses a step boundary. */
interface ServedStreakState {
    streak: number;
    turns: number[];
    fired: number;
}
declare class CacheServedStreak {
    private streak;
    private readonly turns;
    private fired;
    constructor(saved?: ServedStreakState);
    /** A repeat the read cache answered (stub, covered window, replay, repeated write), on `step`. */
    served(step: number): void;
    /** A call the host actually ran - the run touched the world again. */
    ran(): void;
    get count(): number;
    /** Whether the streak is due a forced turn. */
    due(): boolean;
    /** A forced turn was spent on the streak: the count starts over. */
    consume(): void;
    /** The counter as plain data. */
    state(): ServedStreakState;
}

/**
 * surface — the optional ports a surface with its OWN tools and its OWN deliverables
 * hands the agent (PRD 35 §3.2, WS4 canvas).
 *
 * The Creation Canvas runs the board's tools (`canvas_*`, the tenant's MCP catalog) and
 * owes the user things the shared registry knows nothing about: a canvas change, an app
 * that was written, a document of the requested length. Two ports carry that, and both
 * are DATA plus the surface's own facts — never a loop and never a rule:
 *
 *   • {@link PlatformTools} — the surface's tools as a capability provider on the same
 *     run: what it can run right now, how to run one, and which of its calls hand the
 *     run from analysis to code. The tools policy narrows the catalog per turn.
 *   • {@link DeliveryLedger} — what the task still owes when a turn ends in prose, as
 *     {@link LadderRung}s. The stall policy walks them: restate, hand to a model that
 *     already acted, then fail, settle or fall through. The MECHANICS are the stall
 *     module's (`policy/stall/ladder.ts`); the surface supplies only which rungs hold
 *     and the words each one says.
 *
 * Plain types only, no `node:*`, no DOM.
 */

/** Why a turn ended without having finished: the output ceiling, or a call the provider could not parse. */
type TurnInterruption$1 = "truncated" | "malformed-tool-call";
/** The ladder counters a surface reads to know how far a rung has gone (`RunState.stall.rungs`). */
interface LadderProgress {
    readonly rungs: Readonly<Record<string, number>>;
}
/** What a platform tool returned: the payload the model reads, and whether it failed. */
interface PlatformToolResult {
    data: unknown;
    isError?: boolean;
    /** The result's native blocks (text, pictures), kept on the tool row beside `data`, which the model reads as text when it is a string. */
    parts?: RunPart[];
    /** The result's own fields (a tool's details, its tool name), kept on the tool row (`RunMessage.meta`). */
    meta?: Readonly<Record<string, unknown>>;
    /**
     * The answer is a conversational one (a tool lookup, a declined confirm, a hand-off): it touched nothing, so it neither
     * counts as the run circling its read cache nor as work that ended the circle.
     */
    neutral?: true;
    /** The answer came from the surface's own read cache (a stub, a replay): it counts toward the run circling its reads. */
    cached?: true;
}
/** How a tool call with unusable arguments is declined, in this surface's words. */
interface MalformedCallPolicy {
    /** Appended to the truncated-call result: how THIS surface's tools take a long object. */
    retryHint?: string;
    /** Said once, after a round in which a call was declined — the remedy that matches why. */
    roundDirective(truncated: boolean): string;
    /** A call was declined (for the surface's trace). The tool never ran. */
    refused?(call: {
        name: string;
        arguments: string;
    }, truncated: boolean, outcome: unknown): void;
}
/** The turn's relevance selection over the surface's catalog. */
interface PlatformSelection {
    /** The text tools are scored against (the request, plus the latest exchange). */
    query: string;
    /** The most tools one completion advertises. */
    limit: number;
    /** Tools the prompt names — advertised whatever the query scores. */
    required: ReadonlySet<string>;
}
/** The surface's own tools, as a capability provider on the same run. */
interface PlatformTools {
    /**
     * The surface's catalog is the whole catalog: the shared registry's core set is not
     * advertised beside it, every call is the surface's to run, and a name it does not know
     * is the surface's to answer. Absent ⇒ the surface runs only the names the shared
     * registry does not, and the registry's catalog strategy applies.
     */
    closed?: boolean;
    /** The tools the surface can run right now. Read every turn: a rung may withdraw some. */
    schemas(progress: LadderProgress): readonly ToolSchema[];
    /**
     * The surface's say over THIS turn's menu, asked once per step before the request is built: it may force a turn (a narrower
     * set of tools, a call required, a brief that rides the request's volatile tail) or add to what the tools policy selected.
     * Nothing back ⇒ the policy's selection stands.
     */
    turn?(env: TurnEnv): Promise<TurnMenu | void> | TurnMenu | void;
    /** The relevance selection the tools policy applies to {@link schemas}. */
    selection: PlatformSelection;
    /** Run one call. A refusal is a result the model reads, never a throw. */
    execute(name: string, args: Record<string, unknown>, env: {
        signal?: AbortSignal;
        progress: LadderProgress;
        callId?: string;
    }): Promise<PlatformToolResult>;
    /** Does this call end analysis and begin the work? The first one hands the run to the coder. */
    handsOff?(name: string): boolean;
    /**
     * The surface's results are already the TEXT the model reads (a budgeted string): a string result becomes the tool row as it is,
     * not JSON-quoted. Absent ⇒ every result is serialised as JSON, as the canvas's are.
     */
    verbatimText?: boolean;
    /** How a call whose arguments never parsed is declined. Absent ⇒ the shared wording, no hint. */
    malformed?: MalformedCallPolicy;
}
/** What a surface sees when it shapes a turn's menu. */
interface TurnEnv {
    /** The absolute step. */
    step: number;
    /** The tools policy's selection for this turn (it reads the surface's `schemas` and `selection`). Asking is free; the answer is the policy's. */
    select(): Promise<readonly ToolSchema[]>;
    /** The delivery ladder's counters. */
    progress: LadderProgress;
    /** The calls in a row the run's read cache answered (`policy/tools/cacheServedStreak`). */
    cache: CacheServedStreak;
}
/** How a surface shapes one turn. */
interface TurnMenu {
    /** The whole menu of the turn, replacing the policy's selection (a forced turn's narrower set, the policy's set plus router tools). */
    tools?: readonly ToolSchema[];
    /** A call is required this turn. */
    toolChoice?: "required";
    /** Sections for the request's volatile tail (the forced turn's brief, a steer). Never persisted. */
    tail?: readonly string[];
}
/** What the stall ladder judges a turn that ended without calling a tool. */
interface DeliveryTurn {
    /** What the model said. */
    content: string;
    /** Set when the turn was cut off rather than finished. */
    interruption?: TurnInterruption$1;
    /** The model that answered, as the gateway resolved it. */
    model?: string;
}
/** One rung of the ladder a prose-ended turn must clear. */
interface LadderRung {
    /** The counter key (`RunState.stall.rungs`); stable across turns. */
    id: string;
    /** Does this rung hold for this turn? A rung that does not hold is stepped over. */
    applies: boolean;
    /** The directives for successive re-statements, softest first. */
    restate: readonly string[];
    /** Re-statements spent before a hand-off is tried (default 1). */
    free?: number;
    /**
     * What is said when the turn is handed to a model that already acted, in the surface's
     * words and naming the model that takes over. Absent ⇒ no hand-off is tried.
     */
    handoff?: (to: string) => string;
    /** Put what the model said into the transcript before the directive. */
    quote?: boolean;
    /** Said once with the run's first re-statement of this rung, and never again. */
    once?: string;
    /** What happens when every re-statement is spent. */
    spent: "fail" | "fall" | {
        settle: string;
    };
    /** Called when evaluation reaches this rung, whether or not it applies. */
    reached?(): void;
    /** Called with the attempt number each time this rung re-states. */
    onRestate?(attempt: number): void;
    /**
     * Re-stating this rung hands the run from authoring to review (the verify phase): the model that continues is the review
     * model. The surface says so only when the run changed something it can verify.
     */
    entersVerify?: boolean;
}
/** How a provider failure is spoken to the model, in this surface's words. */
interface ProviderFailureWording {
    /** Said when the turn moves to a model that already acted, naming it. */
    handoff: (to: string) => string;
    /** Said when the turn is re-asked of the gateway's pool. */
    reroute: string;
    /** The turn is being re-asked; for the surface's trace. */
    rerouted?(failure: {
        model?: string;
        message: string;
        step: number;
        outcome: Extract<RunPolicyOutcome, {
            kind: "retry_turn";
        }>;
    }): void;
    /** No model is left: the turn is abandoned. */
    abandoned?(failure: {
        model?: string;
        message: string;
    }): void;
}
/** What the task still owes, and how a prose-ended turn is judged. */
interface DeliveryLedger {
    /** The rungs this turn must clear, in order. Read live: the surface's own facts decide which hold. A surface that must ask something (a workspace's stop hook) answers with a promise. */
    rungs(turn: DeliveryTurn): readonly LadderRung[] | Promise<readonly LadderRung[]>;
    /** Rungs whose counters survive a hand-off to another model (every other rung starts fresh). */
    sticky?: readonly string[];
    /**
     * Which of the agent's generic stall behaviours the ledger REPLACES. Each is off unless
     * stated, so a surface that declares deliverables still gets the generic behaviour it
     * did not take over.
     */
    owns?: {
        /** The rungs are the stall judgement: the narration heuristics do not also run. */
        narration?: boolean;
        /** {@link DeliveryLedger.accept} shapes the settled answer (the generic trim and ask-lift do not run). */
        settle?: boolean;
        /** The surface composes its own closing answer: no forced no-tools synthesis turn. */
        synthesis?: boolean;
    };
    /** The answer a turn that cleared every rung settles on. Used when {@link DeliveryLedger.owns}`.settle`. */
    accept?(content: string): string;
    /** The turn moved to another model (for the surface's session bookkeeping). */
    handedOff?(from: string | undefined, to: string): void;
    /** The wording of a provider failure's recovery. Absent ⇒ the failure is routed in silence. */
    providerFailure?: ProviderFailureWording;
}

/**
 * policy/hooks — THE contract between the agent and its policy modules.
 *
 * PRD 35 §3.2: the agent owns the policy; an adapter supplies PORTS and nothing else.
 * Each policy module (WS2a–g) owns one folder under `policy/` and exposes ONE hook,
 * and the composition in `runAgent.ts` calls that hook. Every hook is a NO-OP until
 * its workstream lands, so the agent runs today exactly as it did before, and each
 * WS2 module replaces its stub with the ported behaviour and its unchanged tests.
 *
 * The hooks are deliberately PORTS, not policy code: a hook receives the run's
 * context and returns a DECISION or a state change. Nothing here knows how to read
 * a file, call a model or write to a store — that is the surface's job, and the
 * agent's job is to ask.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

/** What a stall decision does: steer, escalate, pause, settle on an answer of its own, or fail the run. */
type StallAction = "steer" | "escalate" | "pause" | "settle" | "fail";

/**
 * runEvents — the typed trace of a run (PRD 35 §3.2). The trace is what every adapter must match: the same scripted
 * task gives the same events on every surface, whether it runs continuously or one step per tick.
 */

/** One event of the run's trace. The trace is what every adapter must match. */
type RunEvent = {
    kind: 'run.started';
    step: number;
} | {
    kind: 'turn.started';
    step: number;
} | {
    kind: 'model.completed';
    step: number;
    model?: string;
    usage?: ModelUsage;
} | {
    kind: 'tool.dispatched';
    step: number;
    tool: string;
    ok: boolean;
    callId?: string;
    args?: Record<string, unknown>;
    result?: unknown;
} | {
    kind: 'steer.applied';
    step: number;
} | {
    kind: 'model.preflight';
    step: number;
    status: 'ok' | 'refreshed' | 'degraded';
    notices: string[];
} | {
    kind: 'llm.model_downgrade';
    step: number;
    requestedModel: string;
    model: string;
    reason: string;
} | {
    kind: 'model.cascade';
    step: number;
    from: string | null;
    status: number | null;
    released: boolean;
} | {
    kind: 'stall.recovered';
    step: number;
    action: StallAction;
    note?: string;
    detail?: Record<string, unknown>;
} | {
    kind: 'policy.blocked';
    step: number;
    tool: string;
    gateId: string;
    reason: string;
} | {
    kind: 'finish.blocked';
    step: number;
    reason: string;
    block: string;
    detail?: Record<string, unknown>;
} | {
    kind: 'loop.repetition';
    step: number;
    copies: number;
    block: string;
} | {
    kind: 'context.tools';
    step: number;
    advertised: number;
    catalog: number;
    toolsTokens: number;
    loaded: string[];
} | {
    kind: 'context.compacted';
    step: number;
    dropped: number;
    beforeTokens?: number;
    afterTokens?: number;
    summarized?: boolean;
    masked?: number;
    note?: string;
    covered?: number;
} | {
    kind: 'model.coder_reask';
    step: number;
    model?: string;
} | {
    kind: 'budget.warning';
    step: number;
    spentMc: number;
    capMc: number;
    unpricedCalls: number;
    text: string;
} | {
    kind: 'budget.contained';
    step: number;
    spentMc: number;
    capMc: number;
    unpricedCalls: number;
    text: string;
} | {
    kind: 'budget.unpriced';
    step: number;
    model?: string;
} | {
    kind: 'loop.no_progress';
    step: number;
    streak: number;
    forced: string;
} | {
    kind: 'turn.finished';
    step: number;
} | {
    kind: 'run.finished';
    step: number;
    outcome: RunOutcomeKind;
};

/**
 * policy/finish/gates.ts — the cloud run's FINISH GATES, ported from
 * `api/src/application/runtime/cloudAgent/finishGates.ts`.
 *
 * What a `finish` must clear before the run may end. Each gate yields a NAMED verdict —
 * the verifier cascade (D1) needs to know not just that a finish was refused but WHY:
 * a red CI or a stub is the model's failure and earns a stronger model; CI still running
 * is nobody's failure and must not.
 *
 * In order, each yielding a block the model reads and corrects (null = ship):
 *   0. the required reviewer verdict (sign-off);
 *   1. the completeness self-review (no code deliverable — once);
 *   2. the changed-file source/config policy (`verifyWrittenFiles`, in `policy/guards`);
 *   3. branch CI (red and pending block up to a cap);
 *   4. honesty (a claimed check that could not have run — once);
 *   5. anti-stub (placeholder code, up to a cap).
 *
 * The API engine's repo/db couplings the original folded in (branch-CI polling, the
 * placeholder scan, the structural completion-claim record, live-child tracking) have
 * no counterpart in this package's PORTS contract, so they arrive as OPTIONAL ports a
 * surface supplies. Absent, that gate is an honest no-op rather than an invented check —
 * the behaviour the port must keep is the DECISION and the counters, which persist
 * across durable ticks in {@link FinishGateState}.
 *
 * No `node:*` imports, no DOM.
 */

/** The gate counters a run carries. `ciVerified` / `finishBlockedOnce` are per tick, as they always were. */
interface FinishGateState {
    noDeliverableBlocked: boolean;
    reviewVerdictRecorded: boolean;
    placeholderBlocks: number;
    ciPendingBlocks: number;
    ciFailureBlocks: number;
    ciVerified: boolean;
    finishBlockedOnce: boolean;
}

/**
 * policy/tools/taskState — cost lever C3, ported from `api/.../costLoop/taskState.ts` (extracted, not copied:
 * the api module re-exports this one). The agent writes it with `update_task_state`; `RunState.taskState`
 * carries it across steps and the memory policy renders it in the per-turn tail.
 */

interface TaskState {
    goal?: string;
    constraints?: string[];
    decisions?: string[];
    filesTouched?: string[];
    openQuestions?: string[];
    nextStep?: string;
}

/**
 * telemetry/runTally — the per-RUN counters the §8.2 outcome row reads (PRD 35 WS6).
 *
 * The tally lives on `RunState.telemetry`, so it crosses a step boundary with the rest
 * of the state: a cloud run driven one tick at a time (`maxSteps: 1`) totals exactly
 * what the same run driven continuously totals, and the row — written once, when the
 * run ends — counts the whole run, not its last tick.
 *
 * Every counter is fed by the driver at the point the fact happens (a model turn, a
 * dispatched call, a verify verdict), from the SAME verdict the event trace records, so
 * the row and the trace never disagree. PURE: plain JSON in, plain JSON out.
 */

/** What a run has spent and done so far — carried on `RunState.telemetry`. */
interface RunTally {
    /** Tool calls dispatched (covered-read stubs never ran, so they are not calls). */
    toolCalls: number;
    /** Dispatched calls that errored. */
    toolErrors: number;
    /** The model the last turn was served by. */
    model?: string;
    /** Input + output tokens across every turn. */
    tokens: number;
    /** Prompt-cache reads across every turn. */
    cacheReadTokens: number;
    /** The run's cost so far (see `costTally.ts`): the millicents billed while every turn was priced, `null` once a
     *  turn was not (unknown, never a partial sum), absent before any turn. Read it with `reportedRunCost`. */
    costMc?: number | null;
    /** Marks a tally written under the cost latch. A tally persisted WITHOUT it predates the rule: its `costMc` may be
     *  the sum of only the priced turns, so `resumeTally` resumes it cost-unknown. */
    costLatch: true;
    /** The step the first `spawn_agent(s)` call was dispatched on; absent ⇒ nothing spawned. */
    firstSpawnTurn?: number;
    /** `cat`/`sed`/`head`/`tail` prints of one workspace file through the shell. */
    shellFileReads: number;
    /** Calls that came back "not a git repository". */
    repoErrors: number;
    /** The run-end verify's verdict, when the declared verify ran. */
    verify?: "passed" | "failed";
    /** True when the tally does NOT cover the whole run (a legacy cursor resumed with a fresh tally): the counts are a floor, so a consumer records none. */
    partial?: boolean;
}

/**
 * runStateTypes — the plain-JSON state a run carries across a step boundary (PRD 35 §3.2). The types that already
 * have a home are REUSED, never redefined: `RunPolicyState` (`@builderforce/run-policy`), `RunKnowledgeState`
 * (`@builderforce/agent-tools`), the progress detector's and read guard's state (`@builderforce/run-guards`), the
 * finish counters (`policy/finish`). The guard state is named here because it gathers several owners' shapes into
 * the one slice a step boundary carries.
 */

/**
 * A3's progress detector, D1's cascade and D7's checks note — the guard state a run
 * carries across a step boundary.
 *
 * Mirrors the guard state the cloud's retired per-tick `LoopGuards` persisted, field for field: WS2d
 * ports that module into `policy/guards` and deletes the API copy, so this becomes the
 * only definition rather than a copy of one.
 */
interface LoopGuardState {
    /** A3: the progress detector's tallies and trip count. */
    progress?: ProgressDetectorState;
    /** D1: the cascade's units, the first tick's action type, the seed's softness. */
    cascade?: CascadeSessionState;
    /** A3: a pause the next dispatched call parks the run on. */
    pendingPause?: string;
    /** D7: the sandbox checks' failures, for the NEXT turn's tail. */
    checksNote?: string;
    escalations?: number;
}
/** What the cascade persists across durable ticks (`policy/guards` `CascadeSession`). */
interface CascadeSessionState {
    /** The cascade's own state (`@builderforce/run-policy`). */
    cascade?: CascadeState;
    /** The task's action type, resolved on the first tick (later ticks only have `other`). */
    actionType?: string;
    /** Whether this run's seed is soft (the cascade may move it). */
    soft?: boolean;
    /** The steer the next turn shows, until that turn ends. */
    steer?: string;
    /** The tenant's prior weak pass rate, read once on the first tick. */
    priorWeakPassRate?: number;
    /** Whether that read happened (a cold tenant has no rate, and must not re-ask). */
    priorRead?: boolean;
}
/**
 * What compaction carried out. WS1 names the type (there is no home for it today);
 * WS2a owns its behaviour in `policy/compaction`.
 */
interface CompactionState {
    /** How many times the transcript has been compacted this run. */
    compactions: number;
    /** The step the last compaction happened at. */
    lastCompactedStep?: number;
    /** The tokens reserved for the answer when compacting. */
    reserveTokens?: number;
    /** How many messages the last compaction dropped. */
    droppedMessages?: number;
}
/**
 * The windows the model was SERVED, plus the read-without-spawn count.
 *
 * The served windows reuse `@builderforce/run-guards`' `CoveredRead` — the read guard
 * already owns what "the model has seen these lines" means — and the delegation
 * counter reuses its `ReadsWithoutSpawnState`. WS2f owns the behaviour in `policy/tools`.
 */
interface ReadCoverageState {
    /** The windows served this run, by the read's canonical key. */
    served: Record<string, CoveredRead>;
    /** Read calls made while no spawn had been attempted — the delegation nudge's counter. */
    readsWithoutSpawn: ReadsWithoutSpawnState;
    stubCount?: number;
    servedStreak?: ServedStreakState;
}
/**
 * The stall policy's re-prompt budget — the count the cloud loop kept on its durable
 * model state (`CloudRunModelState.stallRecoveries`), keyed by the model it was spent
 * against so a model change starts the new one with a full budget. WS2b owns it.
 */
interface StallState {
    /** The model the re-prompts below were spent against. */
    model?: string;
    /** Re-prompts already spent against `model`. */
    recoveriesUsed: number;
    recoveriesTotal?: number;
    rungs?: Record<string, number>;
    said?: string[];
}
/** Plain JSON. Everything any policy needs across a step boundary. */
interface RunState {
    messages: unknown[];
    step: number;
    guards: LoopGuardState;
    finish: FinishGateState;
    model: RunPolicyState;
    memory: RunKnowledgeState;
    compaction: CompactionState;
    writtenPaths: string[];
    askedGates: string[];
    reads: ReadCoverageState;
    context?: ContextPack;
    stall?: StallState;
    preflight?: string;
    downgrades?: string[];
    degradedBy?: string[];
    telemetry?: RunTally;
    taskState?: TaskState;
    forceToolChoice?: "required";
    approvedCalls?: string[];
    parkedCalls?: Record<string, string>;
    advertisedSignature?: string;
    loadedTools?: string[];
}

/**
 * contract — THE contract between the one agent and every entry point (PRD 35 §3.2).
 *
 * An adapter supplies PORTS and nothing else: where the model runs, what the surface
 * can do, where state lives, where events go, how people are reached, what the user
 * steered in, and the context pack. It never supplies a loop, a branch on behaviour or
 * a policy — that is the agent's job. `RunPolicy.entryPoint` is a telemetry label only,
 * NEVER a switch.
 *
 * Every type here is plain data. A run's state crosses a process boundary (a Durable
 * Object tick, a Worker invocation, a VS Code extension host restart) as JSON, so it
 * has to survive a round trip.
 *
 * The types that already have a home are REUSED, never redefined: `RunPolicyState`
 * (`@builderforce/run-policy`), `RunKnowledgeState` and `PolicyGate`
 * (`@builderforce/agent-tools`), `CostLeverId` (`@builderforce/cost-levers`).
 *
 * The finish-gate counters are owned by `policy/finish` (WS2d's port of
 * `cloudAgent/finishGates.ts`) and re-exported here, never restated. The guard state
 * is named here — WS2d's `policy/guards` snapshots into it — because it gathers several
 * owners' shapes (`@builderforce/run-guards`, `@builderforce/run-policy`) into the one
 * slice a step boundary carries.
 */

/** A file, image or document handed to the run. The adapter has already fetched it. */
interface RunAttachment {
    /** The name the model sees. */
    name?: string;
    /** The MIME type when the surface knows it. */
    mimeType?: string;
    /** Inline content — text, or a data URL for an image. */
    content?: string;
    /** A location the surface can read, when the content is not inlined. */
    url?: string;
    /** The size in bytes, when the surface knows it. */
    bytes?: number;
}
interface RunTask {
    runId?: string;
    prompt: string;
    ticketId?: number;
    chatId?: number | string;
    projectId?: number;
    persona?: string;
    request?: string;
    agentName?: string;
    attachments?: RunAttachment[];
    dispatch: {
        source: 'board-sweep' | 'lane-entry' | 'chat' | 'manual' | 'ceremony' | 'subagent';
        approvalId?: string;
        parentRunId?: string;
    };
    workspace?: {
        defaultRepo?: string;
        focusPaths?: string[];
    };
    /** The opening rows when the surface assembles its own prompt (system blocks, prior conversation, the user turn). Absent ⇒ one system row from the persona and prompt. */
    transcript?: RunMessage[];
}
interface RunPolicy {
    entryPoint: EntryPoint;
    toolScope: 'ticket' | 'chat-reply' | 'chat-work' | 'canvas' | 'subagent';
    role: string;
    levers: readonly CostLeverId[];
    budgets: {
        steps?: number;
        tokens?: number;
        /** Tokens held back for the reply when compaction sizes the transcript. Absent ⇒ the host-neutral floor (`compactionReserve`). A surface whose replies are bounded far below it says so here (≤ about a quarter of its smallest window). */
        reserveTokens?: number;
        /** The run's spend cap in USD (priced turns only, `ModelUsage.pricedMc`): the model is told once at 80% to converge, and the run stops with a contained answer at the cap. Absent or 0 ⇒ no cap. */
        usd?: number;
    };
    /**
     * The tools that CHANGE code. The first call to one in an analysis (`plan`) turn is re-asked of the coding model with a brief
     * naming the change the planner was about to make, unless the model policy declines (a pin, a lock). Absent ⇒ no re-ask.
     */
    codeChangeTools?: readonly string[];
    pinnedModel?: string;
    inference: 'local-only' | 'hybrid' | 'specific';
    verify: 'declared-checks' | 'branch-ci' | 'none';
    signoff?: {
        roleKey: string;
        laneKey?: string;
    };
    approvalGates: PolicyGate[];
    delegation: {
        requested: boolean;
        readsBeforeNudge: number;
    };
    /** How the model policy hands a run between models, where the surface's session has a say (routed-around models, strict failover). Absent ⇒ the policy's defaults. */
    modelOptions?: Pick<RunPolicyOptions, 'strictPin' | 'pinReleasable' | 'lockAfterFirstSuccess' | 'preferProvenFailover' | 'strictFailover' | 'excludeModels'>;
    /**
     * How the run's model hand-off starts (additive, optional): whether `pinnedModel` is an explicit
     * pin (asked strictly) or a soft seed, the delegated role the phase rule reads, and the per-phase
     * models. Absent ⇒ a soft pin on a coding run, exactly as before.
     */
    /**
     * What a stall that has nothing left to try does: `finish` ends the run with what it said and the notice (whatever it
     * committed still ships; a surface that lands runs wants this), `fail` stops it unfinished. Default `fail`.
     */
    stallExhausted?: "finish" | "fail" | "note";
    modelStart?: {
        strict?: boolean;
        delegatedRole?: string;
        phaseModels?: {
            verify?: string;
        };
        /** The run-start model when it is a soft seed rather than `pinnedModel`. */
        model?: string;
        /** Start the hand-off as the plain policy (no lock after first success, no releasable pin) — an addressed reply's. */
        plain?: boolean;
    };
}
/** One row of the run's transcript, in the agent's own shape. */
interface RunMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    /** The tool calls the assistant asked for, in the kernel's raw form. */
    toolCalls?: {
        id: string;
        name: string;
        arguments: string;
    }[];
    /** The call this row answers. */
    toolCallId?: string;
    /** This row carries the TASK the run was given: compaction pins it, whatever else the transcript holds before it (a prior conversation). Absent ⇒ the first user row. */
    task?: true;
    /**
     * The row's non-text content (a picture the person attached), beside `content`, which stays the row's TEXT. The transport
     * puts the parts on the wire; token counting reads `content` alone, as it always has, so a picture costs what the
     * existing estimates say it does.
     */
    parts?: RunPart[];
    /**
     * Message-level fields the surface's own transcript needs back (a provider, the usage the model reported, a stop reason, a
     * timestamp). Opaque to the agent: it carries them from the completion or tool result to the row and never reads them.
     */
    meta?: Readonly<Record<string, unknown>>;
    /** This tool row is a FAILED call's answer (a refusal, a thrown tool, a skipped call). */
    isError?: true;
}
/**
 * One part of a row, beside its `content` text. Plain data, so a saved transcript round-trips as JSON.
 *
 * `image` is a picture the person attached (a URL or a data URL). The other kinds are a transport's NATIVE blocks, kept so a
 * row the model wrote or a tool returned reads back exactly as it was written: a signed thinking block and a tool call with
 * its signature are not text, and a provider that continues a conversation needs them back unchanged. The agent never reads
 * the native kinds; it carries them.
 */
type RunPart = {
    type: 'image';
    url: string;
} | {
    type: 'text';
    text: string;
    signature?: string;
} | {
    type: 'thinking';
    thinking: string;
    signature?: string;
} | {
    type: 'toolCall';
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    signature?: string;
};
/** What the agent asks the model for. The transport translates it to its own wire shape. */
interface ModelRequest {
    /** The transcript so far. */
    messages: RunMessage[];
    /** The model the policy pinned, when it pinned one. */
    model?: string;
    /** The tools the surface can run, as the model sees them. */
    tools?: ToolSchema[];
    /** The hard cap for this turn's answer. */
    maxTokens?: number;
    /** The role the model policy asked this turn as (additive; a transport that routes by role reads it). */
    role?: string;
    /** The run phase (`plan` | `code` | `verify`) the turn is asked in (additive; usage rows are stamped with it). */
    phase?: string;
    /** A forced `tool_choice` for this one request (additive). */
    toolChoice?: "auto" | "required";
    /** The model is a hard pin: dispatch ONLY it, no silent swap (additive). */
    strict?: boolean;
    /** Models this turn must not be routed to — the ones the policy already tried and broke (additive). */
    excludeModels?: readonly string[];
    /** Reasoning levers the guards raised for this turn (D1's escalation), merged over the surface's own. */
    reasoning?: {
        thinkLevel?: string;
    };
}
/** A tool call as the model asked for it: the arguments are the RAW JSON string. */
interface ModelToolCall {
    id: string;
    name: string;
    arguments: string;
}
/** What the model spent on the turn. */
interface ModelUsage {
    costMc?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    /**
     * What the turn is WORTH at the surface's own price book, in millicents (additive). Distinct from `costMc`, which is what the gateway BILLED:
     * a surface that bills nothing per call but prices its spend (the editor's run cap) reports it here, and only the run's USD cap reads it.
     * Absent ⇒ the turn has no known price.
     */
    pricedMc?: number;
}
/** What the model answered. */
interface ModelCompletion {
    content: string;
    toolCalls?: ModelToolCall[];
    usage?: ModelUsage;
    model?: string;
    /** Set when the turn was cut off (the output ceiling, an unparseable call) rather than finished. The transport reads its own vendor's finish reason. */
    interrupted?: TurnInterruption$1;
    /** The answer's native blocks (thinking, signed text, tool calls with signatures), kept on the row it becomes. */
    parts?: RunPart[];
    /** The answer's message-level fields, kept on the row it becomes (`RunMessage.meta`). */
    meta?: Readonly<Record<string, unknown>>;
}
/** Where the model runs. The ONE thing an entry point supplies about the model. */
interface ModelTransport {
    complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelCompletion>;
    /**
     * The model's context window, when the transport knows it. The tools policy sizes
     * its result cap from it (§6.10); `undefined` ⇒ the fixed caps of today.
     */
    window?(model: string): number | undefined;
    /**
     * The compaction summarizer's call. A surface whose `complete` is visible to a person
     * (a streamed answer, a provenance row, a failure ledger) answers this one WITHOUT those
     * side effects: a summary is not a turn. Absent ⇒ the policy uses `complete`.
     */
    summarize?(request: ModelRequest, signal?: AbortSignal): Promise<ModelCompletion>;
    /**
     * The BYO preflight (§6.10): before turn 1, which connected accounts the run's model
     * would need cannot be used. The transport refreshes an `expired` token once itself and
     * reports only what is STILL unresolved. Absent ⇒ the preflight reads `ok`.
     */
    preflight?(model: string | undefined): Promise<ModelPreflightResult | undefined> | ModelPreflightResult | undefined;
    /**
     * The models a stalled run may fail over ONTO, in the shared preference order — the tenant's
     * own connected flagships and the plan's curated coding pool. Absent ⇒ the stall policy's
     * default (never the model that just failed).
     */
    fallbackSurface?(): ModelFallbackSurface | null;
    /**
     * The model a stalled run fails over ONTO, chosen by the host from what it already tried (additive). For a host whose successor is
     * decided by a function of the models burned so far (an operator's declared chain) rather than by a surface to rank. `tried` holds
     * every model asked this run, the pin included, in the names the transport answers to. Wins over {@link fallbackSurface}.
     */
    pickFallback?(tried: readonly string[]): string | undefined;
}
/** What a transport's preflight found. Empty `byoUnresolved` ⇒ every connected account resolves. */
interface ModelPreflightResult {
    /** `provider:reason` entries, exactly as the gateway's `x-builderforce-byo-unresolved` header spells them. */
    byoUnresolved: readonly string[];
    /** Providers whose `expired` token the transport refreshed successfully. */
    refreshed?: readonly string[];
    /** The model the run falls back to, when the transport knows it. */
    fallback?: string;
}
/** Where the run's state lives. */
interface RunStore {
    /** The state to resume from, or nothing for a fresh run. */
    load(): Promise<RunState | undefined> | RunState | undefined;
    /** Persist the state at a step boundary, so a later tick resumes from it. */
    save(state: RunState): Promise<void> | void;
    /** The run-end write-back: the consolidated memory the run produced. */
    commitMemory?(consolidated: unknown): Promise<void> | void;
    /**
     * A row joined the transcript, the moment it did (the model's answer, a tool result, a nudge, a steer). A surface whose
     * conversation outlives the run keeps its own log from these: unlike the transcript, which compaction rewrites, the log is
     * append-only. Rows the compaction wrote are not announced.
     */
    appended?(row: RunMessage): void;
    /**
     * Whether an exception a port threw is a RESUMABLE interruption (a platform eviction the host re-arms the run after)
     * rather than the run's failure. Absent ⇒ never: the run fails terminal with its row, `run.finished` and code map. A
     * resumable one writes nothing terminal and the failed outcome carries it as `cause` for the host to re-throw.
     */
    isResumable?(err: unknown): boolean;
}

/** Where the run's events go: the live trace, the timeline, the relay frames. */
interface EventSink {
    emit(event: RunEvent, meta?: {
        durationMs?: number;
    }): Promise<void> | void;
    /** The run's outcome row, written once at the end. */
    outcome?(row: RunOutcomeRow): Promise<void> | void;
}
/** What a human said, or that the run is waiting for one. */
type HumanAnswer = {
    kind: 'answered';
    answer: string;
    approved?: boolean;
} | {
    kind: 'paused';
    approvalId?: string;
};
/** How people are reached: the tool-confirm gate, the approval bar, the relay ask. */
interface HumanChannel {
    /** Ask a question. `paused` parks the run until the answer arrives. */
    ask(question: string, options?: readonly string[]): Promise<HumanAnswer>;
    /** Approve a gate. Optional: a surface with no approvals omits it. */
    approve?(gate: PolicyGate, call?: {
        tool: string;
        args: Record<string, unknown>;
        reason?: string;
        approvalId?: string;
    }): Promise<HumanAnswer>;
}
/** One steered message, as a port that knows more than its text hands it over. */
interface SteerInput {
    text: string;
    /** The person's own words — it interrupts the step in flight (§6.3, E10). */
    interrupt?: boolean;
    /** Attachments the message carried, as data. */
    attachments?: unknown;
    /** The pictures the message carried, as the parts of the row it becomes. */
    parts?: RunPart[];
}
/** What the user steered in since the last step. */
interface SteeringSource {
    /** The messages since the last drain. Empty when nothing was steered. */
    drain(): Array<string | SteerInput> | Promise<Array<string | SteerInput>>;
    /** True while an interrupting message waits. Absent ⇒ steers only land between steps. */
    hasInterrupt?(): boolean;
    /**
     * Messages the person queued to be taken only once the run would otherwise stop (additive). The run continues on them instead of
     * finishing, each as a user turn. Absent or empty ⇒ the run finishes.
     */
    followUp?(): Array<string | SteerInput> | Promise<Array<string | SteerInput>>;
    /** Be told the moment an interrupting message arrives; returns the unsubscribe. */
    onInterrupt?(listener: () => void): () => void;
}
/** The context pack, built once before turn 1 with NO model call (§6.10). */
interface ContextSource {
    pack(task: RunTask): Promise<ContextPack> | ContextPack;
    /**
     * Sections the surface adds to EVERY turn's volatile tail, rebuilt per request and never
     * persisted (the cloud's evolving affect block). Absent ⇒ the tail carries the pack and
     * the brief only.
     */
    turnSections?(): readonly string[];
}
/**
 * Tools the surface runs itself, beside the registry's (the cloud's curated platform tools,
 * an addressed reply's chat-scoped set). The agent advertises `schemas`, and dispatches a call
 * whose name `handles` to `dispatch` — the surface owns what the tool does, the agent owns
 * when it may be called (the same gates, caps and coverage as every other tool).
 */
interface ToolExtension {
    /** The tools to advertise. */
    schemas(): readonly ToolSchema[];
    /** Whether this extension runs `name`. */
    handles(name: string): boolean;
    /** Run the call. A thrown error is the tool's failure, never the run's. */
    dispatch(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{
        data: unknown;
        isError?: boolean;
        control?: {
            kind: 'finish';
            summary: string;
        };
    }>;
    /**
     * A turn whose calls end the run before any of them dispatches (an addressed reply's `ask_user`): the output to
     * settle with, or nothing to let the calls run. `content` is what the turn said.
     */
    terminalTurn?(turn: {
        content: string;
    }, calls: ReadonlyArray<{
        name: string;
        args: Record<string, unknown>;
        malformed: boolean;
    }>): string | undefined;
    /** Shape the result of a tool the REGISTRY ran (the surface saves a snapshot the model reads a summary of). Absent ⇒ as-is. */
    shape?(name: string, data: unknown): Promise<unknown> | unknown;
}
interface RunPorts {
    model: ModelTransport;
    capabilities: CapabilityProvider;
    store: RunStore;
    events: EventSink;
    human: HumanChannel;
    steering?: SteeringSource;
    context: ContextSource;
    platform?: PlatformTools;
    delivery?: DeliveryLedger;
    extensions?: ToolExtension;
    tools?: readonly ToolDefinition[];
    spend?: SpendMeter;
    attach?(run: RunView): void;
}
/** The run's spend, as the USD cap reads and feeds it (`RunPolicy.budgets.usd`). */
interface SpendMeter {
    /** Millicents spent so far, across every run that shares the meter. */
    spentMc(): number;
    /** Calls that had no known price, so the spend is a floor. */
    unpricedCalls(): number;
    /** The tightest cap any run on the meter was started with, when one is tighter than this run's own. */
    capMc?(): number | undefined;
    /** One turn answered: its price, or undefined when it has none. */
    add(pricedMc: number | undefined): void;
}
/** The live run, handed to the surface once (`RunPorts.attach`): the one place it reads the model policy and advances it. */
interface RunView {
    /** The model hand-off policy's state as it stands NOW. */
    policy(): RunPolicyState;
    /** Report an event to the model hand-off policy; the new state is the run's. */
    report(event: RunPolicyEvent): RunPolicyState;
}
/** Volatile per-run context. It goes in the turn-context block, never in the cached prefix. */
interface ContextPack {
    focus: Array<{
        path: string;
        outline?: Array<{
            heading: string;
            line: number;
        }>;
        content?: string;
    }>;
    chat?: {
        tickets: unknown[];
        runs: unknown[];
    };
    repos?: Array<{
        repo: string;
        branch: string;
        dirty: string[];
    }>;
    facts: Array<{
        key: string;
        content: string;
    }>;
    recall: string[];
    /** A deterministic answer found before any model call (a PreFetch tool reply): the run settles on it, and no model is asked. */
    answer?: string;
}
type RunOutcomeKind = 'finished' | 'paused' | 'yielded' | 'failed';
type RunOutcome = {
    kind: 'finished';
    output: string;
    state: RunState;
} | {
    kind: 'paused';
    question: string;
    approvalId: string;
    state: RunState;
} | {
    kind: 'yielded';
    state: RunState;
} | {
    kind: 'failed';
    reason: string;
    state: RunState;
    cause?: unknown;
    exhausted?: boolean;
};

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
 * The Brain's chat titles: the placeholder an untitled chat carries and the pure, LLM-free derivation of a real one from the first
 * user message. Extracted from `useBrainChats` (the chat list + CRUD hook), which only needs to ask whether a chat is still untitled.
 */
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
    /** The draft on screen's token (minted when it has none) without counting a send: for a creation asked for with no token of its own (`ensureChatId()`), and for a tokenless `conv.send` from a draft, which adopts it so its Stop entry is under the token the door's Stop names. A send that `begin`s names its own. */
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
    /** A chat was deleted: every token that resolved to it is forgotten (a late send naming one must create anew, never be handed the deleted chat). Returns them. */
    forgetChat: (chat: number) => DraftToken[];
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
    /** The draft's binding (`useChatCreation().drafts`): a send from a draft that names no token adopts the one on screen, so every send owns a Stop entry. */
    drafts?: DraftBinding;
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
     * running. Pair with `sending` to drive a Stop button. On a draft view `draft` is the token of the draft showing;
     * `undefined` for a host with no binding (its one creation is the draft).
     */
    stop(draft?: DraftToken): void;
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
 * The web and Rovr hosts' opt-in to the one agent (PRD 35 WS4): `builderforce.runEngine` in
 * `localStorage`, or `?runEngine=agent` on the page URL, which stores it. ONE reader for both
 * hosts, read once at each host's request site and carried on `BrainRunRequest.engine`. It
 * selects the engine and nothing else; it goes away when the ship gate flips the default.
 * Storage can be blocked or absent (a private window, a worker), so every touch is guarded.
 */

/** The device's stored engine choice, or undefined when it never made one (⇒ the Brain's default). */
declare function storedRunEngine(): RunEngineId | undefined;
/** The request fragment a host spreads into its run request: the stored engine, or nothing. */
declare function storedRunEngineField(): {
    engine: RunEngineId;
} | Record<string, never>;

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
/** Put steers a continuation could not act on back at the FRONT of the run's inbox, in order, each with its own flags and key. */
declare function requeueRunSteering(runKey: number, steers: readonly RunSteerMessage[]): void;

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
 * The Brain's CONTEXT SOURCE (PRD 35 §3.2 `ContextSource`, §6.10) — the task context pack,
 * built ONCE before turn 1 with no model call.
 *
 * The host gathers the pack's parts (the editor: `clients/vscode/src/contextPack`) and the
 * request carries them as `servedReads` (the focus files it showed whole). This is the
 * port over them: nothing is read here, nothing is decided, and a part the host could not
 * gather is simply absent — the pack is best-effort by contract. A host that gathers more
 * (chat state, git state, `codemap:` facts) passes its own structured pack as `gather`.
 */

/** A host's own structured pack, when it builds more than the focus files. */
type GatherContextPack = (task: RunTask) => Promise<ContextPack | undefined> | ContextPack | undefined;

/**
 * The Brain's EVENT SINK (PRD 35 §3.2 `EventSink`) — the agent's typed `RunEvent` stream
 * rendered as the live trace the panel shows and the durable step rows a reopened chat
 * reads. The labels are the ones every diagnostics reader already keys on
 * (`model.preflight`, `llm.model_downgrade`, `steer.applied`), so a run driven by the agent
 * reads exactly like one driven by the Brain's own loop.
 *
 * The sink renders; it never decides. A run's lifecycle events (`run.started`,
 * `turn.started`, `run.finished` …) have no step of their own — the run cell's `running`
 * flag and activity already say what they say — and are not recorded.
 */

/** Where the run's outcome row goes — the host's usage ledger / learned-routing report. */
type OutcomeReport = (row: RunOutcomeRow) => Promise<unknown> | void;

/**
 * The Brain's MODEL PORT (PRD 35 §3.2 `ModelTransport`).
 *
 * `BrainStreamFn` is the surface's one way to a model: the gateway, or — behind the same
 * function — the local-first transport (`localFirstTransport.ts`: the on-device model first,
 * then the cloud) and the XML tool-call lifting (`xmlToolCalls.ts`) that turns a dialect's
 * call markup back into structured calls. This wraps that function as the agent's port:
 * it translates the agent's request into the stream's options, passes the streamed deltas to
 * the surface's live view, and translates the result back. It decides nothing about WHICH
 * model, WHEN to retry or WHAT to offer — those are the agent's (`policy/model`, `policy/tools`).
 *
 * Also answers the two questions the agent asks of a transport:
 *   - `window(model)` — the model's context window from what the host already knows (its
 *     gateway catalog, the shipped local catalog), sync; `undefined` keeps today's caps;
 *   - `preflight(model)` — the host's BYO health check (PRD 35 E7), run once before turn 1.
 */

/** What the surface fixes for every call of the run (the request's own routing choices). */
type BrainCallDefaults = Partial<Pick<StreamChatOptions, 'routingMode' | 'modelStrict' | 'reasoning' | 'metadata' | 'role' | 'excludeModels' | 'prompt_cache_key' | 'conversationKey'>>;
/**
 * One turn's session with the surface's live view and record: the stream's handlers, the call's extra metadata, the window
 * fit the request passes through, and what the turn leaves when it completes or fails. The surface builds it per request
 * (`loopTurn.ts` over the run cell); the transport only calls it.
 */
interface TurnSession {
    handlers: StreamHandlers;
    metadata?: CompletionMetadata;
    /** Pack the wire messages for the model's window. */
    fit?(messages: ChatCompletionMessage[]): Promise<ChatCompletionMessage[]>;
    /** The call's per-conversation routing keys. */
    call?: BrainCallDefaults;
    /** Run the stream inside the surface's live-turn window (the serving model is recorded while it is open). */
    around?<T>(stream: () => Promise<T>): Promise<T>;
    completed(result: StreamChatResult): Promise<void> | void;
    /** The turn failed: record it and hand back the error to throw. */
    failed(error: unknown): unknown;
}
interface TurnObserver {
    open(request: ModelRequest): TurnSession;
}
interface BrainModelTransportDeps {
    /** The surface's live view and record of each turn. Absent ⇒ the stream runs bare. */
    turn?: TurnObserver;
    /** The surface's streaming completion — gateway, local-first and XML lifting behind it. */
    stream: BrainStreamFn;
    /** Where a turn's streamed deltas, serving model and connect retries go (the live view). */
    handlers?: () => StreamHandlers;
    /** Per-call routing the request fixed for the whole run. */
    call?: BrainCallDefaults;
    /** What the host knows about model windows — its gateway catalog and live local runtimes. */
    windows?: Pick<RunWindowSources, 'cloud'>;
    /** The host's BYO health check — awaited once before the first turn. */
    preflight?: () => Promise<ModelPreflightResult | undefined>;
}
/** Build the Brain's `ModelTransport` over its streaming function. */
declare function brainModelTransport(deps: BrainModelTransportDeps): ModelTransport;

/**
 * webAdapter — the Brain's surfaces adapted to the ONE agent (PRD 35 §3.1 / §4 WS4).
 *
 * Web, Rovr and — through its own thin adapter (`clients/vscode/src/run/vscodeAdapter.ts`) —
 * the editor run the same code here. An adapter ONLY builds ports and the policy DATA:
 * it has no loop, no branch on behaviour and no policy. `RunPolicy.entryPoint` is the label
 * the outcome row carries (`'web'` / `'rovr'` / `'vscode'`); nothing reads it to decide what
 * the run does.
 *
 * Every port is the Brain's existing machinery, wrapped (`./modelTransport.ts`,
 * `./eventSink.ts`, `./runStorePort.ts`, `./humanChannel.ts`, `./contextSource.ts`), and the
 * steering port is the run-keyed composer queue the agent owns
 * (`@builderforce/agent-run` `runSteeringSource`) — the same inbox `queueRunSteering` posts to.
 */

/** The telemetry label of the surface the run came in through. */
type BrainEntryPoint = 'web' | 'rovr' | 'vscode';
/** Everything an adapter needs to build the ports of ONE Brain run. */
interface BrainRunBinding {
    /** Which surface: the telemetry label. Never a switch. */
    entryPoint: BrainEntryPoint;
    /** The run's cell (its live view, single-flight claim and transcript). */
    cell: RunCell;
    /** The cell's key — also the key of the run's steering inbox. */
    runKey: number;
    /** The request the host handed the run. */
    req: BrainRunRequest;
    /** What the surface can physically do: its tool catalog as capabilities. */
    capabilities: CapabilityProvider;
    /** The user's own words for this run. */
    request: string;
    /** How many of the cell's transcript rows open the run (the store appends after them). */
    seeded?: number;
    /** The host's richer structured context pack, when it gathers more than the served files. */
    gatherContext?: GatherContextPack;
    /** The streamed deltas / serving model / connect retries go here — the live view. */
    handlers?: Parameters<typeof brainModelTransport>[0]['handlers'];
    /** Per-call routing the request fixed for the whole run. */
    call?: BrainCallDefaults;
    /** The host's run-end memory commit (codemap facts, the session note). */
    commitMemory?: (consolidated: unknown) => Promise<void> | void;
    /** Where the uniform outcome row goes. */
    reportOutcome?: OutcomeReport;
    /** Governance gates compiled for this run — the human channel's approvals. */
    approvalGates?: readonly PolicyGate[];
    /** The surface's live view and record of each turn (`loopTurn.ts`). */
    turn?: TurnObserver;
    /** The surface's own tools, when it runs them itself (`brainPlatformTools.ts`). */
    platform?: PlatformTools;
    /** Where the run's steered direction comes from, when the surface records it as it is read (`loopSteering.ts`). */
    steering?: SteeringSource;
    /** Where the run's state lives, when the surface keeps its own log (`loopStore.ts`). */
    store?: RunStore;
}
/** The ports of one Brain run — built from the request, deciding nothing. */
declare function buildBrainRunPorts(b: BrainRunBinding): RunPorts;
/** The task of one Brain run. */
declare function brainRunTask(b: Pick<BrainRunBinding, 'req' | 'request'>, defaultRepo?: string): RunTask;
/**
 * The policy DATA of one Brain run. Every field is read off the request or the device —
 * the same facts the Brain's own loop reads — and none selects behaviour by surface.
 */
declare function brainRunPolicy(b: Pick<BrainRunBinding, 'entryPoint' | 'req' | 'request' | 'approvalGates'>): RunPolicy;

/**
 * runViaAgent — one Brain run, driven by THE one agent (PRD 35 §3.1).
 *
 * The call a surface's run entry makes: it builds the run's ports and policy from the
 * binding (`./webAdapter.ts`) and hands them to `runAgent`. There is no loop here and no
 * policy — the agent owns both; this only joins the Brain's cell to it (the cell's Stop is
 * the run's signal).
 */

/** Drive the run described by `binding` to its outcome. */
declare function runViaAgent(binding: BrainRunBinding, opts?: {
    defaultRepo?: string;
}): Promise<RunOutcome>;

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
    stop?: (draft?: DraftToken) => void;
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

export { ADDRESSED_TO_META_KEY, AGENT_POOL_PATHS, API_VERSION_PROBE_TIMEOUT_MS, API_VERSION_TTL_MS, ASK_USER_TOOL, ASK_USER_TOOL_SPEC, AUTHORED_BY_META_KEY, type AgentDispatchActivity, type AllowanceState, type ArmedNewChat, type ArtifactKind, type AskUserMessageLike, type AskUserOption, type AskUserPayload, type AskUserToolSpec, AttachmentRefusedError, BACK_TO_BACK_AT, BASE_BRANCHES, BRAIN_AGENT_ASSIGNMENTS_PATH, BRAIN_UPLOAD_PATH, BRAIN_UPLOAD_SIGN_PATH, BROWSER_ENGINE_FALLBACK_CONTEXT_TOKENS, BROWSER_ENGINE_MODEL, BUILDERFORCE_PRODUCT_NAME, BfiWorkerEngineOptions, type BrainAction, type BrainActionsContextValue, BrainActionsProvider, BrainChat, type BrainConfig, BrainContextProvider, type BrainContextValue, BrainDiagnostics, type BrainEntryPoint, BrainMessage, BrainModality, type BrainPageContext, type BrainPersistenceAdapter, type BrainPersonaAgent, type BrainPersonaChoice, BrainProvider, type BrainRestInit, type BrainRestOptions, type BrainRestPersistence, type BrainRestRequest, BrainRunActivity, type BrainRunBinding, type BrainRunDriver, type BrainRunEngine, BrainRunPersistence, BrainRunRequest, BrainRunSnapshot, type BrainRuntime, BrainStreamFn, BrainToolSpec, BrainTraceEvent, BrainTransport, type BriefContext, type BrowserEngineProber, type BuildChatDiagnosticsReportInput, CHAT_DIAGNOSTICS_SCHEMA_VERSION, CODE_CHANGE_TOOLS, CONNECT_RETRY_DELAYS_MS, type CachedRead, type ChatActivity, type ChatActivityLabels, type ChatBindingPort, ChatCompletionMessage, type ChatCreation, type ChatCreationOptions, type ChatDiagnosticsAccount, type ChatDiagnosticsData, type ChatDiagnosticsEvermind, type ChatDiagnosticsEvermindHead, type ChatDiagnosticsHistory, type ChatDiagnosticsMessageLike, type ChatDiagnosticsMeter, type ChatDiagnosticsModelSurface, type ChatDiagnosticsPlanSnapshot, type ChatDiagnosticsProvenance, type ChatDiagnosticsReport, type ChatDiagnosticsRun, type ChatDiagnosticsRuns, type ChatDiagnosticsSources, ChatErrorAction, ChatInputAttachment, ChatMode, type ChatModelOptions, type ChatModelSelection, ChatRosterAgent, type ChatStateGet, type ChatTicket, type ChatTurns, type ChatTurnsOptions, CompletionMetadata, type ComposerDirectiveOptions, type ComposingActivity, type ComposingOptions, type ComposingSink, type ConnectRetryOptions, ContentPart, type ContextPack, type ContextUsage, type CreatedWorkItemLink, DEFAULT_AGENT_MODEL_SENTINEL, DEFAULT_CHAT_ACTIVITY_LABELS, DEFAULT_CHAT_TITLE, DEFAULT_MODEL_CHOICE_LABELS, DEFAULT_MODEL_FALLBACK_TEMPLATE, DEFAULT_MODEL_IDENTITY, DEFAULT_PERSONA, DEFAULT_ROUTE_THRESHOLD, DEFAULT_TOOL_FAILURE_STREAK, DEFAULT_TOOL_LIMIT, type DirectedGroup, type DirectedRecipient, type DraftBinding, type DraftOutcome, type DraftToken, EMPTY_GATEWAY_MODEL_OPTIONS, Effort, EvermindRunHooks, FAILURE_HARD_AT, FAILURE_NUDGE_AT, FILE_DELIVERY_RULE, FailureTally, type GateReport, type GateRouteStats, type GatewayJsonRequest, type GatewayModelOptions, type GatewayModelSurface, type GitShortStatus, GlobalRunState, HAND_OFF_TOOL, HAND_OFF_TOOL_SPEC, type HandOffOutcome, type HandOffPlan, type HandOffPorts, type HandOffTask, type HandoffFitOptions, HfModelStore, type HostLocalPin, type HostModelStreamInput, INFERENCE_MODES, type IdleWatchdogOptions, type IdleWatchdogReader, type ImageEncodeDecision, type ImagePrepOptions, type IndexedDbStepDurabilityOptions, type InferenceMode, type InlinedAttachments, type KeyedSlot, LOCAL_PICKER_GROUPS, LOCAL_SKIP_CONFIDENCE, LOCAL_SKIP_EXPLORE, LOCAL_WORKSPACE_TOOLS, type LinkedTicketToAdvance, type LocalAttemptFit, type LocalBrainPersistenceOptions, type LocalChatIdentity, type LocalChatMessage, type LocalFetch, type LocalFirstStreamInput, type LocalModelRow, type LocalModelState, type LocalModelStore, type LocalPickerGroup, type LocalPickerView, type LocalRatingVerdict, type LocalStreamRoute, type LocalSuccessContribution, type LocalSuccessFederation, type LocalSuccessFleetHead, type LocalSuccessSnapshot, type LocalSuccessStore, MAX_INLINE_TEXT_BYTES, MAX_TOOL_RESULT_CHARS, MODALITY_PERSONAS, MODEL_CATEGORIES, type McpToolEntry, type McpToolResultInfo, type McpToolStatus, type MentionToken, type MessageProvenance, type MessageRatings, type ModalityPersona, type ModelCategory, type ModelChoiceLabels, type ModelFallbackChannel, type ModelFallbackEvent, type ModelFallbackSurface, type ModelIdentityContext, type ModelItem, NOT_STARTED_TASK_STATUSES, ON_DEVICE_ANSWER_THRESHOLD, type OnDeviceAnswerStore, type OnDeviceStoreScope, PERSONA_MODALITY_IDS, PMO_FOCUS_PARAM, PREVIEW_REVIEW_TOOL, PROJECT_EVERMIND_MODEL_PREFIX, PROVENANCE_META_KEY, type PackForModelInput, type PackForModelResult, PageEngine, type PageEngineSet, type PageEngineSetOptions, type PageRuntimePin, type ParsedXmlToolCall, type PayloadBudget, type PayloadBudgetOptions, type PayloadBudgetStats, type PendingAskUser, type PersistedStep, type PersonaModalityId, type PlaceholderHit, type PoolAgent, type PoolRegisteredAgentRow, type PoolRequest, type PoolWorkforceAgentRow, type PrefetchConfirm, type PreparedImage, ProjectMemoryRequest, type PromptApiAvailability, type PromptApiFactory, type PromptApiMessage, type PromptApiSession, PromptInput, type PromptInputProps, type ProvenanceAccount, type ProviderFailureEvent, type QueuedItem, type QueuedTurns, type QueuedTurnsOptions, READ_FILE_RESULT_CHARS, REVISIT_HARD_AT, REVISIT_NUDGE_AT, RUN_REFRESH_MS, type RatableMessage, type RatedTurnContext, ReadCoverage, type ReadVisit, ReasoningIntent, type RecipientChoice, type RecordAvoidedCallInput, type RestorableTurn, type RouteReport, type RouteRunRecord, type RoutedProduct, RunEndOutcome, type RunEngineControl, RunEngineId, RunKey, type RunMilestoneActivity, type RunMilestonePhase, type RunNoteStep, type RunOutcomeValue, type RunPolicy, type RunPorts, RunProgress, type RunSteerMessage, type RunTask, RunTurn, type RunUsageLedger, type RunUsageValue, RunWindowSources, STOPPED_TURN_META_KEY, STOPPED_TURN_STEP, STREAM_IDLE_MS, STUDIO_WORKSPACE_TOOLS, type ScoreBin, type SendContext, SpendSavingsSummary, StaffingSummary, type SteerTurn, type StepDurability, type StepOutgoingMessage, type StoppedTurnSource, StreamChatOptions, StreamChatResult, StreamHandlers, StreamIdleError, type SubagentDiagnosticsInput, type SummaryStreamFn, TICKET_RECORDING_TOOLS, TOOL_ROUTER_DESCRIBE, TOOL_ROUTER_FIND, TOOL_ROUTER_INVOKE, type TicketTag, type TicketToken, type ToolCatalogMatch, type ToolConfirmationGate, type ToolConfirmationGateOptions, type ToolConfirmationPersistence, type ToolSelection, type TrimOptions, type TrimmedToolResult, type TurnInterruption, UNSCOPED_MUTATION_TOOLS, type UnreviewedChangeInput, type UnshippedChangeInput, type UsagePipelineRoute, UsageSurface, type UseBrainChats, type UseBrainChatsOptions, type UseBrainConversation, type UseBrainConversationOptions, type UseMcpExtensionsOptions, WEB_FETCH_TOOL_NAME, type WindowFitTrace, XmlToolCallFilter, activeHashtagToken, activeMentionToken, activeModelKey, activeTicketToken, activityIcon, activityMessageCount, activityTone, agentPersonaChoice, agentPersonaPrompt, allowanceState, announcesUntakenAction, appendRunMessage, applyRemoteRun, artifactRoutePath, asProvenanceAccount, askUserAnchorId, askUserBlock, attemptedPublish, bindChatHistoryForSync, brainPersonaAgents, brainRunPolicy, brainRunTask, brainUploadUrl, buildBrainRunPorts, buildChatDiagnosticsReport, buildComposerDirectives, buildModelItems, byoVendorLabel, callCostOrUnknown, canChangeCodeHere, canReviewInPreview, canRunInParallel, canShipHere, catalogToolNamesMentionedIn, chatActivityText, chatDoorLiveness, chatWorkLinkingDirective, childTaskBrief, claimsMissingToolData, classifyModelFunding, clearRunError, codeChangeFile, codeChangesOf, coerceAskUserPayload, completeLocal, completeLocalFirst, composeEvermindHooks, contextUsageOf, createBrainRestPersistence, createBrowserEngineProber, createComposingActivity, createDraftBinding, createHandoffFit, createHostModelStream, createLocalBrainPersistence, createLocalChatIdentity, createLocalFirstStream, createLocalStream, createLocalSuccessFederation, createModelFallbackChannel, createPageEngineSet, createPayloadBudget, createRunUsageLedger, declinesReview, declinesShipping, defaultInferenceMode, deferredLocalModelStore, deriveChatTitle, describeNetworkError, describeTool, directedAgentRecipients, dirtyPathsOf, displayModelName, drainRunSteering, executeHandOff, extractXmlToolCalls, failureReason, fetchApiVersionVia, fetchMcpToolEntries, filterMentionCandidates, filterModelItems, filterTicketCandidates, findTools, forgetResolvedModels, formatAssistantTranscriptHeading, formatChatDiagnostics, formatChatDiagnosticsReportJson, formatRunProgress, formatSubagentDiagnostics, gateAcceptedSince, gatewayCanChooseModel, gatewayModelIdentity, gatewayModelWindows, gatewayPlanIsPaid, gatewayPlanModels, gatherChatDiagnostics, getGlobalRunState, getLastResolvedModel, getMcpToolStatus, getRunDriver, getRunSnapshot, getRunTrace, handleRouterCall, hasPromptApi, hasWebGPU, inferenceModeForModelPick, installIndexedDbStepDurability, installRunDriver, installStepDurability, invalidateGatewayModelOptions, isActivityMessage, isCodeChangeTool, isCoderReask, isConnectFailure, isConnectedAccountUnused, isDirectedToParticipant, isFallbackFailure, isInferenceMode, isLive, isLocalWorkspaceTool, isMalformedToolCall, isManagerRole, isModelReply, isReadOnlyShellCall, isRepoPublishTool, isRouterTool, isRunning, isStoppedBeforeStart, isStoppedTurn, isTicketRecordingTool, isTruncatedTurn, isUnscopedMutationTool, isUserConfiguredModelRef, joinRestorableTurns, lastServedModel, leftChangeUnreviewed, leftChangeUnshipped, linkedTicketsToAdvance, linkedTicketsToComplete, loadAgentPoolVia, loadBrainPersonaAgentsVia, loadGatewayModelOptions, loadOnDeviceAnswerStore, localFirstApplies, localFirstWorkload, localPickerView, localRatingVerdict, localStorageConfirmationPersistence, localToolsIn, localTransport, mcpActionsFrom, mentionRecipient, modalityPersonaChoice, modelCategoryLabel, modelFallbackText, modelInUse, nextFallbackModel, noteRunStep, onDeviceMemoryHooks, packForModel, pageEnginesFetch, pageRuntimePin, parseAskUser, parseChatActivity, parseDirectedRecipients, parseGitShortStatus, parseHandOff, parseMessageAuthor, parseMessageProvenance, parsePmoFocus, parseStepMessage, perMillionUsd, personaAgentOf, personaModalityOf, personaModel, personaOverlay, personaSystemPrompt, personalitySetpoints, placeholderAdvisory, placeholdersWritten, planMessage, pmoFocusDomId, pmoFocusValue, poolAgentsFrom, prefetchConfirmOf, premiumCostLabel, prepareImageDataUrl, previewReviewDirective, probePageEngines, productForPlan, productModelName, progressDuration, promptApiAvailability, promptApiFactory, promptApiInputQuota, promptApiMeasure, promptStreamDeltas, providerFailureEvent, providerFailureTrace, queueRunSteering, ratedTurnContext, ratedTurnTool, readChatRunHistory, readChatTicketLinks, readWithIdleWatchdog, repeatedFailureAdvisory, requeueRunSteering, resetApiVersionCache, resetBrainRunStore, resetOnDeviceStoresForTests, resolveBrainStream, resolveRecipient, resolveRunConfirm, restoreTurn, retryOnConnectFailure, revealsModelId, revisitAdvisory, routeRunRecords, routerToolSpecs, routingModeForSelection, routingQueryForTurn, runAbortSignal, startRun as runBrainLoop, runOutcomesSince, runProgressVerdict, runViaAgent, savePendingPrompt, selectPendingAskUser, selectToolsForTurn, selfReviewShipDirective, serializeAskUser, setLastResolvedModel, setMcpToolStatus, shippedToBaseBranch, signedBrainFileUrl, slotKeyedRows, stableStringify, startEngineRun, startRun, startsRun, steerModelContent, steersByDefault, stepRow, stepSig, stopBeforeStart, stopRun, stoppedBeforeStartRow, stoppedTurnMetadata, storedRunEngine, storedRunEngineField, streamSummaryCompletion, stripAskUser, studioToolsIn, submitLocalTurnVerdict, subscribeRun, subscribeRunStore, subscribeToChatMessages, summarizeGateRuns, summarizeRouteRuns, takePendingPrompt, ticketsReviewedInPreview, toPromptApiTurn, toolCallArgBytes, toolNamesMentionedIn, toolSchemaTokens, toolSpecsFor, traceWithPersistedSteps, transcriptSeedOf, transportRetryTrace, trimToolResult, turnAffectBlock, turnInterruption, turnOptimizationDirective, unreviewedChangeNudge, unshippedChangeNudge, usageRowsSince, useArmedNewChat, useBrainActions, useBrainChats, useBrainConfig, useBrainContext, useBrainConversation, useChatCreation, useChatTurns, useComposerDraft, useMcpExtensions, useOptionalBrainContext, useQueuedTurns, useRegisterBrainActions, useRunRefreshTick, useRunSnapshot, useToolConfirmationGate, utf8ByteLength, webStorageLocalSuccessStore, withAdvisory, withDirectedMetadata, withObservedModel, withProvenanceMetadata, withRating, withReadyPageModels, withRunUsage, withUsageSurface, workItemLinkFromCreate };
