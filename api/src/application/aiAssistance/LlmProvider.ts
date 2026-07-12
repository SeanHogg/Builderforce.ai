/**
 * LlmProvider Integration (pluggable)
 *
 * This file provides an adapter that bridges the shapely `LlmProxyService.complete(body)`
 * surface to the `LlmProvider.complete(messages)` abstraction used in AiAssistanceService.
 * - Nullability-relaxed complete() in body.items (OpenAI docs allow items to be null).
 *
 * TODO: pendingTELEMETRYMUXEDMIGRATION:
 * - Load ./infrastructure/telemetry/telemetryLog.ts and wire this logger to the liveness telemetry infra.
 * - For now, a minimal Logger stub passes low-cardinality events; future work implements full batch ingestion.
 */

import type { LlmProvider } from './LlmProvider';
import type { Env } from '../../env';

const PASSTHROUGH_ENGINE = 'passThrough';
const QUEUE_LOG_KEY = '/internal/ai-suggestions/time-series';

/**
 * Minimal telemetry stub until full infra migration lands.
 */
type MinimalTelemetryLogger = {
  log: (key: string, payload: Record<string, unknown>) => void;
};

/**
 * Environment-aware logger backed by minimal telemetry (keys registered once)
 */
function mkLogger(env: Env): MinimalTelemetryLogger {
  return {
    log: (k, v) => {
      // STUB: for now, we ignore telemetry transport in this executor; future migration wires ts-logging.
      void k;
      void v;
    },
  };
}

/**
 * LlmProvider implemented as a thin wrapper over LlmProxyService.complete(body).
 * - We tolerate items in body.items (OpenAI spec allows null).
 */
export class LlmCompletionProvider implements LlmProvider {
  constructor(private readonly llmProxy: (body: { model: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; items?: any[] }) => Promise<any>) {}

  /**
   - Messages: plain text; LlmProxyService supports via string content.
   - Return type is unified as string; we assume completion is success—if expansion is needed, evolve the provider.
   */
  async complete(messages: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<string> {
    try {
      const completion = await this.llmProxy({
        model: PASSTHROUGH_ENGINE,
        messages,
        items: [], // minimal payload
      });
      return String(completion);
    } catch (err: unknown) {
      throw new Error(`LLM completion failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Factory to create LlmProvider from Env chain (dependency injection).
 */
export function mkLlmProviderFromEnv(env: Env): LlmProvider {
  // STUB: for now, we use a minimal passthrough for this executor; future evolution uses LlmProxyService.
  const logger = mkLogger(env);
  return new LlmCompletionProvider(async (body) => {
    try {
      // Temporarily cast for env-relaxed runtime until TS migration is staged.
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore: passthrough to LlmProxyService.complete(body)
      return (await import('../../infrastructure/llmProxyForEnv')).llmProxyForEnv(body) as any;
    } catch (err: unknown) {
      logger.log(QUEUE_LOG_KEY, {
        error: String(err),
        model: body.model,
        messagesCount: body.messages.length,
      });
      throw new Error(`passthrough failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

/**
 * Project Facts KV read/write helper (future evolvable to `projectEvermind.assoc`).
 * For now, a minimal stub following the key conventions used by prior passes.
 */
type ProjectFactsKV = {
  set: (env: Env, projectId: number, key: string, value: string) => Promise<void>;
  Json_get: (env: Env, projectId: number, key: string) => Promise<Record<string, unknown> | null>;
};

const KVSUFFIX_SHARED = '/shared';

/**
 * Minimal project_facts KV stub; will migrate to `projectEvermind.assoc`.
 * Project key format: `projectId_key` (e.g., `1/*`, `1/recType`, `1/field:priority`).
 */
export async function readProjectFacts(
  env: Env,
  projectId: number,
  key: string
): Promise<Record<string, unknown> | null> {
  // STUB: placeholder for model-level KV access; future upgrade wiring to `projectEvermind.assoc`.
  // Try to retrieve a JSON blob; if not, return null.
  try {
    // Temporarily pass env to stub; actual impl will use `env.projectEvermind.assoc`.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const kv = (await import('../../infrastructure/projectEvermind')).mkProjectEvermind(env);
    const raw = await kv.Json_get(projectId, key);
    if (raw === null) return null;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(`projectEvermind association value is not an object: ${key}`);
    }
    return raw;
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('not implemented')) {
      await mkProjectFactsKV(env).danglingRead(projectId, key, err);
    }
    return null;
  }
}

/**
 * In-memory cache for project_fact=enabledits during the warm bucket (FR-4.3).
 */
export interface EnablementCache {
  get: (projectId: number, key: string) => boolean | undefined;
  set: (projectId: number, key: string, value: boolean) => void;
  clear: () => void;
}

const warmCache: Map<string, boolean> = new Map();

export const EnablementCacheImpl: EnablementCache = {
  get: (projectId, key) => warmCache.get(GenerateEnablementKey(projectId, key)),
  set: (projectId, key, value) => warmCache.set(GenerateEnablementKey(projectId, key), value),
  clear: () => warmCache.clear(),
};

function GenerateEnablementKey(projectId: number, key: string): string {
  return `${projectId}:${key}`;
}

export function mkEnablementCache(): EnablementCache {
  return EnablementCacheImpl;
}

/**
 * Cache Insights helper (FR-4.4).
 * - Aggregates pendingFeedback directly in-memory and can surface counters (no DB or analytics dependent).
 * - Exported here for TVA cross-check readiness.
 */
export const CacheInsights = ((this: undefined) => {
  const pendingFeedback: Array<{
    tenantId: number;
    recordId: string;
    fieldPath: string;
    rating: string;
    timestamp: Date;
  }> = [];

  return {
    record: (args: {
      tenantId: number;
      recordId: string;
      fieldPath: string;
      rating: string;
      timestamp?: Date;
    }) => {
      pendingFeedback.push({
        tenantId: args.tenantId,
        recordId: args.recordId,
        fieldPath: args.fieldPath,
        rating: args.rating,
        timestamp: args.timestamp ?? new Date(),
      });
    },
    get: () => {
      const now = new Date();
      const oneDay = 24 * 60 * 60 * 1000;
      const recent = pendingFeedback.filter(f => (now.getTime() - f.timestamp.getTime()) / 1000 / 60 < 60 * 24);
      if (recent.length === 0) {
        return { aggregate: null, breakdown: [] };
      }
      const counts = recent.reduce((acc, f) => {
        if (!acc[f.rating]) acc[f.rating] = 0;
        acc[f.rating]++;
        return acc;
      }, Record<string, number> & { thumbs-up: number; thumbs-down: number } {
        thumbs-up: 0,
        thumbs-down: 0,
      } as Record<string, number> & { thumbs-up: number; thumbs-down: number } {});

      const total = recent.length;
      const thumbsUp = counts['thumbs-up'] ?? 0;
      const thumbsDown = counts['thumbs-down'] ?? 0;

      const breakdown = recent.reduce((acc, f) => {
        const key = `${f.fieldPath}:${f.rating}`;
        if (!acc[key]) acc[key] = 0;
        acc[key]++;
        return acc;
      }, Record<string, number>{});

      return {
        aggregate: {
          total,
          thumbsup: thumbsUp,
          thumbsdown: thumbsDown,
          acceptanceRate: (thumbsUp / total) * 100,
          rejectionRate: (thumbsDown / total) * 100,
        },
        breakdown: Object.entries(breakdown).map(([fieldRating, count]) => ({
          fieldRating,
          count,
          acceptanceRate: /thumbs-up/.test(fieldRating) ? (count / total) * 100 : (counts['thumbs-up'] ?? 0) / total * 100,
          rejectionRate: /thumbs-down/.test(fieldRating) ? (count / total) * 100 : (counts['thumbs-down'] ?? 0) / total * 100,
        })),
      };
    },
    getPendingCount: () => pendingFeedback.length,
    clear: () => {
      pendingFeedback.length = 0;
    },
    pendingFeedbackItems: pendingFeedback,
  };
}) as const;

/* -------------------------------------------------------------------------- */
/* LEGACY LAYER COMPATIBILITY NOTES (for this PR: FR-4.3)                      */
/* -------------------------------------------------------------------------- */
/*
- CacheInsights captures pendingFeedback in-memory for now; future PRs will flush to compliant analytics infra.
- LlmProvider.complete() is a shim around LlmProxyService.complete(body); future TS migration may merge body.items support.
- KV stub `readProjectFacts` is provisional; real migration will adopt `projectEvermind.assoc` through Env.
- EnablementCache is a warm bucket helper; no data being written to project_facts yet, pending KV migration.
*/