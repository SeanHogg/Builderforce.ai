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
import { llmUsageLog, tenantLlmProviderKeys } from '../../infrastructure/database/schema';
import type { LlmUsage } from './LlmProxyService';
import { getCatalogCached } from './modelCatalog';
import { buildDatabase, buildTransactionalDatabase } from '../../infrastructure/database/connection';
import { clearProviderAuthAlertAfterByoSuccess } from './providerAuthAlerts';
import { providerForVendor } from './llmProviderCatalog';
import { and, eq, gte, sql } from 'drizzle-orm';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { utcDayStart } from './tokenUsage';

/** Cache-tier multipliers relative to the base input (prompt) price. cache_read
 *  is billed ~0.1x input, cache_creation ~1.25x — both are subsets of
 *  promptTokens (see schema). Mirrors the discount the usage columns record. */
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_CREATION_MULTIPLIER = 1.25;

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
    // The SAME database the rows are written to — `resolveUsageDatabase` sends them to
    // the operational account when its secret is bound, and a cap that summed the
    // primary copy there would read zero forever.
    const db = resolveUsageDatabase(env, buildDatabase(env));
    const [row] = await db
      .select({ spent: sql<number>`COALESCE(SUM(${llmUsageLog.costUsdMillicents}), 0)` })
      .from(llmUsageLog)
      .where(and(
        eq(llmUsageLog.tenantId, tenantId),
        eq(llmUsageLog.premium, true),
        gte(llmUsageLog.createdAt, utcDayStart()),
      ));
    return Math.max(0, Number(row?.spent ?? 0)) >= cap;
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
  };
}

/** Authoritative per-call cost in millicents (1/100000 USD), priced from the
 *  resolved model's catalog price incl. the cache-read/creation discount split.
 *  Returns 0 when the model isn't in the catalog (e.g. a BYO-key passthrough). */
export function computeCostMillicents(
  pricing: { prompt: number; completion: number } | undefined,
  usage: LlmUsage,
): number {
  if (!pricing) return 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheCreation = usage.cacheCreationTokens ?? 0;
  const fullPrompt = Math.max(0, usage.promptTokens - cacheRead - cacheCreation);
  const usd =
    fullPrompt * pricing.prompt +
    cacheRead * pricing.prompt * CACHE_READ_MULTIPLIER +
    cacheCreation * pricing.prompt * CACHE_CREATION_MULTIPLIER +
    usage.completionTokens * pricing.completion;
  return Math.round(usd * 100_000);
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
 * Which agent modality produced a usage row. Set on every row so metering can
 * apply the BYO exemption (own-machine on-prem/VSIX BYO usage is free; cloud BYO
 * is charged) — see tokenUsage.ts.
 *   • web      → the web app (Brain chat, dashboards) or an unattributed call.
 *   • vsix     → the VS Code extension (own machine).
 *   • on_prem  → a self-hosted agent host (own machine).
 *   • cloud    → a cloud agent run (Durable Object / container) on our infra.
 *   • sdk      → a direct SDK/API caller.
 */
export type UsageSurface = 'web' | 'vsix' | 'on_prem' | 'cloud' | 'sdk';

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

export interface UsageAttribution {
  agentHostId?: number | null;
  cloudAgentRef?: string | null;
  executionId?: number | null;
  /** Ticket (task) the spend is attributed to (0104) — the finest grain; rolls
   *  up ticket → project → account. */
  taskId?: number | null;
  /** Project the spend is attributed to (0103) — rolls up project → account. */
  projectId?: number | null;
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
  return env.NEON_TRANSACTIONAL_DATABASE_URL?.trim() ? buildTransactional(env) : db;
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
 * credential id. Cached for a minute — the value changes only on a rotation, and the
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
    return await getOrSetCached(
      env,
      `byo-cred-id:${tenantId}:${provider}`,
      async () => {
        const [row] = await buildDatabase(env)
          .select({ id: tenantLlmProviderKeys.id })
          .from(tenantLlmProviderKeys)
          .where(and(
            eq(tenantLlmProviderKeys.tenantId, tenantId),
            eq(tenantLlmProviderKeys.provider, provider),
          ))
          .limit(1);
        return row?.id ?? null;
      },
      { kvTtlSeconds: 60 },
    );
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
    let pricing: { prompt: number; completion: number } | undefined;
    if (!row.byo) {
      try {
        const catalog = await getCatalogCached(env);
        // Registered OpenRouter connections use an explicit `openrouter/` routing
        // prefix while the public catalog stores OpenRouter's bare `<org>/<model>`
        // id. Normalize only for the pricing lookup; keep the explicit ref in the
        // ledger so provenance remains unambiguous.
        const catalogModel = row.model.startsWith('openrouter/')
          ? row.model.slice('openrouter/'.length)
          : row.model;
        pricing = catalog.find((m) => m.id === catalogModel)?.pricing;
      } catch (error) { /* pricing unavailable — record tokens with cost 0 */ 
        reportCaughtError(error, { source: "application/llm/usageLedger.ts", operation: "recordUsageRow" });
      }
    }
    const costUsdMillicents = computeRecordedCostMillicents(
      pricing,
      usage,
      row.byo === true,
      row.premiumSurcharge === true,
    );
    // Stamp the surcharge into metadata so an invoice/usage row can show it explicitly.
    const metadata = row.premiumSurcharge
      ? { ...(row.metadata ?? {}), premiumSurchargeMillicents: PREMIUM_REQUEST_SURCHARGE_MILLICENTS }
      : row.metadata;
    // Chat attribution is promoted OUT of metadata into real columns (0934) so
    // per-chat/per-mode spend is an indexed read rather than a JSON scan that
    // silently drops every row whose metadata is absent or not an object. It stays
    // in metadata as well — the SDK's billing trace-back contract reads it there.
    const chatAttribution = readChatAttribution(metadata);
    // WHICH key instance paid (0953). Resolved here — the single write boundary —
    // rather than threaded through the proxy, because every producer already reaches
    // this function with the two facts it needs (tenant + the provider we stamped)
    // and none of them would otherwise carry a credential id. Cached, so a BYO row
    // costs at most one lookup per tenant+provider per minute; a platform-funded row
    // costs nothing at all.
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
