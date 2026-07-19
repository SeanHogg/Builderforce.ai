'use client';

/**
 * useLensPersona — the client hook that resolves the signed-in user's primary
 * lens persona and exposes the view-shaping helpers (which lenses to highlight /
 * order). It loads /api/member-personas once, caches it, and degrades gracefully
 * to the 'ic' default so the UI never blocks on it.
 *
 * The persona is presentation emphasis ONLY. Every lens route/panel is still
 * gated by its capability via <RoleGate> — this hook decides ORDER + HIGHLIGHT,
 * never access.
 */

import { useEffect, useState } from 'react';
import {
  PERSONA_LENSES, lensesFor, homeLensFor, isHighlighted,
  type Persona, type Lens,
} from './lensPersona';
import { memberPersonasApi } from './personaCadenceApi';

export interface LensPersonaState {
  /** Loaded primary persona (defaults to 'ic' until resolved). */
  persona: Persona;
  /** The persona's ordered highlighted lens set. */
  lenses: Lens[];
  /** The persona's home (landing) lens. */
  homeLens: Lens;
  loading: boolean;
  /** True once a real persona has been loaded from the server (not the default). */
  loaded: boolean;
  /** Is this lens highlighted for the current persona? */
  highlights: (lens: Lens) => boolean;
  /** Sort comparator that pulls highlighted lenses to the front (stable otherwise). */
  order: (a: Lens, b: Lens) => number;
}

// Module-level cache so multiple mounts share one fetch per session.
let cached: Persona | null = null;
let inFlight: Promise<Persona> | null = null;

async function loadPersona(): Promise<Persona> {
  if (cached) return cached;
  if (!inFlight) {
    inFlight = memberPersonasApi.get()
      .then((r) => { cached = r.primary ?? 'ic'; return cached; })
      .catch(() => { cached = 'ic'; return cached; })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

export function useLensPersona(): LensPersonaState {
  const [persona, setPersona] = useState<Persona>(cached ?? 'ic');
  const [loading, setLoading] = useState(!cached);
  const [loaded, setLoaded] = useState(!!cached);

  useEffect(() => {
    let alive = true;
    if (cached) { setPersona(cached); setLoading(false); setLoaded(true); return; }
    void loadPersona().then((p) => {
      if (!alive) return;
      setPersona(p); setLoading(false); setLoaded(true);
    });
    return () => { alive = false; };
  }, []);

  const highlighted = PERSONA_LENSES[persona] ?? [];
  const rank = (l: Lens) => {
    const i = highlighted.indexOf(l);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };

  return {
    persona,
    lenses: lensesFor(persona),
    homeLens: homeLensFor(persona),
    loading,
    loaded,
    highlights: (lens) => isHighlighted(persona, lens),
    order: (a, b) => rank(a) - rank(b),
  };
}
