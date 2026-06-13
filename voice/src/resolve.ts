/**
 * resolve — the one seam every studio LLM flow routes text→speech through.
 *
 * `resolveNarrationEngine` takes a `voiceId` and a set of candidate providers,
 * picks the best AVAILABLE clone backend (on-device first — free + private —
 * then the metered server), and returns a ready engine. When no clone backend
 * can run it returns a fallback engine flagged `cloned: false` carrying the
 * reason, so callers badge "Cloning unavailable — using <voice>" and never swap
 * silently (PRD §7). `getEngineUnavailableReason` is the shared source of truth
 * for that message — the picker, the dubbing panel header, and the pitch button
 * all read it instead of each recomputing "can I clone right now."
 */

import type {
  NarrationEngine,
  NarrationEngineId,
  NarrationProvider,
  NarrationResult,
  SynthesizeRequest,
} from './types';

export interface ResolveNarrationOptions {
  /** The `studio_voice_clones.id` to speak in. */
  voiceId: string;
  /** Candidate clone backends (e.g. [clientProvider, serverProvider]). Ranked
   *  internally — on-device before server — so callers pass them in any order. */
  providers: NarrationProvider[];
  /** Named non-cloned voice used when no clone backend is available. */
  fallback?: NarrationProvider;
  /** When false, skip cloning entirely and go straight to the fallback voice
   *  (e.g. a free-tier user). Default true. */
  preferClone?: boolean;
}

/** Preference: on-device clone (0) → server clone (1) → anything else (2). */
function rank(provider: NarrationProvider): number {
  if (provider.id === 'clone-client') return 0;
  if (provider.id === 'clone-server') return 1;
  return 2;
}

/**
 * The shared "can I clone right now?" check. Returns null when at least one clone
 * provider is available, otherwise the aggregated reason string. This is the
 * single source of truth the UI reads — do not re-derive availability elsewhere.
 */
export async function getEngineUnavailableReason(
  providers: NarrationProvider[],
): Promise<string | null> {
  const clone = providers.filter((p) => p.id === 'clone-client' || p.id === 'clone-server');
  if (clone.length === 0) return 'No clone provider configured.';

  const reasons: string[] = [];
  for (const p of clone) {
    if (await p.isAvailable()) return null;
    reasons.push(`${p.id}: ${(await p.unavailableReason()) ?? 'unavailable'}`);
  }
  return `Cloning unavailable — ${reasons.join('; ')}`;
}

/** Resolve a ready-to-use narration engine for `voiceId`. Always returns an
 *  engine (never throws here); failures surface at `synthesize` time or via
 *  `fallbackReason`, so the caller can render an honest UI state up front. */
export async function resolveNarrationEngine(
  options: ResolveNarrationOptions,
): Promise<NarrationEngine> {
  const { voiceId, fallback } = options;
  const preferClone = options.preferClone ?? true;

  if (preferClone) {
    const ordered = [...options.providers].sort((a, b) => rank(a) - rank(b));
    for (const provider of ordered) {
      if (await provider.isAvailable()) {
        return wrap(provider, { voiceId, cloned: true, fallbackReason: null });
      }
    }
  }

  // No clone backend (or preferClone=false) — fall back honestly.
  const reason = preferClone
    ? await getEngineUnavailableReason(options.providers)
    : 'Cloning skipped for this voice.';

  if (fallback && (await fallback.isAvailable())) {
    return wrap(fallback, { voiceId, cloned: false, fallbackReason: reason });
  }

  // Nothing can produce audio — return an engine that fails loudly with the
  // reason already exposed on `fallbackReason` for a pre-synthesis UI check.
  const fallbackReason =
    reason ?? (await fallback?.unavailableReason()) ?? 'No narration engine available.';
  return {
    engineId: 'fallback',
    cloned: false,
    fallbackReason,
    voiceId,
    synthesize: async (): Promise<NarrationResult> => {
      throw new Error(fallbackReason);
    },
  };
}

function wrap(
  provider: NarrationProvider,
  meta: { voiceId: string; cloned: boolean; fallbackReason: string | null },
): NarrationEngine {
  return {
    engineId: provider.id as NarrationEngineId,
    cloned: meta.cloned,
    fallbackReason: meta.fallbackReason,
    voiceId: meta.voiceId,
    synthesize: (req: SynthesizeRequest) => provider.synthesize(req),
  };
}
