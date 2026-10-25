import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Canonical writer for `llm_usage_log` — the single insert site shared by every
 * usage-producing surface (the gateway chat/image routes via `logUsage`, and the
 * cloud-agent execution loop via `recordCloudUsage`).
 *
 * Before this existed, the gateway route logged usage one way and cloud runs
 * recorded only to `usage_snapshots`, so the billing ledger and the agent-usage
 * ledger were disjoint and could not be reconciled or split by cloud-vs-on-prem.
 * Centralizing the insert + the attribution dimensions (agent_host_id /
 * cloud_agent_ref / execution_id, added in migration 0096) fixes that: every row
 * now carries who produced it, so a single query can break tokens (and derived
 * cost) down by ON-PREM vs CLOUD vs WEB.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { llmUsageLog } from '../../infrastructure/database/schema';
import type { LlmUsage } from './LlmProxyService';
import { listPriceOf, loadPriceBook } from './catalogView';
import { buildTransactionalDatabase, hasSiblingDatabase, siblingDatabaseOf } from '../../infrastructure/database/connection';
import { clearProviderAuthAlertAfterByoSuccess } from './providerAuthAlerts';
import { providerForVendor } from './llmProviderCatalog';
import { sql, type SQL } from 'drizzle-orm';
import { addUsageToTenantTotals, getTenantUsageTotalsForEnv } from './tokenUsage';
import { pickPersistedMetadata } from './usageMetadata';
import { loadTenantProviderRows } from './tenantProviderRows';
import { computeCostMillicents, type UsageSurface } from '@builderforce/spend-contract';
import { COST_LEVER_ARMS_KEY, costLeverArmsStamp } from '../costMetrics/leverArms';

/** The cache-tier multipliers and the per-call cost rule (millicents, cache tiers
 *  discounted, 0 for an unpriced model) are the shared cost rule in
 *  `@builderforce/spend-contract` — a device prices its own calls with the same one. */
export { CACHE_CREATION_MULTIPLIER, CACHE_READ_MULTIPLIER, computeCostMillicents } from '@builderforce/spend-contract';

/** Provider batch APIs (Anthropic Message Batches, OpenAI Batch) bill every token tier at
 *  half the synchronous rate. Applied to the catalog price, so the cache multipliers above
 *  still split the discounted input price. */
export const BATCH_PRICE_MULTIPLIER = 0.5;

/** How a call was billed by its provider: the ordinary synchronous rate, or the batch rate. */
export type UsagePricingTier = 'standard' | 'batch';

/** The per-token prices a call is billed at for its pricing tier. Pure. */
export function pricingForTier(
  pricing: { prompt: number; completion: number } | undefined,
  tier: UsagePricingTier | null | undefined,
): { prompt: number; completion: number } | undefined {
  if (!pricing || tier !== 'batch') return pricing;
  return { prompt: pricing.prompt * BATCH_PRICE_MULTIPLIER, completion: pricing.completion * BATCH_PRICE_MULTIPLIER };
}

/** Default daily paid-overflow $ ceiling (millicents, 1/100000 USD) for a FREE
 *  tenant with no explicit cap — $0.50/day. Paid plans (pro/teams) are treated
 *  as effectively unlimited unless they set an explicit cap. See migration 0130
 *  and the gateway overflow gate. */
export const DEFAULT_PAID_OVERFLOW_CAP_MILLICENTS = 50_000; // $0.50

/** Flat surcharge (millicents, 1/100000 USD) added on top of the metered OpenRouter
 *  token cost for a PREMIUM model selection — the "any paid OpenRouter model" tier a
 *  paid tenant with a validated card unlocks. 1¢ = 1000 millicents. Applied once per
 *  request (not per token), so the billed cost is exactly "OpenRouter cost + a penny".
 *  See `isPremiumModelSelection` (the gate) and the gateway `premiumSurcharge` flag. */
export const PREMIUM_REQUEST_SURCHARGE_MILLICENTS = 1_000; // $0.01 / request

/**
 * Default daily PREMIUM $ ceiling (millicents) for a tenant with no explicit cap —
 * $10.00/day.
 *
 * A DEFAULT, not unlimited, and that is the point. Premium lets a paid tenant pin any
 * paid OpenRouter model, including Opus-class ids at ~$75/M output; entitlement was
 * the only gate, so a runaway agent could bill without bound inside one UTC day and
 * the first signal was the invoice. $10/day is deliberately far above ordinary
 * interactive use (hundreds of premium turns) and far below a runaway loop, so it
 * reads as a circuit breaker rather than a quota. A tenant that genuinely needs more
 * sets an explicit cap — or `-1` to opt out entirely.
 */
export const DEFAULT_PREMIUM_DAILY_CAP_MILLICENTS = 1_000_000; // $10.00

/**
 * Resolve a tenant's effective daily PREMIUM cap (millicents) from its per-tenant
 * override + effective plan. Same three-state convention as
 * {@link resolvePaidOverflowCapMillicents} so an operator learns one rule:
 *   • override === -1  → -1 (unlimited; the caller skips the gate)
 *   • override >= 0    → that explicit value
 *   • override null    → {@link DEFAULT_PREMIUM_DAILY_CAP_MILLICENTS}
 *
 * Unlike the overflow cap this does NOT vary by plan: premium is a paid-plan feature
 * to begin with, so "free tenants get a tighter default" has nothing to say here —
 * a free tenant cannot reach premium at all.
 */
export function resolvePremiumDailyCapMillicents(
  override: number | null | undefined,
): number {
  if (override === -1) return -1;
  if (override != null && override >= 0) return override;
  return DEFAULT_PREMIUM_DAILY_CAP_MILLICENTS;
}

/**
 * Has this tenant spent its daily PREMIUM budget?
 *
 * Lives here, beside the cap resolver, because TWO surfaces have to agree on the
 * answer and they reach it from different places: the gateway route (which has a
 * Hono context) and the cloud agent loop (which has a bare `Env` and no request).
 * A second copy in either would be the classic drift — the route refusing a pin the
 * loop happily dispatched.
 *
 * Best-effort by design: a query error returns `false`. Refusing a paid, entitled
 * request because a metering query hiccuped is the worse failure of the two, and the
 * cap is a circuit breaker rather than an accounting control.
 */
export async function isPremiumCapExhausted(
  env: Env,
  tenantId: number,
  capOverride: number | null | undefined,
  opts?: { isSuperadmin?: boolean },
): Promise<boolean> {
  if (opts?.isSuperadmin) return false;
  const cap = resolvePremiumDailyCapMillicents(capOverride);
  if (cap < 0) return false; // unlimited
  try {
    // The shared cached totals read the SAME database the rows are written to
    // (`resolveUsageDatabase`), so a split deployment never sums an empty primary copy.
    const totals = await getTenantUsageTotalsForEnv(env, tenantId);
    return Math.max(0, totals.premiumMillicents) >= cap;
  } catch {
    return false; // fail open
  }
}

/**
 * Resolve a tenant's effective daily paid-overflow cap (millicents) from its
 * per-tenant override + effective plan:
 *   • override === -1            → -1 (unlimited; the caller skips the gate)
 *   • override >= 0              → that explicit value
 *   • override null, free plan   → {@link DEFAULT_PAID_OVERFLOW_CAP_MILLICENTS}
 *   • override null, pro/teams   → -1 (unlimited)
 * Single source of truth so the gate and any superadmin display agree.
 */
export function resolvePaidOverflowCapMillicents(
  override: number | null | undefined,
  effectivePlan: 'free' | 'pro' | 'teams',
): number {
  if (override === -1) return -1;
  if (override != null && override >= 0) return override;
  return effectivePlan === 'free' ? DEFAULT_PAID_OVERFLOW_CAP_MILLICENTS : -1;
}

/** Coerce one token count to a non-negative finite integer. Upstream usage SHOULD
 *  be clean, but a vendor/stream edge (a failed turn, a malformed chunk, a synthetic
 *  retry) can surface NaN, Infinity, a negative, or a fractional value — and those
 *  must NEVER reach the billing ledger, where they poison the SUM()-based cost
 *  rollups (a single NaN makes a whole tenant/project total NaN). Floors anything
 *  non-finite or negative to 0; truncates fractions. Identity for a clean integer. */
export function clampTokenCount(n: number | undefined | null): number {
  return Number.isFinite(n) ? Math.max(0, Math.floor(n as number)) : 0;
}

/** Sanitize every token field on a usage record via {@link clampTokenCount}, so the
 *  single ledger writer ({@link recordUsageRow}) and any direct snapshot writer share
 *  ONE clamp. Preserves "cache field absent" (undefined) so an upstream with no cache
 *  breakdown is not misrecorded as an explicit 0. */
export function sanitizeUsage(usage: LlmUsage): LlmUsage {
  return {
    promptTokens:     clampTokenCount(usage.promptTokens),
    completionTokens: clampTokenCount(usage.completionTokens),
    totalTokens:      clampTokenCount(usage.totalTokens),
    ...(usage.cacheReadTokens     != null ? { cacheReadTokens:     clampTokenCount(usage.cacheReadTokens) }     : {}),
    ...(usage.cacheCreationTokens != null ? { cacheCreationTokens: clampTokenCount(usage.cacheCreationTokens) } : {}),
    ...(usage.reasoningTokens     != null ? { reasoningTokens:     clampTokenCount(usage.reasoningTokens) }     : {}),
  };
}

/** A nullable per-turn measurement (turn index, tool-schema tokens): clamped like a
 *  token count when present, NULL — "not measured" — when absent. */
function clampOptionalCount(n: number | null | undefined): number | null {
  return n == null ? null : clampTokenCount(n);
}

/** Final ledger cost rule: tenant-funded calls carry no token cost, while the
 * OpenRouter routing surcharge is independent and therefore applies to both
 * managed-key and BYO-key registrations. */
export function computeRecordedCostMillicents(
  pricing: { prompt: number; completion: number } | undefined,
  usage: LlmUsage,
  byo: boolean,
  platformSurcharge: boolean,
): number {
  return (byo ? 0 : computeCostMillicents(pricing, usage))
    + (platformSurcharge ? PREMIUM_REQUEST_SURCHARGE_MILLICENTS : 0);
}

/**
 * Which agent modality produced a usage row — declared once in
 * `@builderforce/spend-contract` (the BYO exemption that reads it: tokenUsage.ts).
 * Re-exported here so the ledger's callers keep one import.
 */
export { USAGE_SURFACES, isUsageSurface, type UsageSurface } from '@builderforce/spend-contract';

/** Map internal gateway vendor ids to the stable provider ids shown in the BYO
 * integrations UI. */
export function normalizeByoProvider(vendor: string): string {
  // DERIVED, not hand-listed. The old map was a second copy of `byoVendorIdFor`'s
  // inverse and had already drifted from it: `xai-oauth` was missing entirely, so a
  // SuperGrok-funded row was stamped `xai-oauth`, matched no `provider-keys` row, and
  // silently dropped out of the tenant's own integration breakdown. Deriving it from
  // the one catalog means a new provider — or a new OAuth vendor alias — is picked up
  // without a second edit nobody remembers to make.
  //
  // This is provider-level BY DESIGN and it is not the lossy part it used to be:
  // "subscription-funded vs key-funded" is now recoverable from
  // `llm_usage_log.byo_credential_id` → the credential row's `auth_type` (0953),
  // which also survives the case this string cannot express — the same account
  // rotating its key. Overloading one denormalized column to carry both would lose
  // the account identity the moment a key is rotated.
  return providerForVendor(vendor) ?? vendor;
}

/**
 * Who produced a usage row. Exactly one of the agent dimensions is set in
 * practice:
 *   • agentHostId      → a self-hosted (on-prem) agent host's gateway call.
 *   • cloudAgentRef    → a cloud agent run (ide_agents.id, or null for the
 *                        gateway-default bucket) — paired with executionId.
 *   • (all null)       → a web/SDK/browser call, i.e. not agent-attributed.
 */
/** The chat mode a conversation can be in. Mirrors `brain_chats.mode` (0409);
 *  anything else is recorded as no mode rather than guessed at. */
const CHAT_MODES = new Set(['chat', 'work']);

/**
 * Chat attribution lifted out of the caller-supplied metadata blob.
 *
 * Producers put `{ chatId, mode }` in metadata (brain-embedded's `brainRunStore`
 * writes it); the ledger promotes it to real columns so a per-chat or per-mode
 * spend report is an indexed read. Deliberately forgiving: a metadata blob with
 * no chat, a non-numeric chatId, or an unrecognised mode yields nulls, which is
 * exactly what the old JSON scan produced — the difference is that a row WITH a
 * chat can no longer be missed because its metadata was shaped unexpectedly.
 */
function readChatAttribution(metadata: Record<string, unknown> | null | undefined): {
  chatId: number | null;
  chatMode: 'chat' | 'work' | null;
} {
  if (!metadata || typeof metadata !== 'object') return { chatId: null, chatMode: null };
  const rawId = (metadata as { chatId?: unknown }).chatId;
  const parsedId =
    typeof rawId === 'number' ? rawId
    : typeof rawId === 'string' && /^[0-9]+$/.test(rawId) ? Number(rawId)
    : null;
  const rawMode = (metadata as { mode?: unknown }).mode;
  const mode = typeof rawMode === 'string' && CHAT_MODES.has(rawMode) ? (rawMode as 'chat' | 'work') : null;
  return {
    chatId: parsedId !== null && Number.isSafeInteger(parsedId) && parsedId > 0 ? parsedId : null,
    chatMode: mode,
  };
}

/**
 * What memory did to one usage row (1227). Either reported by the run loop in the
 * `metadata.memory` it already sends with a call (`trimmedTokens`, `recallTokens` —
 * read by {@link readMemoryEffect}), or set by a producer that records an AVOIDED call
 * (`savingsLedger.recordAvoidedCall`). Absent ⇒ memory did nothing on this row.
 */
export interface UsageSavings {
  /** Set only on an avoided call (`calls` = 0): what stood in for the model.
   *  `deterministic` (D7) is a COUNTER row only — zero saved tokens, so no saving is
   *  claimed for it; it exists so "served without a model" can be counted.
   *  `local_model` (PRD 36) is a REAL call (`calls` = 1) served by a model on the
   *  person's machine: the saving is what the same tokens would have cost on the
   *  chat's paid route, priced by the client and passed as `savedCostMillicents`. */
  source?: 'memory_answer' | 'evermind_answer' | 'response_cache' | 'deterministic' | 'local_model' | null;
  savedPromptTokens: number;
  savedCompletionTokens?: number;
  recallPromptTokens?: number;
  estimated: boolean;
}

/**
 * The run loop's per-call memory figures, lifted out of the caller-supplied metadata —
 * the same forgiving promotion `readChatAttribution` does for the chat: anything absent,
 * non-numeric or negative reads as nothing.
 */
export function readMemoryEffect(metadata: Record<string, unknown> | null | undefined): UsageSavings | null {
  const m = metadata && typeof metadata === 'object' ? (metadata as { memory?: unknown }).memory : null;
  if (!m || typeof m !== 'object') return null;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  const trimmed = num((m as { trimmedTokens?: unknown }).trimmedTokens);
  const recall = num((m as { recallTokens?: unknown }).recallTokens);
  if (trimmed === 0 && recall === 0) return null;
  // Both are character estimates — the loop never sees the provider's tokenizer.
  return { savedPromptTokens: trimmed, recallPromptTokens: recall, estimated: true };
}

/** NET list-price value of a row's savings, in millicents: what the saved tokens would
 *  have cost minus what recall added. Zero when the model has no catalog price. */
export function computeSavedCostMillicents(
  pricing: { prompt: number; completion: number } | undefined,
  savings: UsageSavings | null,
): number {
  if (!pricing || !savings) return 0;
  const saved = computeCostMillicents(pricing, {
    promptTokens: savings.savedPromptTokens,
    completionTokens: savings.savedCompletionTokens ?? 0,
    totalTokens: savings.savedPromptTokens + (savings.savedCompletionTokens ?? 0),
  });
  const overhead = computeCostMillicents(pricing, {
    promptTokens: savings.recallPromptTokens ?? 0,
    completionTokens: 0,
    totalTokens: savings.recallPromptTokens ?? 0,
  });
  return saved - overhead;
}

export interface UsageAttribution {
  agentHostId?: number | null;
  cloudAgentRef?: string | null;
  executionId?: number | null;
  /** Ticket (task) the spend is attributed to (0104) — the finest grain; rolls
   *  up ticket → project → account. */
  taskId?: number | null;
  /** Project the spend is attributed to (0103) — rolls up project → account. */
  projectId?: number | null;
  /** Call-purpose role this call resolved as, when the producer knew it (1167) —
   *  e.g. a cloud run's `spawn_agent` delegation. Most callers omit it; absent is
   *  recorded as null, not guessed. */
  role?: string | null;
}

export interface RecordUsageRow {
  tenantId: number;
  userId: string | null;
  llmProduct: string;
  model: string;
  retries?: number;
  streamed?: boolean;
  usage: LlmUsage;
  metadata?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
  useCase?: string | null;
  tenantApiKeyId?: string | null;
  attribution?: UsageAttribution | null;
  /** Links this usage row to its `llm_traces.trace_id` for billing→trace pivot [1299]. */
  traceId?: string | null;
  /** True when the call resolved via the funded paid-overflow path (premium
   *  fallback / backstop on Builderforce's key, not a plan-pool model). Metered
   *  against the per-tenant `paid_overflow_daily_cap`. See isPaidOverflowModel. */
  paidOverflow?: boolean | null;
  /** Did this row run on a PREMIUM (any-paid-OpenRouter) model the tenant pinned?
   *  Persisted as a real column (0952) because the daily premium cap SUMs it on every
   *  premium request — the `metadata.premiumSurchargeMillicents` key it replaces
   *  would have made that a scan. Distinct from `paidOverflow`, which flags spend
   *  WE fund; this flags spend the tenant ran up on the metered long tail. */
  premium?: boolean | null;
  /** True when the tenant's OWN provider credential (BYO key / connected
   *  subscription) served the call. Forces `cost_usd_millicents = 0` (the
   *  platform paid nothing) and, combined with an on-prem/VSIX `surface`, exempts
   *  the row from the plan token allowance. See tokenUsage.ts. */
  byo?: boolean | null;
  /** Stable connected-provider id when `byo` is true. This is deliberately
   *  separate from `model`: one credential can serve many models. */
  byoProvider?: string | null;
  /** Which modality produced the row — drives the BYO metering exemption.
   *  Defaults to 'web' when unset. */
  surface?: UsageSurface | null;
  /** True when the tenant selected a PREMIUM (any-paid-OpenRouter) model — adds the
   *  flat {@link PREMIUM_REQUEST_SURCHARGE_MILLICENTS} on top of the metered token
   *  cost so billing is "OpenRouter cost + 1¢". Ignored for BYO rows (cost forced 0).
   *  Recorded in metadata so an invoice line can show the surcharge explicitly. */
  premiumSurcharge?: boolean | null;
  /** How many LLM calls this row stands for. 1 for an ordinary call; 0 for an AVOIDED
   *  call (`savings.source` set) — so request counts never include a call that did not
   *  happen. The rollup is the only other writer of a value above 1. */
  calls?: number;
  /** What memory did on this row. Defaults to the run loop's `metadata.memory`. */
  savings?: UsageSavings | null;
  /** 1-based position of this call within its run's loop (migration 1253 / 0019) —
   *  null for a call outside a turn loop. */
  turnIndex?: number | null;
  /** ESTIMATED tokens the advertised tool schemas cost on this call (chars/4 over the
   *  serialized `tools`) — null when the producer did not measure it. */
  toolSchemaTokens?: number | null;
  /** How the provider billed the call. `batch` = a provider batch API (D6), priced at
   *  {@link BATCH_PRICE_MULTIPLIER} and stamped `metadata.pricingTier`. Absent = standard. */
  pricingTier?: UsagePricingTier | null;
  /** The saving's NET value as its producer stamped it, written verbatim instead of
   *  pricing `savings` against the catalog — for a row the catalog cannot price (a
   *  local model's counterfactual, priced by the client at list; PRD 36). */
  savedCostMillicents?: number | null;
  /** When the call happened, for a row reported after the fact (a synced client
   *  call, already clamped to now by the importer). Absent = now. */
  createdAt?: Date | null;
}

/** Minimal shape of a ProxyResult this helper needs — avoids importing the full type.
 *  Must carry the BYO provenance fields: narrowing them away silently prices a
 *  tenant's own-key call against the catalog and bills them for it. */
interface ProxyUsageResult {
  usage?: LlmUsage;
  resolvedModel?: string;
  /** Authoritative gateway trace id stamped by `complete()`. */
  traceId?: string;
  byoFunded?: boolean;
  resolvedVendor?: string;
  /** The served model came from a registered OpenRouter connection, so the
   * platform routing surcharge applies even when the tenant supplied the key. */
  platformSurcharge?: boolean;
}

/**
 * Resolve the database that owns the usage ledger. Production isolates
 * `llm_usage_log` in the transactional database; local/test environments keep it
 * in the application database. Readers and writers must use this same boundary or
 * a scored cloud run is incorrectly attributed to the `unknown` model.
 */
export function resolveUsageDatabase(
  env: Env,
  db: Db,
  buildTransactional: (env: Env) => Db = buildTransactionalDatabase,
): Db {
  return hasSiblingDatabase(env, 'operational') ? buildTransactional(env) : db;
}

/**
 * The usage-ledger database for a reader that holds only the core handle.
 *
 * Lenses several calls deep (finance, metric registry, forecasts, reports) receive a
 * `Db` and no `env`; the handle remembers the env it was built from, so they resolve
 * the same boundary as `resolveUsageDatabase` without threading `env` through every
 * caller. A handle that was not built by `buildDatabase` (a test double, or a handle
 * that is already the usage database) resolves to itself, which is also what a
 * single-database environment gets.
 */
export function usageDatabaseOf(db: Db): Db {
  return siblingDatabaseOf(db, 'operational');
}

/**
 * HOW MANY LLM CALLS a set of `llm_usage_log` rows represents.
 *
 * THE ONE expression for that question, and it must be used everywhere the answer is
 * shown — a usage panel's "requests", a per-model breakdown, an interaction count, a
 * per-key summary. `COUNT(*)` was the obvious spelling and is now WRONG: past
 * `LLM_USAGE_ROLLUP_AFTER_DAYS` the grain rollup folds a day of calls into one row per
 * dimension set, so a row can stand for hundreds of calls and `calls` is where that
 * number went. Every summed quantity beside it (tokens, cache tiers, cost, retries) is
 * summed by the fold and therefore needs no equivalent; the row count is the only
 * casualty, so it is the only thing that needs a shared primitive.
 *
 * `COALESCE` rather than trusting the NOT NULL default, so the expression is still
 * correct against a database where migration 1180/0012 has not landed yet — a reader
 * deployed ahead of its migration reports real counts instead of zeroes.
 *
 * Pass the alias when the query names the table something else (`u`, `l`, a CTE).
 * `npm run check:usage-counts` fails any query that counts these rows another way.
 */
export function usageRequestCount(alias?: string): SQL<number> {
  const column = alias ? sql.raw(`${alias}.calls`) : sql`${llmUsageLog.calls}`;
  return sql<number>`COALESCE(SUM(${column}), 0)::int`;
}

/** The same count as a raw SQL FRAGMENT, for the hand-written statements that never
 *  reference the Drizzle table. Identical semantics — one definition, two spellings of
 *  the call site, so a raw query cannot drift from the typed one. */
export function usageRequestCountSql(alias?: string): string {
  return `COALESCE(SUM(${alias ? `${alias}.calls` : 'calls'}), 0)::int`;
}

/**
 * Record usage for an internal `ideProxy(...).complete()` caller (brain, QA gen,
 * repo analysis, security review, IDE chat, …) that would otherwise bypass the
 * ledger entirely. No-ops when the call produced no usage (error / stream).
 * These are system/tenant calls, not agent-host or cloud-agent runs, so they
 * carry no agent attribution unless the caller passes one. Best-effort.
 */
export async function recordProxyUsage(
  db: Db,
  env: Env,
  opts: {
    tenantId: number;
    userId?: string | null;
    useCase: string;
    result: ProxyUsageResult;
    llmProduct?: string;
    attribution?: UsageAttribution | null;
    surface?: UsageSurface | null;
    /** The diagnostic trace this call wrote, so an internal-caller usage row can
     *  pivot to its `llm_traces` row exactly like the gateway chat path does
     *  [1299]. Falls back to the id `complete()` stamped on the result. */
    traceId?: string | null;
  },
): Promise<void> {
  if (!opts.result.usage) return;
  const byo = opts.result.byoFunded ?? false;
  await recordUsageRow(db, env, {
    tenantId:   opts.tenantId,
    userId:     opts.userId ?? null,
    traceId:    opts.traceId ?? opts.result.traceId ?? null,
    llmProduct: opts.llmProduct ?? 'builderforceLLM',
    model:      opts.result.resolvedModel ?? 'unknown',
    usage:      opts.result.usage,
    useCase:    opts.useCase,
    attribution: opts.attribution ?? null,
    byo,
    byoProvider: byo && opts.result.resolvedVendor
      ? normalizeByoProvider(opts.result.resolvedVendor)
      : null,
    surface:    opts.surface ?? null,
    premiumSurcharge: opts.result.platformSurcharge ?? false,
  });
}

/** Insert one usage row, stamping an authoritative cost priced from the catalog.
 *  Best-effort — never throws (logging must not fail a run). */
/**
 * The surrogate id of the credential INSTANCE currently serving `provider` for this
 * tenant (0953), or `null` when nothing is connected.
 *
 * Read at the usage-write boundary rather than threaded through the proxy: every
 * producer already arrives here with (tenant, provider), and none of them carries a
 * credential id. Read from the cached tenant provider rows — the value changes only on a rotation, and the
 * worst case of a stale read is one row attributed to the key that was live seconds
 * earlier, which is a rounding error against the alternative of a query on every
 * logged call.
 *
 * Degrades to `null` on any failure: a usage row missing its credential id is a
 * slightly less specific record; a usage row that failed to write is lost revenue.
 */
async function resolveByoCredentialId(
  env: Env,
  tenantId: number,
  provider: string,
): Promise<string | null> {
  try {
    // The tenant's cached provider rows (one read shared with credential resolution) —
    // invalidated on every key write, so a rotation's new id is seen immediately.
    return (await loadTenantProviderRows(env, tenantId)).find((r) => r.provider === provider)?.id ?? null;
  } catch {
    return null;
  }
}

export async function recordUsageRow(db: Db, env: Env, row: RecordUsageRow): Promise<void> {
  try {
    const usageDb = resolveUsageDatabase(env, db);
    // Clamp tokens ONCE at the canonical write boundary so neither the cost price
    // nor the persisted columns can carry a NaN/negative/fractional from a bad
    // upstream turn — every usage producer (gateway + cloud) funnels through here.
    const usage = sanitizeUsage(row.usage);

    // Price the call at write time so the dashboard/billing sums a recorded
    // column instead of re-pricing tokens against a moving catalog. Catalog read
    // is L1+KV cached, so this is a cheap lookup on the hot logging path.
    // BYO rows are served by the tenant's OWN provider account, so token cost is
    // zero. A registered OpenRouter connection still uses our routing/metering
    // product, however, and its flat platform surcharge is independent of who
    // paid OpenRouter for the tokens.
    // What memory did on this row — an avoided call's figures, or the loop's per-call
    // compaction / recall numbers carried in the metadata it already sends.
    const savings = row.savings ?? readMemoryEffect(row.metadata);
    let pricing: { prompt: number; completion: number } | undefined;
    // A BYO row is still priced when it carries savings: they are valued at LIST, since
    // the person's own key would have paid for the tokens memory kept off the call.
    if (!row.byo || savings) {
      try {
        // The SAME price book the router orders cost-first calls by (`catalogView.ts`),
        // so what a call was expected to cost and what it is recorded as costing come
        // from one lookup — including its `openrouter/` prefix normalization.
        // A BYO row is valued at LIST (`listPriceOf`, which also resolves a direct-vendor
        // id); a platform row bills on `priceOf` alone, unchanged.
        const book = await loadPriceBook(env);
        const price = row.byo ? listPriceOf(book, row.model) : book.priceOf(row.model);
        pricing = price ? { prompt: price.input, completion: price.output } : undefined;
      } catch (error) { /* pricing unavailable — record tokens with cost 0 */ 
        reportCaughtError(error, { source: "application/llm/usageLedger.ts", operation: "recordUsageRow" });
      }
    }
    // A batch-API call is billed at the batch rate; savings below stay valued at list.
    const costUsdMillicents = computeRecordedCostMillicents(
      pricingForTier(pricing, row.pricingTier),
      usage,
      row.byo === true,
      row.premiumSurcharge === true,
    );
    const savedCostUsdMillicents = row.savedCostMillicents != null && Number.isFinite(row.savedCostMillicents)
      ? Math.round(row.savedCostMillicents)
      : computeSavedCostMillicents(pricing, savings);
    // Stamp the surcharge into metadata so an invoice/usage row can show it explicitly.
    // Only the non-denied, size-bounded keys are PERSISTED (see usageMetadata) — the raw caller bag held
    // guest prompt text and was the bulk of this table's size. `savings` above already read
    // the full bag.
    const keptMetadata = pickPersistedMetadata(row.metadata);
    // The cost-lever arms this tenant was in when the row was written — A4's control
    // group. Stamped here, the single writer, so every surface carries it; added AFTER
    // the persistence filter so a caller cannot spoof its own arm, and bounded by
    // construction (partial-rollout lever ids only — see costLeverArmsStamp).
    const leverArms = costLeverArmsStamp(env, row.tenantId);
    const armed: Record<string, unknown> | null = leverArms
      ? { ...(keptMetadata ?? {}), [COST_LEVER_ARMS_KEY]: leverArms }
      : keptMetadata;
    // The pricing tier is the writer's fact, stamped after the filter like the arms, so
    // an invoice line can say why the row costs half.
    const stamped: Record<string, unknown> | null = row.pricingTier === 'batch'
      ? { ...(armed ?? {}), pricingTier: 'batch' }
      : armed;
    const metadata = row.premiumSurcharge
      ? { ...(stamped ?? {}), premiumSurchargeMillicents: PREMIUM_REQUEST_SURCHARGE_MILLICENTS }
      : stamped;
    // Chat attribution is promoted OUT of metadata into real columns (0934) so
    // per-chat/per-mode spend is an indexed read rather than a JSON scan that
    // silently drops every row whose metadata is absent or not an object. It stays
    // in metadata as well — the SDK's billing trace-back contract reads it there.
    const chatAttribution = readChatAttribution(metadata);
    // WHICH key instance paid (0953). Resolved here — the single write boundary —
    // rather than threaded through the proxy, because every producer already reaches
    // this function with the two facts it needs (tenant + the provider we stamped)
    // and none of them would otherwise carry a credential id. Served from the cached
    // tenant provider rows (shared with credential resolution, invalidated on every key
    // write), so a warm BYO row costs no statement; a platform-funded row costs nothing.
    const byoCredentialId = row.byo && row.byoProvider && row.tenantId != null
      ? await resolveByoCredentialId(env, row.tenantId, row.byoProvider)
      : null;

    await usageDb.insert(llmUsageLog).values({
      tenantId:            row.tenantId,
      userId:              row.userId,
      llmProduct:          row.llmProduct,
      model:               row.model,
      promptTokens:        usage.promptTokens,
      completionTokens:    usage.completionTokens,
      totalTokens:         usage.totalTokens,
      cacheReadTokens:     usage.cacheReadTokens     ?? 0,
      cacheCreationTokens: usage.cacheCreationTokens ?? 0,
      // NULL, not 0, when the vendor reports no reasoning split (Anthropic) — so the
      // reasoning share is computed only over rows that could have reported one.
      reasoningTokens:     usage.reasoningTokens ?? null,
      turnIndex:           clampOptionalCount(row.turnIndex),
      toolSchemaTokens:    clampOptionalCount(row.toolSchemaTokens),
      retries:             row.retries ?? 0,
      streamed:            row.streamed ?? false,
      metadata:            metadata ?? null,
      chatId:              chatAttribution.chatId,
      chatMode:            chatAttribution.chatMode,
      idempotencyKey:      row.idempotencyKey ?? null,
      useCase:             row.useCase ?? null,
      tenantApiKeyId:      row.tenantApiKeyId ?? null,
      agentHostId:         row.attribution?.agentHostId ?? null,
      cloudAgentRef:       row.attribution?.cloudAgentRef ?? null,
      executionId:         row.attribution?.executionId ?? null,
      taskId:              row.attribution?.taskId ?? null,
      projectId:           row.attribution?.projectId ?? null,
      role:                row.attribution?.role ?? null,
      costUsdMillicents,
      traceId:             row.traceId ?? null,
      paidOverflow:        row.paidOverflow ?? false,
      // Premium-ness rides its own column so the daily cap can SUM it (0952). It is
      // derived from the same `premiumSurcharge` signal that stamps the metadata key,
      // so the two can never disagree about what a premium turn was.
      premium:             row.premium ?? row.premiumSurcharge ?? false,
      byo:                 row.byo ?? false,
      byoProvider:         row.byo ? (row.byoProvider ?? null) : null,
      byoCredentialId,
      surface:             row.surface ?? 'web',
      calls:               row.calls ?? 1,
      savingsSource:          savings?.source ?? null,
      savingsEstimated:       savings?.estimated ?? false,
      savedPromptTokens:      clampTokenCount(savings?.savedPromptTokens ?? 0),
      savedCompletionTokens:  clampTokenCount(savings?.savedCompletionTokens ?? 0),
      recallPromptTokens:     clampTokenCount(savings?.recallPromptTokens ?? 0),
      savedCostUsdMillicents,
      ...(row.createdAt ? { createdAt: row.createdAt } : {}),
    });

    // Keep the cached cap totals exact between loads (see tokenUsage).
    await addUsageToTenantTotals(env, row.tenantId, {
      llmProduct: row.llmProduct,
      totalTokens: usage.totalTokens,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      cacheCreationTokens: usage.cacheCreationTokens ?? 0,
      byo: row.byo ?? false,
      surface: row.surface ?? 'web',
      paidOverflow: row.paidOverflow ?? false,
      premium: row.premium ?? row.premiumSurcharge ?? false,
      costUsdMillicents,
    });

    // A successful own-account completion is stronger health evidence than yesterday's
    // capacity alert. This is what makes rolling/session limits recover automatically:
    // cooldown opens a half-open retry, the provider serves it, and the stale warning is
    // retired immediately instead of lingering until the daily probe or a manual Test.
    if (row.byo && row.byoProvider) {
      await clearProviderAuthAlertAfterByoSuccess(env, row.tenantId, row.byoProvider);
    }
  } catch (error) { /* never let usage logging fail the request */ 
    reportCaughtError(error, { source: "application/llm/usageLedger.ts", operation: "recordUsageRow" });
  }
}
