'use client';

/**
 * Platform Admin › Usage tab.
 *
 * Self-contained panel extracted from the monolithic admin page. Loads LLM
 * usage stats (windowed by `usageDays`) plus the latest per-vendor health rows,
 * renders the totals cards, daily-request chart, by-vendor summary (with manual
 * health probes), by-model table and failover table, and offers an "AI Analyze"
 * button that ships the window's usage data to the gateway and returns a Claude
 * Code prompt to tune the LLM endpoint.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  adminApi,
  type LlmUsageStats,
  type LlmModelStatus,
  type VendorId,
  type VendorHealthRow,
  type VendorHealthSnapshot,
} from '@/lib/adminApi';
import { Select } from '@/components/Select';
import { llmChat } from '@/lib/builderforceApi';
import { errText, fmtDateTime, fmtNum, AdminError, AdminLoading } from '../adminShared';

export default function UsagePanel() {
  const t = useTranslations('admin');
  const [usageDays, setUsageDays] = useState(30);
  const [llmUsage, setLlmUsage] = useState<LlmUsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Vendor health probes — keyed by vendor id. `latest` is fetched on tab load,
  // `running` toggles per vendor while a manual probe is in flight, and `result`
  // is the snapshot returned from the last manual probe (overrides `latest`).
  const [vendorHealthLatest, setVendorHealthLatest] = useState<Record<string, VendorHealthRow>>({});
  const [vendorHealthResult, setVendorHealthResult] = useState<Record<string, VendorHealthSnapshot>>({});
  const [vendorHealthRunning, setVendorHealthRunning] = useState<Record<string, boolean>>({});
  const [vendorHealthError, setVendorHealthError] = useState<Record<string, string>>({});
  const [usageAiPrompt, setUsageAiPrompt] = useState('');
  const [usageAiLoading, setUsageAiLoading] = useState(false);
  const [usageAiError, setUsageAiError] = useState('');
  const [usageAiCopied, setUsageAiCopied] = useState(false);

  const setErrorMsg = setError;

  // Per-vendor aggregates for the Usage tab — one source of truth used by
  // both the vendor-summary cards and the vendor-grouped model table below.
  const byVendor = useMemo(() => {
    if (!llmUsage) return [] as Array<{
      vendor: VendorId; modelCount: number; requests: number;
      retries: number; streamed: number; totalTokens: number; failoverCount: number;
    }>;
    const map = new Map<VendorId, {
      vendor: VendorId; modelCount: number; requests: number;
      retries: number; streamed: number; totalTokens: number; failoverCount: number;
    }>();
    const ensure = (v: VendorId) => {
      let row = map.get(v);
      if (!row) {
        row = { vendor: v, modelCount: 0, requests: 0, retries: 0, streamed: 0, totalTokens: 0, failoverCount: 0 };
        map.set(v, row);
      }
      return row;
    };
    for (const m of llmUsage.byModel) {
      const row = ensure(m.vendor);
      row.modelCount += 1;
      row.requests += m.requests;
      row.retries += m.retries;
      row.streamed += m.streamed_requests;
      row.totalTokens += m.total_tokens;
    }
    for (const f of llmUsage.failovers) {
      ensure(f.vendor).failoverCount += f.count;
    }
    return [...map.values()].sort((a, b) => b.requests - a.requests);
  }, [llmUsage]);

  // byModel sorted by vendor (alphabetical) then by requests desc, so vendor
  // groups appear together visually without a separate <tbody> per vendor.
  const byModelSorted = useMemo(() => {
    if (!llmUsage) return [];
    return [...llmUsage.byModel].sort((a, b) => {
      if (a.vendor !== b.vendor) return a.vendor.localeCompare(b.vendor);
      return b.requests - a.requests;
    });
  }, [llmUsage]);

  // failovers sorted by vendor then by count desc — same grouping pattern.
  const failoversSorted = useMemo(() => {
    if (!llmUsage) return [];
    return [...llmUsage.failovers].sort((a, b) => {
      if (a.vendor !== b.vendor) return a.vendor.localeCompare(b.vendor);
      return b.count - a.count;
    });
  }, [llmUsage]);

  // Load LLM usage for the current window plus the latest per-vendor health
  // rows. Runs on mount and whenever `usageDays` changes.
  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [usage, healthRows] = await Promise.all([
        adminApi.llmUsage(usageDays),
        adminApi.llmHealthLatest().catch(() => [] as VendorHealthRow[]),
      ]);
      setLlmUsage(usage);
      setVendorHealthLatest(Object.fromEntries(healthRows.map((r) => [r.vendor, r])));
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  }, [usageDays]);

  useEffect(() => {
    reload();
  }, [reload]);

  const runVendorHealthCheck = useCallback(async (vendor: VendorId) => {
    setVendorHealthRunning((prev) => ({ ...prev, [vendor]: true }));
    setVendorHealthError((prev) => ({ ...prev, [vendor]: '' }));
    try {
      const snapshot = await adminApi.probeVendorHealth(vendor);
      setVendorHealthResult((prev) => ({ ...prev, [vendor]: snapshot }));
    } catch (err) {
      setVendorHealthError((prev) => ({
        ...prev,
        [vendor]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setVendorHealthRunning((prev) => ({ ...prev, [vendor]: false }));
    }
  }, []);

  const runUsageAiAnalysis = async () => {
    if (!llmUsage) return;
    setUsageAiLoading(true);
    setUsageAiError('');
    setUsageAiCopied(false);
    try {
      // Pull the real catalog so the AI can't invent model ids and we can
      // verify "already at position 0" claims. Each entry now carries `vendor`
      // (typed: 'openrouter' | 'cerebras' | 'nvidia' | 'ollama'), which lets us
      // resolve the editable file path server-side rather than asking the AI
      // to apply prefix-rules.
      const healthSnapshot = await adminApi.health();
      const VENDOR_FILE: Record<VendorId, string> = {
        openrouter: 'api/src/application/llm/vendors/openrouter.ts',
        cerebras:   'api/src/application/llm/vendors/cerebras.ts',
        nvidia:     'api/src/application/llm/vendors/nvidia.ts',
        ollama:     'api/src/application/llm/vendors/ollama.ts',
      };
      const enrichCatalog = (rows: ReadonlyArray<LlmModelStatus>) =>
        rows.map((m, i) => ({
          position: i,
          model: m.model,
          vendor: m.vendor,
          vendorFile: VENDOR_FILE[m.vendor],
        }));
      const catalog = {
        free: enrichCatalog(healthSnapshot.llm.free),
        pro:  enrichCatalog(healthSnapshot.llm.pro),
      };
      const catalogIds = new Set<string>([
        ...healthSnapshot.llm.free.map((m) => m.model),
        ...healthSnapshot.llm.pro.map((m) => m.model),
      ]);

      // Normalize byModel: callers can address Cerebras/NVIDIA/Ollama with or
      // without the vendor prefix; merge duplicates so the same upstream model
      // isn't double-counted (this caused "move llama3.1-8b" + "move
      // cerebras/llama3.1-8b" duplicates in the previous output).
      const stripVendorPrefix = (id: string): string => {
        for (const p of ['cerebras/', 'nvidia/', 'nim/', 'ollama/']) {
          if (id.startsWith(p)) {
            const stripped = id.slice(p.length);
            // Only strip if the stripped form is in the catalog — otherwise
            // it's an openrouter-style id that legitimately keeps its prefix.
            if (catalogIds.has(stripped)) return stripped;
          }
        }
        return id;
      };
      const mergedByModel = new Map<string, {
        model: string;
        requests: number;
        retries: number;
        streamed: number;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      }>();
      for (const m of llmUsage.byModel) {
        const key = stripVendorPrefix(m.model);
        const prev = mergedByModel.get(key);
        if (prev) {
          prev.requests += m.requests;
          prev.retries += m.retries;
          prev.streamed += m.streamed_requests;
          prev.promptTokens += m.prompt_tokens;
          prev.completionTokens += m.completion_tokens;
          prev.totalTokens += m.total_tokens;
        } else {
          mergedByModel.set(key, {
            model: key,
            requests: m.requests,
            retries: m.retries,
            streamed: m.streamed_requests,
            promptTokens: m.prompt_tokens,
            completionTokens: m.completion_tokens,
            totalTokens: m.total_tokens,
          });
        }
      }
      // Failover artifact detection — if most rows share the same count, the
      // cascade is just walking the whole pool uniformly and `failovers[].count`
      // is not a per-model quality signal. When this is true, we cannot
      // compute a meaningful per-model failureRate.
      const failoverCounts = llmUsage.failovers.map((f) => f.count);
      const fMean = failoverCounts.length > 0
        ? failoverCounts.reduce((s, n) => s + n, 0) / failoverCounts.length
        : 0;
      const fVariance = failoverCounts.length > 0
        ? failoverCounts.reduce((s, n) => s + (n - fMean) ** 2, 0) / failoverCounts.length
        : 0;
      const fStddev = Math.sqrt(fVariance);
      const cv = fMean > 0 ? fStddev / fMean : 0;
      const uniformFailoverArtifact = failoverCounts.length >= 5 && cv < 0.15;

      // Per-model failure rate, derived from failover events. Normalize the
      // failover-row model id the same way we normalize byModel rows so
      // cerebras/llama3.1-8b and llama3.1-8b roll up to the same model.
      // failureRate = failedAttempts / (failedAttempts + successfulAnswers).
      // When the failover counts are a uniform-cascade-walk artifact, the
      // numerator is noise — set failureRate to null so the AI can't act on it.
      const failedByModel = new Map<string, number>();
      for (const f of llmUsage.failovers) {
        const key = stripVendorPrefix(f.model);
        failedByModel.set(key, (failedByModel.get(key) ?? 0) + f.count);
      }
      // IMPORTANT: do NOT spread `m` — the raw `retries` and other unnormalized
      // counts let the AI compute its own (wrong) ratios and bypass our
      // pre-computed quality signals. Explicit field list only.
      const byModel = [...mergedByModel.values()]
        .sort((a, b) => b.requests - a.requests)
        .map((m) => {
          const failedAttempts = failedByModel.get(m.model) ?? 0;
          const totalAttempts = failedAttempts + m.requests;
          return {
            model: m.model,
            // `successfulAnswers` is the count of requests this model successfully
            // answered (winning row in llm_usage_log).
            successfulAnswers: m.requests,
            // Cascade-attempted-and-failed count derived from the failovers table.
            failedAttempts,
            totalAttempts,
            // True per-model failure rate — null when uniform-failover-artifact
            // makes per-model differentiation unreliable.
            failureRate: uniformFailoverArtifact || totalAttempts === 0
              ? null
              : Number((failedAttempts / totalAttempts).toFixed(3)),
            // Average count of OTHER models that failed before this one answered
            // (from llm_usage_log.retries on the winning row). High = this model
            // rescues the cascade often — that is a GOOD trait. Not a failure signal.
            avgCascadeDepth: m.requests > 0
              ? Number((m.retries / m.requests).toFixed(2))
              : 0,
            streamedAnswers: m.streamed,
            promptTokens: m.promptTokens,
            completionTokens: m.completionTokens,
            totalTokens: m.totalTokens,
            inCatalog: catalogIds.has(m.model),
            lowSample: m.requests < 5,
          };
        });

      // Use the windowed sum from byModel — `llmUsage.totals` is lifetime per
      // the known gap (README "Consolidated Gap Register": totals card is
      // all-time while byModel/daily are windowed). Lifetime totals would
      // under-trigger the small-sample gate.
      const windowedRequests = byModel.reduce((s, m) => s + m.successfulAnswers, 0);
      const dataQuality = {
        totalRequests: windowedRequests,
        smallSample: windowedRequests < 50,
        uniformFailoverArtifact,
        coefficientOfVariation: Number(cv.toFixed(3)),
        note: uniformFailoverArtifact
          ? 'Failover counts are near-uniform across models — the cascade walked the full pool on most failed requests, so failureRate is set to null for every model. REORDER_CATALOG and REMOVE_FROM_CATALOG are NOT legal in this state because there is no per-model failure signal. Only TUNE_COOLDOWN, TUNE_PREFERRED, and SWAP_FALLBACK may be recommended.'
          : 'Failover counts vary across models — byModel[].failureRate is the per-model quality signal. byModel[].avgCascadeDepth is a rescue-depth signal (HIGH = this model rescued the cascade often, which is GOOD) and MUST NOT be used as a failure signal.',
      };

      const summary = {
        windowDays: llmUsage.days,
        totals: llmUsage.totals,
        dataQuality,
        byModel,
        failovers: llmUsage.failovers,
        dailyTrend: llmUsage.daily.slice(-14),
        catalog,
      };
      const systemPrompt = [
        'You are a senior engineer producing a Claude Code prompt that another engineer will paste verbatim to improve the Builderforce.ai LLM gateway based on observed usage.',
        '',
        'GATEWAY ARCHITECTURE — ground every recommendation in these facts. Do not invent files, lists, or knobs that are not listed here.',
        '',
        '1. Pool composition is DERIVED, not hand-listed.',
        '   - `FREE_MODEL_POOL` and `PRO_MODEL_POOL` in api/src/application/llm/LlmProxyService.ts are computed from each vendor module\'s `catalog` array.',
        '   - To reorder which models are tried first within a vendor, reorder entries in that vendor\'s catalog file (each catalog entry carries `vendorFile`). There is no "fallback list in registry.ts".',
        '   - `FREE_ATTEMPT_BUDGET` (currently 2) caps how many FREE-tier models the cascade walks before falling through to the premium fallback chain. Non-FREE (paid Pro) models in the seed are not capped.',
        '   - `PREFERRED_POOL_SIZE` (currently 2) controls how many top-of-pool entries participate in round-robin. To prioritize a single model strongly, put it at position 0 of its vendor catalog.',
        '',
        '2. Premium fallback is a SHARED hard-coded list in LlmProxyService.ts.',
        '   - `PREMIUM_FALLBACK_MODELS` (Google AI direct first, then OpenRouter Gemini as a vendor-diverse backup) is appended to every non-strict candidate chain.',
        '   - To change which model resolves a saturated free pool, edit `PREMIUM_FALLBACK_MODELS` in api/src/application/llm/LlmProxyService.ts.',
        '',
        '3. Each entry in `catalog.free` / `catalog.pro` carries `vendor` and `vendorFile` — the file you must edit for any catalog change to that model. Use the supplied `vendorFile` verbatim; do not apply prefix rules yourself.',
        '',
        '4. Cooldown semantics (api/src/infrastructure/auth/cooldownStore.ts).',
        '   - Cooldowns punish FAILURES, classified by HTTP status: transient (5xx, 429) → 5 min; auth (401/403) → 30 min.',
        '   - Cooldowns are NEVER triggered by heavy successful usage. Do not recommend "cool down heavy-usage models" — that is structurally invalid.',
        '   - Legal cooldown changes: shorten/lengthen the TTL for a classification, add a new classification for a specific status, or add an early-recovery health probe (already an open gap).',
        '',
        '5. Streaming is CLIENT-controlled.',
        '   - The gateway streams when `body.stream === true` arrives from the caller (api/src/presentation/routes/llmRoutes.ts). The gateway cannot decide to stream based on token count because `total_tokens` is only known after generation finishes.',
        '   - Legal streaming-related changes: change which models the streaming dispatcher prefers (same catalog reorder mechanism), or exclude a vendor from streaming if it has no `callStream`.',
        '',
        '6. Rate limiting is UPSTREAM-owned.',
        '   - The gateway does not enforce per-model request-per-minute limits — those live with the vendor (Cerebras quotas, OpenRouter limits, etc.).',
        '   - Legal RL-adjacent changes: cooldown TTL tuning, catalog reordering away from rate-limited vendors, or `PREFERRED_POOL_SIZE` changes to spread load.',
        '',
        'LEGAL RECOMMENDATION TYPES (every recommendation in your output must be one of these):',
        '  A. REORDER_CATALOG  — move a model up/down in <vendor-file>.catalog',
        '  B. REMOVE_FROM_CATALOG — delete a model entry from <vendor-file>.catalog',
        '  C. SWAP_FALLBACK   — change `fallbackModel` in <vendor-file>',
        '  D. TUNE_COOLDOWN   — change a TTL or classification in cooldownStore.ts',
        '  E. TUNE_PREFERRED  — change `PREFERRED_POOL_SIZE` in LlmProxyService.ts',
        '',
        'HARD RULES — violating any of these invalidates the output:',
        '  1. Only reference model ids that appear verbatim in `catalog.free` or `catalog.pro`. If an id is not in the catalog, do not recommend touching it — it does not exist in the codebase.',
        '  2. PER-MODEL QUALITY SIGNAL = `byModel[].failureRate` (= `failedAttempts / totalAttempts`, range 0..1, pre-computed). HIGH failureRate = this model is failing — REMOVE or demote. LOW failureRate = this model is reliable — promote or keep. NEVER compute your own ratio from raw fields; use the pre-computed `failureRate` field as-is.',
        '  3. DO NOT use `byModel[].avgCascadeDepth` as a failure signal. `avgCascadeDepth` is how many OTHER models failed before this one rescued the request. HIGH avgCascadeDepth = this model is the safety net (GOOD). Promoting a high-avgCascadeDepth model is fine; REMOVING one is destructive. There is no "retry rate" field — that phrase from prior outputs was wrong.',
        '  4. If `byModel[i].failureRate` is `null` (because `dataQuality.uniformFailoverArtifact` is true), there is no per-model failure data for that row. In that case REORDER_CATALOG and REMOVE_FROM_CATALOG are FORBIDDEN — pool-wide signal does not differentiate. Only TUNE_COOLDOWN, TUNE_PREFERRED, and SWAP_FALLBACK remain legal.',
        '  5. If `dataQuality.smallSample` is true, output ONE recommendation only: `Collect more data before tuning — only X total requests in window.` and stop.',
        '  6. Skip any model row where `lowSample === true` unless it has `failureRate >= 0.80` (overwhelming evidence even at small N).',
        '  7. For REORDER_CATALOG, verify the target model is NOT already at the recommended position in `catalog.free` or `catalog.pro`. If it is already there, the recommendation is a no-op — drop it. (`catalog.free[0].model` is the current top.)',
        '  8. For every catalog edit, copy the `vendorFile` field from the matching catalog entry verbatim into the recommendation. Never invent or transform a file path.',
        '  9. TUNE_COOLDOWN: NEVER shorten the transient-failure (5xx, 429) TTL. Shortening it on rate-limit failures causes retry storms — the same model gets re-fired before the upstream limit clears, triggering more 429s. Lengthening the transient TTL is allowed; only the AUTH classification (401/403) may have its TTL shortened, and only with a specific data justification.',
        ' 10. NO DUPLICATES — the same `(type, file, model)` tuple may not appear twice in your output. Before emitting, scan your own list and drop dupes.',
        ' 11. Cap your output at 5 unique recommendations total. Pick the highest-signal ones. Quality over quantity.',
        '',
        'OUTPUT CONTRACT — produce ONLY the prompt text the user will paste into Claude Code. No preamble, no markdown fences around the whole prompt, no commentary. Follow this template exactly:',
        '',
        '----- TEMPLATE -----',
        'Based on the following Builderforce.ai gateway usage data, make the listed changes. Each recommendation is grounded in a specific number from the data and a specific file from the architecture.',
        '',
        'USAGE DATA:',
        '<paste a short readable summary: window, top models by successfulAnswers with their failureRate, failover-error breakdown including 429 counts, daily-trend direction>',
        '',
        'CHANGES:',
        '1. <RECOMMENDATION_TYPE> in <file_path>: <action>',
        '   Reason: <one-sentence justification citing a pre-computed field VERBATIM from the data — e.g. "X had failureRate=0.83 over totalAttempts=24 (failedAttempts=20, successfulAnswers=4), vs pool median failureRate=0.05">. NEVER write "retry rate" or "retries / requests" — those are the wrong words for the wrong metric.',
        '2. ...',
        '',
        'CONSTRAINTS:',
        '- Do not invent files or knobs outside the five legal types above.',
        '- Do not change client-controlled behavior (streaming flag, model selection by string).',
        '- Verify catalog edits by running `npm run typecheck` in api/ before reporting done.',
        '----- END TEMPLATE -----',
        '',
        'Final check before emitting: re-read HARD RULES 2, 3, 4, 7, 9, 10. If any recommendation cites avgCascadeDepth as a failure signal, drop it. If any rec touches catalog while failureRate is null, drop it. If any rec shortens the transient cooldown TTL, drop it. If any rec is a duplicate of another, drop the duplicate. It is better to emit zero recommendations than to emit a single bogus one.',
      ].join('\n');
      const userPrompt =
        'Usage data (JSON):\n```json\n' +
        JSON.stringify(summary, null, 2) +
        '\n```\nProduce the Claude Code prompt now, following the OUTPUT CONTRACT exactly.';
      const { content } = await llmChat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        // Anthropic Sonnet for this admin button — best instruction-following
        // for the 8 hard rules in the system prompt. Small models drifted
        // (uniform-failover signal, no-op reorders, wrong file attribution).
        { temperature: 0.1, maxTokens: 2048, model: 'anthropic/claude-3.7-sonnet' }
      );
      setUsageAiPrompt(content);
    } catch (e) {
      const err = e as Error & { code?: string; body?: Record<string, unknown> };
      // Tailored copy when the gateway returns a structured error envelope.
      // plan_token_limit_exceeded is most common in admin tools — show the
      // numbers from the envelope rather than swallowing them as "429".
      if (err.code === 'plan_token_limit_exceeded' && err.body) {
        const used  = err.body.usedToday  as number | undefined;
        const limit = err.body.dailyLimit as number | undefined;
        const retryAfter = err.body.retryAfter as number | undefined;
        const hours = retryAfter != null ? Math.ceil(retryAfter / 3600) : null;
        setUsageAiError(
          t('usage.dailyTokenLimit', {
            used: used?.toLocaleString() ?? '?',
            limit: limit?.toLocaleString() ?? '?',
          }) +
          (hours != null ? t('usage.dailyTokenLimitReset', { hours }) : '')
        );
      } else if (err.code === 'agent_host_token_limit_exceeded') {
        setUsageAiError(err.message);
      } else {
        setUsageAiError(err.message || String(e));
      }
    } finally {
      setUsageAiLoading(false);
    }
  };

  const copyUsageAiPrompt = async () => {
    if (!usageAiPrompt) return;
    try {
      await navigator.clipboard.writeText(usageAiPrompt);
      setUsageAiCopied(true);
      setTimeout(() => setUsageAiCopied(false), 2000);
    } catch (e) {
      setUsageAiError(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading && !llmUsage) return <AdminLoading />;

  return (
    <>
      <AdminError message={error} />
      {llmUsage && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="btn-primary"
              onClick={runUsageAiAnalysis}
              disabled={usageAiLoading}
              title={t('usage.aiAnalyzeTooltip')}
            >
              {usageAiLoading ? t('usage.analyzing') : t('usage.aiAnalyze')}
            </button>
          </div>
          {usageAiError && (
            <div className="error-banner" style={{ fontSize: 13 }}>{usageAiError}</div>
          )}
          {usageAiPrompt && (
            <div className="health-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="health-label">{t('usage.claudePromptLabel')}</div>
                <button type="button" className="btn-ghost" onClick={copyUsageAiPrompt}>
                  {usageAiCopied ? `✓ ${t('common.copied')}` : t('common.copy')}
                </button>
              </div>
              <textarea
                readOnly
                value={usageAiPrompt}
                style={{
                  width: '100%',
                  minHeight: 240,
                  fontFamily: 'var(--font-mono, monospace)',
                  fontSize: 12,
                  padding: 12,
                  background: 'var(--bg-secondary, #0b0b0b)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  resize: 'vertical',
                }}
              />
            </div>
          )}
          <div className="health-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
            <div className="health-card">
              <div className="health-label">{t('usage.requests')}</div>
              <div className="health-value">{fmtNum(llmUsage.totals.requests)}</div>
            </div>
            <div className="health-card">
              <div className="health-label">{t('usage.totalTokens')}</div>
              <div className="health-value">{fmtNum(llmUsage.totals.totalTokens)}</div>
            </div>
            <div className="health-card">
              <div className="health-label">{t('usage.models')}</div>
              <div className="health-value">{llmUsage.totals.modelCount}</div>
            </div>
            <div className="health-card">
              <div className="health-label">{t('usage.spend')}</div>
              <div className="health-value">$0</div>
              <div style={{ fontSize: 12 }}>{t('usage.freeTier')}</div>
            </div>
          </div>
          {llmUsage.daily.length > 0 && (
            <div>
              <div className="health-label" style={{ marginBottom: 8 }}>{t('usage.dailyRequests')}</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, minHeight: 120 }}>
                {llmUsage.daily.slice(-30).map((d) => {
                  const maxReq = Math.max(1, ...llmUsage!.daily.map((x) => x.requests));
                  const h = maxReq ? (d.requests / maxReq) * 100 : 0;
                  return (
                    <div
                      key={d.day}
                      title={t('usage.dailyBarTooltip', { day: d.day, requests: d.requests })}
                      style={{
                        flex: 1,
                        minWidth: 8,
                        height: `${Math.max(4, h)}%`,
                        background: 'var(--accent)',
                        borderRadius: 4,
                      }}
                    />
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                <span>{llmUsage.daily[llmUsage.daily.length - 30]?.day ?? ''}</span>
                <span>{llmUsage.daily[llmUsage.daily.length - 1]?.day ?? ''}</span>
              </div>
            </div>
          )}
          {byVendor.length > 0 && (
            <div>
              <div className="health-label" style={{ marginBottom: 8 }}>{t('usage.byVendor')}</div>
              <div className="health-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
                {byVendor.map((v) => {
                  const fresh = vendorHealthResult[v.vendor];
                  const last  = vendorHealthLatest[v.vendor];
                  const health = fresh ?? last;
                  const running = !!vendorHealthRunning[v.vendor];
                  const probeErr = vendorHealthError[v.vendor];
                  const statusColor: Record<string, string> = {
                    ok: 'var(--success-text, #16a34a)',
                    degraded: 'var(--warning-text, #d97706)',
                    down: 'var(--error-text, #dc2626)',
                    unconfigured: 'var(--text-muted)',
                  };
                  return (
                    <div key={v.vendor} className="health-card">
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                        <div className="health-label" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{v.vendor}</div>
                        <button
                          type="button"
                          className="btn-ghost"
                          style={{ fontSize: 11, padding: '2px 8px', opacity: running ? 0.6 : 1 }}
                          disabled={running}
                          onClick={() => runVendorHealthCheck(v.vendor)}
                          title={t('usage.checkTooltip')}
                        >
                          {running ? t('usage.checking') : t('usage.check')}
                        </button>
                      </div>
                      <div className="health-value">{fmtNum(v.requests)}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {t('usage.vendorModelsTokens', { models: v.modelCount, tokens: fmtNum(v.totalTokens) })}
                      </div>
                      <div style={{ fontSize: 12, color: v.failoverCount > 0 ? 'var(--error-text)' : 'var(--text-muted)', fontWeight: v.failoverCount > 0 ? 600 : 400 }}>
                        {t('usage.vendorFailoversRetries', { failovers: v.failoverCount, failoverDisplay: fmtNum(v.failoverCount), retries: fmtNum(v.retries) })}
                      </div>
                      {probeErr ? (
                        <div style={{ fontSize: 11, color: 'var(--error-text)', marginTop: 6 }}>{probeErr}</div>
                      ) : health ? (
                        <div style={{ marginTop: 6, fontSize: 12, color: statusColor[health.status] ?? 'var(--text-muted)', fontWeight: 600 }}>
                          {t('usage.vendorStatus', { status: health.status, ok: health.okCount, probed: health.probedCount })}
                          {health.latencyMs > 0 && (
                            <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {health.latencyMs}ms</span>
                          )}
                          {!fresh && last?.createdAt && (
                            <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {fmtDateTime(last.createdAt)}</span>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div>
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="text-muted" style={{ fontSize: 14 }}>{t('usage.byModelLast')}</span>
              <Select
                value={usageDays}
                onChange={async (e) => {
                  const days = Number(e.target.value);
                  setUsageDays(days);
                  setLoading(true);
                  setErrorMsg('');
                  try {
                    setLlmUsage(await adminApi.llmUsage(days));
                  } catch (err) {
                    setErrorMsg(err instanceof Error ? err.message : String(err));
                  } finally {
                    setLoading(false);
                  }
                }}
                className="admin-select"
              >
                {[7, 14, 30, 60, 90].map((d) => (
                  <option key={d} value={d}>{t('usage.daysOption', { d })}</option>
                ))}
              </Select>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('usage.vendor')}</th>
                    <th>{t('usage.model')}</th>
                    <th style={{ textAlign: 'right' }}>{t('usage.requests')}</th>
                    <th style={{ textAlign: 'right' }}>{t('usage.retries')}</th>
                    <th style={{ textAlign: 'right' }}>{t('usage.streamed')}</th>
                    <th style={{ textAlign: 'right' }}>{t('usage.promptTokens')}</th>
                    <th style={{ textAlign: 'right' }}>{t('usage.completionTokens')}</th>
                    <th style={{ textAlign: 'right' }}>{t('usage.totalTokens')}</th>
                  </tr>
                </thead>
                <tbody>
                  {byModelSorted.length === 0 ? (
                    <tr><td colSpan={8} className="text-muted" style={{ padding: 24 }}>{t('usage.noUsage')}</td></tr>
                  ) : (
                    byModelSorted.map((m, i) => {
                      const prevVendor = i > 0 ? byModelSorted[i - 1].vendor : null;
                      const isVendorBreak = m.vendor !== prevVendor;
                      return (
                        <tr key={m.model} style={isVendorBreak && i > 0 ? { borderTop: '2px solid var(--border-subtle, #2a2a2a)' } : undefined}>
                          <td style={{ textTransform: 'uppercase', fontSize: 11, color: 'var(--text-muted)' }}>{isVendorBreak ? m.vendor : ''}</td>
                          <td>{m.model}</td>
                          <td style={{ textAlign: 'right' }}>{fmtNum(m.requests)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtNum(m.retries)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtNum(m.streamed_requests)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtNum(m.prompt_tokens)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtNum(m.completion_tokens)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtNum(m.total_tokens)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                <tfoot>
                  {llmUsage.byModel.length > 0 && (
                    <tr style={{ fontWeight: 600 }}>
                      <td></td>
                      <td>{t('usage.total')}</td>
                      <td style={{ textAlign: 'right' }}>{fmtNum(llmUsage.totals.requests)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtNum(llmUsage.byModel.reduce((s, m) => s + m.retries, 0))}</td>
                      <td style={{ textAlign: 'right' }}>{fmtNum(llmUsage.byModel.reduce((s, m) => s + m.streamed_requests, 0))}</td>
                      <td style={{ textAlign: 'right' }}>{fmtNum(llmUsage.totals.promptTokens)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtNum(llmUsage.totals.completionTokens)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtNum(llmUsage.totals.totalTokens)}</td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          </div>
          <div>
            <div className="health-label" style={{ marginBottom: 8 }}>
              {t('usage.failoverEvents')}
              {llmUsage.failovers.some((f) => f.errorCode === 429) && (
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--error-text)', fontWeight: 600 }}>
                  {t('usage.rateLimitHits', { count: fmtNum(llmUsage.failovers.filter((f) => f.errorCode === 429).reduce((s, f) => s + f.count, 0)) })}
                </span>
              )}
            </div>
            {failoversSorted.length === 0 ? (
              <p className="text-muted" style={{ fontSize: 13 }}>{t('usage.noFailovers')}</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table" style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>{t('usage.vendor')}</th>
                      <th>{t('usage.model')}</th>
                      <th style={{ textAlign: 'right' }}>{t('usage.httpCode')}</th>
                      <th style={{ textAlign: 'right' }}>{t('usage.count')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failoversSorted.map((f, i) => {
                      const prevVendor = i > 0 ? failoversSorted[i - 1].vendor : null;
                      const isVendorBreak = f.vendor !== prevVendor;
                      return (
                        <tr
                          key={`${f.model}-${f.errorCode}-${i}`}
                          style={{
                            ...(f.errorCode === 429 ? { background: 'var(--error-bg, #fee2e2)' } : {}),
                            ...(isVendorBreak && i > 0 ? { borderTop: '2px solid var(--border-subtle, #2a2a2a)' } : {}),
                          }}
                          title={f.errorCode === 429 ? t('usage.rateLimitTooltip') : undefined}
                        >
                          <td style={{ textTransform: 'uppercase', fontSize: 11, color: 'var(--text-muted)' }}>{isVendorBreak ? f.vendor : ''}</td>
                          <td>{f.model}</td>
                          <td style={{ textAlign: 'right', fontWeight: f.errorCode === 429 ? 600 : 400 }}>{f.errorCode}</td>
                          <td style={{ textAlign: 'right' }}>{f.count}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
