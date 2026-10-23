/**
 * Vendor DISPATCH for the gateway — one candidate chain in, one `ProxyResult` out.
 *
 * Split out of `LlmProxyService.ts`. Owns request shaping for the vendor layer
 * (tool-name sanitizing, param lifting, reasoning intent, timeout precedence), the
 * JSON path with its `response_format` conformance retry, the streaming path, the
 * credited-key backstop, and the per-attempt side effects every path shares:
 * cooldown writes, vendor-health streaks and the mid-cascade cooldown re-check.
 *
 * What it deliberately does NOT own: which chain to walk (`proxySeed`), who funded
 * the call (`ProxyFunding`), and how failures are worded (`proxyEnvelopes`).
 */

import { reportCaughtError } from '../observability/caughtErrorReporter';
import {
  CascadeExhaustedError,
  dispatchVendor,
  dispatchVendorStream,
  WorkerSubrequestExhaustedError,
  RequestAbortedError,
  VendorFatalError,
  type DispatchAttempt,
  type VendorEnv,
  type VendorId,
} from './vendors';
import { checkResponseFormatConformance } from './responseFormat';
import { stripStandardFields } from './poolRouting';
import { sanitizeRequestToolCalls, restoreResponseToolNames, restoreStreamToolNames } from './toolNameSanitizer';
import { loadCooledModelsForVendor, recordFailures } from '../../infrastructure/auth/cooldownStore';
import { resolveDispatchReasoningIntent } from './dispatchReasoningIntent';
import { reasoningReplayStore } from '../../infrastructure/cache/reasoningReplayStore';
import { recordVendorUpstreamFaults, recordVendorUpstreamSuccess } from './vendors/vendorHealth';
import { PREMIUM_VENDOR_CALL_TIMEOUT_MS, resolveCacheTtl, resolveVendorTimeoutOverride } from './modelPool';
import { evermindToolChoiceMinMargin } from './evermindToolCall';
import { attemptsToFailovers, fatalErrorAttempt, isRequestErrorStatus } from './proxyFailover';
import { exhaustedResponse, requestErrorResponse, subrequestExhaustedResponse } from './proxyEnvelopes';
import { toLlmUsage, type ChatCompletionRequest, type FailoverEvent, type ProxyResult } from './proxyTypes';
import type { ProxyConfig } from './proxyConfig';
import type { ProxyFunding } from './proxyFunding';

/** Per-dispatch overrides — the backstop's credited env + budget, a caller's abort
 *  signal, and the last-chance probe's cooldown bypass. */
export interface DispatchOverrides {
  vendorEnv?: VendorEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
  ignoreCooldown?: boolean;
  /** Raise the reasoning intent one level (cost PRD D4) — the D1 verifier cascade's
   *  retry after a weak answer. Inert when the dispatch carries no intent. */
  escalateReasoning?: boolean;
}

export class ProxyDispatcher {
  private readonly cfg: ProxyConfig;
  private readonly funding: ProxyFunding;

  constructor(cfg: ProxyConfig, funding: ProxyFunding) {
    this.cfg = cfg;
    this.funding = funding;
  }

  /**
   * Guaranteed paid backstop — see `GUARANTEED_BACKSTOP_MODEL`. Dispatched only
   * after the primary cascade has failed (or every candidate was cooled). Forces
   * the credited key + the extended premium timeout so one low-variance paid
   * model can answer even on the free plan with a saturated free pool.
   *
   * Returns the successful `ProxyResult`, or `null` when no credited key is bound
   * or the backstop itself fails — the caller then surfaces the original failure.
   */
  async dispatchBackstop(
    body: ChatCompletionRequest,
    requestHeaders?: Record<string, string>,
  ): Promise<ProxyResult | null> {
    if (this.funding.byoStrict) return null;
    const creditedEnv = this.funding.creditedVendorEnv();
    if (!creditedEnv.OPENROUTER_API_KEY) return null; // no paid key to fall back to
    const result = await this.dispatch([...this.cfg.backstopModels], body, requestHeaders, {
      vendorEnv: creditedEnv,
      timeoutMs: PREMIUM_VENDOR_CALL_TIMEOUT_MS,
    });
    return result.response.status < 400 ? result : null;
  }

  async dispatch(
    candidates: string[],
    body: ChatCompletionRequest,
    requestHeaders?: Record<string, string>,
    overrides?: DispatchOverrides,
  ): Promise<ProxyResult> {
    // Sanitize tool names (`governance.snapshot` → `governance__DOT__snapshot`)
    // AND tool-call ids (foreign ids with `:` `/` `.` → `^[a-zA-Z0-9_-]+$`)
    // before the body reaches a vendor — Anthropic / some Cerebras configs
    // reject both. Walks `tools`, `tool_choice`, message `tool_calls` (name+id),
    // and tool-message `name`/`tool_call_id`. Names are restored in dispatchJson
    // before returning to the caller; ids are opaque and are not restored.
    const sanitizedBody = sanitizeRequestToolCalls(body as unknown as Record<string, unknown>) as unknown as ChatCompletionRequest;
    const messages = sanitizedBody.messages as unknown as Array<Record<string, unknown>>;
    const extraBody = stripStandardFields(sanitizedBody);
    // Lift tools / tool_choice onto VendorCallParams. OpenAI-shaped vendors also see
    // them via extraBody; Responses vendors (xai-oauth, openai-codex) read
    // params.tools / params.toolChoice only — without this lift a forced
    // `tool_choice: 'required'` from stall recovery never reaches Grok.
    const liftedTools = Array.isArray((sanitizedBody as { tools?: unknown }).tools)
      ? (sanitizedBody as unknown as { tools: unknown[] }).tools
      : undefined;
    const liftedToolChoice = (sanitizedBody as { tool_choice?: unknown }).tool_choice;
    // ── Client reasoning intent ─────────────────────────────────────────────
    // The optional vendor-neutral `reasoning: { level }` (VS Code "Thinking" toggle) is
    // validated into an `AgentExecParams` lever here and threaded to the vendor
    // dispatcher AS INTENT — deliberately NOT resolved to a vendor param at this seam.
    // A dispatch carries a candidate CHAIN that the dispatcher walks internally on
    // failover, so a param computed once here would ride onto whichever model the
    // cascade lands on; `dispatchInternal` instead derives it PER CANDIDATE through the
    // single `reasoningParamsForModel` mapping, so an `auto`/mixed-family chain gets the
    // right param on the Anthropic/OpenAI hops and nothing at all on a
    // Cloudflare/deepseek/qwen coder.
    // `isFirstTurn`: a request with no assistant turn yet is definitionally a planning
    // turn (a tool-result continuation always carries one), which is what makes Anthropic
    // extended thinking safe alongside tools — same rule the cloud loop uses.
    // With cost lever `d4_role_reasoning` on, a call that names no level takes its
    // ROLE's default effort (`roleReasoning.ts`) — explicit always wins.
    // The lever buckets on the tenant the proxy was built for; a tenant-less proxy
    // (internal utilities) gets it only at a 100% rollout.
    const reasoningIntent = await resolveDispatchReasoningIntent(this.cfg.env, {
      reasoning: (sanitizedBody as Record<string, unknown>).reasoning,
      role: (sanitizedBody as { role?: unknown }).role,
      isFirstTurn: !messages.some((m) => m.role === 'assistant'),
      tenantId: this.cfg.tenantId,
      ...(overrides?.escalateReasoning ? { escalate: true } : {}),
    });
    // Timeout precedence: an explicit dispatch override (e.g. the paid backstop
    // forcing the premium budget) wins; otherwise a per-request caller override
    // (`_builderforce.vendorTimeoutMs`, clamped) lets even a free-plan one-off
    // long call escape the short plan default; otherwise the proxy's configured
    // plan default. Reuses the existing `overrides.timeoutMs` plumbing — no
    // parallel path.
    const effectiveTimeoutMs =
      overrides?.timeoutMs
      ?? resolveVendorTimeoutOverride(sanitizedBody as unknown as Record<string, unknown>)
      ?? this.cfg.vendorCallTimeoutMs;
    const vendorEnv = overrides?.vendorEnv ?? this.funding.vendorEnv();
    const cacheTtl = resolveCacheTtl(sanitizedBody as unknown as Record<string, unknown>);
    const callParams = {
      messages,
      ...(liftedTools ? { tools: liftedTools } : {}),
      ...(liftedToolChoice !== undefined ? { toolChoice: liftedToolChoice } : {}),
      ...(sanitizedBody.max_tokens  != null ? { maxTokens:   sanitizedBody.max_tokens  } : {}),
      ...(sanitizedBody.temperature != null ? { temperature: sanitizedBody.temperature } : {}),
      ...(sanitizedBody.top_p       != null ? { topP:        sanitizedBody.top_p       } : {}),
      ...(Object.keys(extraBody).length > 0 ? { extraBody } : {}),
      ...(reasoningIntent ? { reasoningIntent } : {}),
      ...(cacheTtl ? { cacheTtl } : {}),
      title: this.cfg.productName,
      ...(effectiveTimeoutMs ? { timeoutMs: effectiveTimeoutMs } : {}),
      ...(overrides?.signal ? { signal: overrides.signal } : {}),
      // Thread the R2 artifact store so the `evermind` vendor can load a
      // published model. Harmless for every other (HTTP) vendor — they ignore it.
      ...(this.cfg.env.UPLOADS ? { uploads: this.cfg.env.UPLOADS } : {}),
      // Grok's encrypted reasoning between the turns of a tool loop, kept in the platform
      // cache (`vendors/reasoningReplay.ts`). Only the xai-oauth vendor reads it.
      ...(this.cfg.env.AUTH_CACHE_KV ? { reasoningReplay: reasoningReplayStore(this.cfg.env) } : {}),
      toolChoiceMinMargin: evermindToolChoiceMinMargin(this.cfg.env),
      // Local egress for the one class of vendor whose upstream refuses OUR machine
      // rather than our key (Kimi Code). `dispatchInternal` hands it only to a module
      // that declares `requiresLocalEgress`, so this is inert for every other vendor.
      ...(this.cfg.hostEgress ? { egress: this.cfg.hostEgress } : {}),
      // Mid-cascade cooldown re-check, decided ONCE per dispatch (its memo is
      // per-dispatch anyway). A last-chance probe omits it: the caller has already
      // established that every candidate is cooled and is deliberately trying anyway,
      // so re-filtering the probe by the very state it exists to override would skip
      // every hop after the first and hand the caller back the same dead end.
      ...(overrides?.ignoreCooldown ? {} : { isCooled: this.midCascadeCooldownCheck() }),
    };

    if (sanitizedBody.stream) {
      return this.dispatchStream(candidates, callParams, vendorEnv, requestHeaders);
    }
    return this.dispatchJson(candidates, callParams, vendorEnv, sanitizedBody);
  }

  /**
   * Non-streaming dispatch with optional `response_format` conformance retry.
   *
   * When the request asks for `json_object` or `json_schema` output, the
   * gateway parses the assistant message after each successful vendor call.
   * If parsing fails (or, for strict `json_schema`, the document is missing
   * a required field) the gateway advances past the model that just answered
   * and re-dispatches on the remaining suffix. The total non-conforming
   * round-trips are surfaced via `_builderforce.schemaRetries`.
   */
  private async dispatchJson(
    candidates: string[],
    callParams: Omit<Parameters<typeof dispatchVendor>[0], 'env' | 'modelChain'>,
    vendorEnv: VendorEnv,
    body: ChatCompletionRequest,
  ): Promise<ProxyResult> {
    let chain = candidates;
    let totalAttempts = 0;
    const totalFailovers: FailoverEvent[] = [];
    let schemaRetries = 0;
    let lastResult: Awaited<ReturnType<typeof dispatchVendor>> | null = null;

    while (chain.length > 0) {
      let result: Awaited<ReturnType<typeof dispatchVendor>>;
      try {
        result = await dispatchVendor({
          env: vendorEnv,
          modelChain: chain,
          ...callParams,
        });
      } catch (err) {
        // Worker subrequest cap exhausted — every later fetch from this isolate
        // throws the same thing. Surface a distinct 503 envelope and SKIP
        // cooldown writes (each is another subrequest that would compound the
        // problem and may itself throw the same error). The 503 lets the
        // caller distinguish "infrastructure ceiling" from "vendor rate limit"
        // and back off rather than retrying a doomed loop.
        if (err instanceof WorkerSubrequestExhaustedError) {
          return subrequestExhaustedResponse(this.cfg.modelPool[0], candidates, schemaRetries, err);
        }
        // Caller cancelled — propagate so complete() stops immediately instead of
        // firing the paid backstop and spending more tokens on a cancelled run.
        if (err instanceof RequestAbortedError) throw err;
        // Fatal bad-payload (400/422) short-circuits the cascade in the vendor
        // dispatcher (failover can't fix a malformed request). Surface it as a
        // FATAL 4xx carrying the upstream diagnostic — NOT a 429 — and write no
        // cooldown (recordFailure no-ops request_error anyway). Mirrors the
        // all-request-error branch in exhaustedResponse for the cascaded case.
        if (err instanceof VendorFatalError && isRequestErrorStatus(err.status)) {
          const att = fatalErrorAttempt(err, chain);
          return requestErrorResponse([att], att.model, att.vendor, attemptsToFailovers([att]), schemaRetries);
        }
        const errAttempts = err instanceof CascadeExhaustedError ? err.attempts : [];
        await this.applyCooldowns(errAttempts);
        return exhaustedResponse(this.cfg.modelPool[0], candidates, schemaRetries, err, errAttempts);
      }

      await this.applyCooldowns(result.attempts);
      totalAttempts += result.attempts.length;
      totalFailovers.push(...attemptsToFailovers(result.attempts));
      lastResult = result;

      const conformanceErr = checkResponseFormatConformance(body, result.raw);
      if (!conformanceErr) {
        return await this.successJsonResult(result, totalAttempts, totalFailovers, schemaRetries);
      }

      // Non-conforming: advance past the model that just answered.
      schemaRetries++;
      const idx = chain.indexOf(result.modelUsed);
      chain = idx >= 0 ? chain.slice(idx + 1) : [];
    }

    // Chain exhausted with all candidates non-conforming. Return the last
    // body so callers see whatever the most-capable model produced, but
    // surface the retry count so they can detect the conformance failure.
    if (lastResult) {
      return await this.successJsonResult(lastResult, totalAttempts, totalFailovers, schemaRetries);
    }
    return exhaustedResponse(this.cfg.modelPool[0], candidates, schemaRetries);
  }

  private async successJsonResult(
    result: Awaited<ReturnType<typeof dispatchVendor>>,
    totalAttempts: number,
    totalFailovers: FailoverEvent[],
    schemaRetries: number,
  ): Promise<ProxyResult> {
    // The vendor that served this request is demonstrably healthy — clear any 5xx
    // streak so it reclaims its lead position in the BYO seed immediately instead of
    // waiting out the health TTL.
    //
    // AWAITED, matching the streaming path. It used to be `void`, which on Workers
    // means the promise can be cancelled the moment the response is returned: a
    // recovered vendor then kept its seed-order demotion for the full 30-minute
    // health TTL, on the exact request that proved it had recovered. One KV write on
    // the success path is a fair price for a promotion that actually happens.
    await this.clearVendorHealth(result.vendorUsed);
    // Restore dotted tool names that the request-side sanitizer escaped, so
    // `tool_calls[*].function.name` round-trips to the caller's namespace.
    const restoredRaw = restoreResponseToolNames(result.raw);
    return {
      response: new Response(JSON.stringify(restoredRaw), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      resolvedModel: result.modelUsed,
      resolvedVendor: result.vendorUsed,
      retries: totalAttempts,
      failovers: totalFailovers,
      outcome: 'success',
      attempts: result.attempts,
      ...(result.usage ? { usage: toLlmUsage(result.usage) } : {}),
      ...(schemaRetries > 0 ? { schemaRetries } : {}),
    };
  }

  private async dispatchStream(
    candidates: string[],
    callParams: Omit<Parameters<typeof dispatchVendorStream>[0], 'env' | 'modelChain'>,
    vendorEnv: VendorEnv,
    _requestHeaders?: Record<string, string>,
  ): Promise<ProxyResult> {
    try {
      const result = await dispatchVendorStream({
        env: vendorEnv,
        modelChain: candidates,
        ...callParams,
      });
      // AWAITED. Its own doc-comment says a `void` promise on Workers can be aborted
      // when the request lifecycle ends — and the streaming path is exactly where that
      // happens, because the response is returned the moment headers arrive. Left
      // floating, a streaming cascade's cooldowns were the ones most likely to be lost.
      await this.applyCooldowns(result.attempts);
      // Restore dotted tool names in the streamed SSE deltas — symmetric to the
      // non-streaming `restoreResponseToolNames` in successJsonResult. Names can
      // arrive in fragments, so a stateful restorer buffers per tool-call index.
      const restoredBody = result.response.body
        ? restoreStreamToolNames(result.response.body)
        : result.response.body;
      const response = restoredBody && restoredBody !== result.response.body
        ? new Response(restoredBody, {
            status: result.response.status,
            headers: result.response.headers,
          })
        : result.response;
      // Streaming counterpart of the health clear in `successJsonResult` — headers
      // arrived, so this vendor is serving again.
      await this.clearVendorHealth(result.vendorUsed);
      return {
        response,
        resolvedModel: result.modelUsed,
        resolvedVendor: result.vendorUsed,
        retries: result.attempts.length,
        failovers: attemptsToFailovers(result.attempts),
        outcome: 'success',
        attempts: result.attempts,
      };
    } catch (err) {
      if (err instanceof WorkerSubrequestExhaustedError) {
        return subrequestExhaustedResponse(this.cfg.modelPool[0], candidates, 0, err);
      }
      if (err instanceof RequestAbortedError) throw err;
      // Fatal bad-payload (400/422) — surface as a fatal 4xx, not a 429. See the
      // non-streaming dispatchJson branch for rationale.
      if (err instanceof VendorFatalError && isRequestErrorStatus(err.status)) {
        const att = fatalErrorAttempt(err, candidates);
        return requestErrorResponse([att], att.model, att.vendor, attemptsToFailovers([att]), 0);
      }
      const errAttempts = err instanceof CascadeExhaustedError ? err.attempts : [];
      await this.applyCooldowns(errAttempts);
      return exhaustedResponse(this.cfg.modelPool[0], candidates, 0, err, errAttempts);
    }
  }

  /**
   * Record cooldowns for every failed attempt. Classification (5 min for
   * transient, 30 min for auth) lives in `cooldownStore.classifyFailure`.
   *
   * Awaited (not fire-and-forget): on Cloudflare Workers a `void` promise can
   * be aborted when the request lifecycle ends, leaving the cooldown unwritten.
   * KV writes are ~50–200ms in parallel — only on the failure path — so the
   * extra latency is acceptable in exchange for cooldowns that actually stick.
   */
  private async applyCooldowns(attempts: ReadonlyArray<DispatchAttempt>): Promise<void> {
    if (attempts.length === 0) return;
    // An attempt that rode the tenant's OWN credential writes NO cooldown: the keyspace is
    // global, so one owner's expired token would bench that model for our shared key and
    // for every other tenant ({@link isOwnerServedVendor}). Their signal is the vendor-health
    // fault below (seed order) plus the per-tenant `providerAuthAlerts` record the gateway
    // route and the daily BYO probe both write.
    const coolable = attempts.filter((a) => !this.funding.isOwnerServedModel(a.model));
    // BOTH writes are now GROUPED BY VENDOR rather than issued per attempt. A failed
    // cascade used to fan out 2N parallel KV operations — one `recordFailure` (itself
    // a read + a write) and one vendor-fault read-modify-write per attempt — on a
    // request that had already spent its subrequest budget failing. Grouped, an
    // N-attempt cascade costs one read + one write per distinct vendor.
    await Promise.all([
      recordFailures(this.cfg.env, coolable.map((a) => ({
        vendor: a.vendor, model: a.model, status: a.status, ...(a.error ? { hint: a.error } : {}),
      }))),
      // Independent of the cooldown above: extend the 5xx streak that governs BYO
      // SEED ORDER. Non-5xx statuses are ignored inside, so handing it every attempt
      // is safe — a 429 or an auth failure must not demote a vendor, those are the
      // cooldown store's business. See `vendorHealth` for why the two signals are
      // deliberately separate.
      recordVendorUpstreamFaults(this.cfg.env, attempts.map((a) => ({ vendorId: a.vendor, status: a.status }))),
    ]);
  }

  /**
   * A mid-cascade cooldown re-check, memoized per DISPATCH.
   *
   * The chain was filtered when it was composed, but a cascade takes seconds — one
   * slow vendor timeout is 15s on its own — and a concurrent request can cool a
   * candidate this one has not reached yet. Without a re-check, the cascade walks
   * into it, spends the timeout, and cools it again.
   *
   * The cost is bounded by the memo, not by the chain length: the store is keyed by
   * vendor now (one composite blob per vendor), and each vendor is read at most once
   * per dispatch. So a 10-candidate cascade across two vendors costs two reads on the
   * failing path and zero on the happy path (the check never fires before the first
   * failure). Skips owner-served models for the same reason `applyCooldowns` does —
   * the keyspace is global and cannot speak for one tenant's own credential.
   */
  private midCascadeCooldownCheck(): (vendor: VendorId, model: string) => Promise<boolean> {
    const seen = new Map<VendorId, Promise<Set<string>>>();
    return async (vendor, model) => {
      if (this.funding.isOwnerServedModel(model)) return false;
      let cooled = seen.get(vendor);
      if (!cooled) {
        // The whole vendor's cooled set in one read — the composite key scheme makes
        // "everything cooled on this vendor" exactly as cheap as "is this one model".
        cooled = loadCooledModelsForVendor(this.cfg.env, vendor).catch(() => new Set<string>());
        seen.set(vendor, cooled);
      }
      return (await cooled).has(model);
    };
  }

  /**
   * Clear a served vendor's 5xx streak so a recovered account reclaims its lead
   * position on the NEXT request rather than waiting out the health TTL. Cheap: a
   * vendor with no streak recorded exits after one cached read and writes nothing,
   * which is the state of essentially every successful call.
   *
   * Only the vendor that actually SERVED the request is cleared — vendors that
   * failed on the way to it were just recorded as faults by `applyCooldowns`.
   */
  private async clearVendorHealth(vendor: VendorId): Promise<void> {
    await recordVendorUpstreamSuccess(this.cfg.env, vendor).catch((error) => { /* advisory */ 
      reportCaughtError(error, { source: "application/llm/LlmProxyService.ts", operation: "clearVendorHealth" });
    });
  }
}
