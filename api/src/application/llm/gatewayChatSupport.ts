/**
 * `/v1/chat/completions` support — the request-side model-ref expansion and the
 * response-side derivations (capped BYO providers, other-workspace BYO hint, the
 * Brain-chat model activity row) that the gateway's chat handler composes.
 *
 * Carved out of `presentation/routes/llmRoutes.ts`, whose single chat handler had
 * grown past 650 lines with this business logic inline.
 */
import type { Env } from '../../env';
import type { DbHandle } from '../shared/dbHandle';
import { recordActivity, cloudAgentActor, buildModelActivityMetadata } from '../activity/activityLog';
import { resolveWorkforceModel, WORKFORCE_MODEL_REF_PREFIX } from '../agent/agentPrompt';
import { isVolatileContent } from '@seanhogg/builderforce-memory/handoff';
import { resolveTenantModel, TENANT_MODEL_REF_PREFIX } from './tenantModelService';
import { resolveProjectEvermindModelPin, PROJECT_EVERMIND_MODEL_PREFIX } from './projectEvermind';
import { classifyReplyAccount } from './replyProvenance';
import { CAPACITY_LIMIT_MARKER } from './vendors/types';
import type { DispatchAttempt } from './vendors';
import {
  providersConnectedInOtherWorkspaces,
  SUPPORTED_PROVIDERS,
  type LlmProvider,
} from './tenantProviderKeyService';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';

type ChatMessage = { role?: string; content?: unknown };

/** Prepend `directives` to the conversation's system message (or add one). */
function prependSystemDirectives(messages: ChatMessage[], directives: string): void {
  const sysIdx = messages.findIndex((m) => m.role === 'system');
  const sysMsg = sysIdx >= 0 ? messages[sysIdx] : undefined;
  if (sysMsg) {
    const prev = typeof sysMsg.content === 'string' ? sysMsg.content : '';
    messages[sysIdx] = { ...sysMsg, content: `${directives}\n\n${prev}`.trim() };
  } else {
    messages.unshift({ role: 'system', content: directives });
  }
}

/**
 * Expand the gateway's model REFS in place on a completion body:
 *
 *   • `project_evermind:<projectId>` → the project's CURRENT Evermind version
 *     (evermind/<ref>) at call time — the cloud/IDE replica pulling the latest learned
 *     model on each run (pull-on-boundary). The pin's callers are coding surfaces, so
 *     expansion applies the coding-quality gate; closed → plan default, not an error.
 *   • `tenant_model:<slug>` (migration 0211) → its configured base model + system
 *     directives + sampling params. The gateway-side half of the shared resolver, so the
 *     Designer Brain, on-prem hosts, and any external caller honour a tenant's named
 *     model the same way the cloud agent loop does.
 *   • a resolved `evermind/<ref>` base is OUR OWN model (served in-Worker from R2): it is
 *     hard-pinned so a hiccup never cascades a tenant's published Evermind out to an
 *     external frontier vendor.
 *   • `builderforce/workforce-<id>` → a user's PUBLISHED model: the agent's base model +
 *     persona/memory directives, grounded on the caller's latest user message. Unknown
 *     id → the ref is dropped so the plan default resolves rather than erroring.
 *
 * `getDb` is a thunk so a body with no ref never builds a database handle.
 */
export async function expandGatewayModelRefs(
  env: Env,
  getDb: () => DbHandle,
  tenantId: number,
  body: Record<string, unknown>,
): Promise<void> {
  if (typeof body.model === 'string' && body.model.startsWith(PROJECT_EVERMIND_MODEL_PREFIX)) {
    const expanded = await resolveProjectEvermindModelPin(env, getDb(), tenantId, body.model, { purpose: 'coding' });
    body.model = expanded.model; // undefined when unseeded / off / gate closed → plan default
  }
  if (typeof body.model === 'string' && body.model.startsWith(TENANT_MODEL_REF_PREFIX)) {
    const tm = await resolveTenantModel(env, getDb(), tenantId, body.model);
    // null base → let the plan default resolve; unknown ref → drop the bad id too.
    body.model = tm?.baseModel ?? undefined;
    if (tm?.directives) prependSystemDirectives(body.messages as ChatMessage[], tm.directives);
    if (tm) {
      if (typeof tm.params.temperature === 'number' && body.temperature == null) body.temperature = tm.params.temperature;
      if (typeof tm.params.top_p === 'number' && body.top_p == null) body.top_p = tm.params.top_p;
    }
  }

  if (typeof body.model === 'string' && body.model.startsWith('evermind/')) {
    body.modelStrict = true;
  }

  if (typeof body.model === 'string' && body.model.startsWith(WORKFORCE_MODEL_REF_PREFIX)) {
    // The caller's latest user message grounds the agent's recall (Phase C3), so a
    // stock OpenAI-SDK call to a workforce model id gets the agent's own docs too.
    const msgsForRecall = body.messages as ChatMessage[];
    // The request, never a loop's per-turn volatile tail (`<run-state>`) that rides after it.
    const latestUser = [...msgsForRecall].reverse().find((m) => m.role === 'user' && !isVolatileContent(m.content));
    const recallQuery = typeof latestUser?.content === 'string' ? latestUser.content : undefined;
    const wf = await resolveWorkforceModel(env, tenantId, body.model, recallQuery);
    body.model = wf?.baseModel ?? undefined;
    if (wf?.directives) prependSystemDirectives(body.messages as ChatMessage[], wf.directives);
  }
}

/**
 * Which BYO providers hit a usage/capacity cap this request — i.e. the tenant's key
 * was resolved and used, but the upstream rejected it with a billing limit (Anthropic
 * "reached your API usage limits", OpenAI "exceeded your quota", etc.). The
 * CAPACITY_LIMIT_MARKER is embedded in the attempt error by throwClassified4xx, so the
 * attempts are scanned for it, but only vendors the tenant is BYO-funding are flagged
 * (no point alarming about a cap on the operator's shared keys). Comma-joined provider
 * names for `x-builderforce-provider-cap`, or null.
 */
export function cappedByoProviders(
  attempts: readonly DispatchAttempt[] | undefined,
  byoVendors: ReadonlySet<string>,
): string | null {
  if (byoVendors.size === 0) return null; // tenant has no BYO keys — nothing to manage
  const cappedProviders = new Set<string>();
  // Map vendor id → the provider name the UI (and settings page) uses
  const vendorToProvider: Record<string, string> = {
    anthropic: 'anthropic', openai: 'openai', googleai: 'google', meta: 'meta',
  };
  for (const attempt of attempts ?? []) {
    if (attempt.error && attempt.error.includes(CAPACITY_LIMIT_MARKER) && byoVendors.has(attempt.vendor)) {
      cappedProviders.add(vendorToProvider[attempt.vendor] ?? attempt.vendor);
    }
  }
  return cappedProviders.size > 0 ? [...cappedProviders].join(',') : null;
}

/**
 * Frontier providers the same user connected in ANOTHER workspace — the
 * tenant-mismatch half of `x-builderforce-byo-unresolved`. Cached per user (~1 query
 * per 5 min) so it is never a per-request cost; advisory, so a failed read is `[]`.
 */
export function providersConnectedElsewhereCached(env: Env, userId: string, tenantId: number): Promise<LlmProvider[]> {
  return getOrSetCached(
    env,
    `byo-other-workspace:${userId}:${tenantId}`,
    () => providersConnectedInOtherWorkspaces(env, userId, tenantId, SUPPORTED_PROVIDERS),
    { kvTtlSeconds: 300, l1TtlMs: 60_000 },
  ).catch(() => [] as LlmProvider[]);
}

/**
 * Audit: when the caller identifies the Brain chat this completion is serving
 * (`metadata.chatId`), record an activity row naming WHICH MODEL served the DEFAULT
 * agent's turn — the gateway twin of the addressed-agent emit in
 * `BrainService.agentReply`, sharing its ONE metadata builder so the audit timeline's
 * model chip reads identical keys from either path. Turns without a chat id
 * (SDK/on-prem/cloud traffic) are not chat activity and emit nothing (null).
 * Best-effort by design — `llm_usage_log` stays the billing source of truth.
 */
export function recordGatewayChatModelActivity(
  env: Env,
  db: () => DbHandle,
  input: {
    tenantId: number;
    callerMetadata: Record<string, unknown> | null;
    resolvedModel: string;
    resolvedVendor: string;
    byoFunded: boolean;
    hasConnectedByo: boolean;
  },
): Promise<void> | null {
  const meta = input.callerMetadata;
  if (!meta || input.tenantId == null) return null;
  const rawChatId = meta.chatId ?? meta.brainChatId;
  const chatId = typeof rawChatId === 'number' ? rawChatId : typeof rawChatId === 'string' && /^\d+$/.test(rawChatId) ? Number(rawChatId) : null;
  if (chatId == null) return null;
  const agentRef = typeof meta.agentRef === 'string' && meta.agentRef ? meta.agentRef : 'brain-default';
  const agentName = typeof meta.agentName === 'string' && meta.agentName ? meta.agentName : 'Brain';
  const projectId = typeof meta.projectId === 'number' ? meta.projectId : null;
  return recordActivity(env, db(), {
    tenantId: input.tenantId,
    projectId,
    actor: cloudAgentActor(agentRef, agentName),
    verb: 'agent.replied',
    targetType: 'chat',
    targetId: chatId,
    summary: `${agentName} replied in chat #${chatId}${input.resolvedModel ? ` using ${input.resolvedModel}` : ''}`,
    metadata: buildModelActivityMetadata({
      via: 'gateway',
      model: input.resolvedModel,
      vendor: input.resolvedVendor,
      account: classifyReplyAccount(input.byoFunded, input.hasConnectedByo),
      byoFunded: input.byoFunded,
      // MODE (0409) — conversation vs execution. The caller stamps it on the
      // completion metadata; carrying it here is what lets the audit timeline (and
      // the mode rollup) tell a turn that ANSWERED from one that went and did the
      // work, instead of every agent turn reading identically.
      extra: { chatId, ...(typeof meta.mode === 'string' ? { mode: meta.mode } : {}) },
    }),
  });
}
