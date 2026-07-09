'use client';

/**
 * EvermindValidationContext — shares the live "Validate" recall result between the
 * two halves of the LLM Studio that live in separate subtrees: the teach console in
 * the left rail (which runs the validate) and the Knowledge Map + Learnings in the
 * center stage (which highlight the matched memories). Lifting it here keeps a single
 * source of truth for the highlight instead of prop-drilling a result through both.
 *
 * The accessor is null-safe: {@link ProjectEvermindPanel} renders on surfaces that
 * have no studio center (e.g. the IDE agent stack), so without a provider the hook
 * returns an inert value and the console simply shows its own inline result.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ProjectEvermindValidateResult } from '@/lib/projectEvermindApi';

interface EvermindValidationValue {
  /** The current validate result, or null when nothing is being previewed. */
  highlight: ProjectEvermindValidateResult | null;
  /** Ids of the matched memories (derived once) — the surfaces highlight these. */
  matchIds: Set<number>;
  /** Id of the top match (the memory most likely used to respond), or null. */
  primaryId: number | null;
  setHighlight: (result: ProjectEvermindValidateResult | null) => void;
}

const NOOP: EvermindValidationValue = {
  highlight: null,
  matchIds: new Set(),
  primaryId: null,
  setHighlight: () => {},
};

const Ctx = createContext<EvermindValidationValue | null>(null);

export function EvermindValidationProvider({ children }: { children: ReactNode }) {
  const [highlight, setHighlight] = useState<ProjectEvermindValidateResult | null>(null);
  const value = useMemo<EvermindValidationValue>(() => ({
    highlight,
    matchIds: new Set((highlight?.matches ?? []).map((m) => m.id)),
    primaryId: highlight?.primaryId ?? null,
    setHighlight,
  }), [highlight]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Access the shared validate highlight. Inert (no-op) when no provider is mounted. */
export function useEvermindValidation(): EvermindValidationValue {
  return useContext(Ctx) ?? NOOP;
}
