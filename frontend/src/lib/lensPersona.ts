/**
 * Lens persona (client mirror of api/src/application/rbac/personaLens.ts).
 *
 * The persona is the LATERAL dimension of the 2D RBAC: it does NOT gate access
 * (every lens stays role-gated via <RoleGate> / requireRole) — it reorders and
 * HIGHLIGHTS the lenses that the organizational role a user plays cares about.
 * This module is the single client source for that mapping + the lens → route
 * table, consumed by {@link useLensPersona}, the persona chip, and the selector.
 */

import type { Capability } from '@/lib/rbac';

export const PERSONAS = ['ceo', 'cfo', 'cto', 'ciso', 'pmo', 'em', 'ic'] as const;
export type Persona = (typeof PERSONAS)[number];

export const LENSES = [
  'engineering', 'dora', 'finance', 'allocation', 'compliance', 'portfolio', 'delivery',
] as const;
export type Lens = (typeof LENSES)[number];

/** Persona → ordered highlighted lens set (first = home lens). Mirrors the API. */
export const PERSONA_LENSES: Record<Persona, Lens[]> = {
  ceo:  ['portfolio', 'engineering', 'allocation', 'delivery'],
  cfo:  ['finance', 'allocation', 'portfolio'],
  cto:  ['engineering', 'dora', 'delivery', 'allocation'],
  ciso: ['compliance', 'engineering'],
  pmo:  ['portfolio', 'allocation', 'delivery'],
  em:   ['delivery', 'dora', 'allocation', 'engineering'],
  ic:   ['delivery', 'dora'],
};

/** Each lens's destination route + the capability that gates it (for the honest
 *  "Requires <Role>" UX — the persona highlights, RBAC still governs access). */
export const LENS_ROUTES: Record<Lens, { href: string; capability: Capability }> = {
  engineering: { href: '/insights/engineering', capability: 'insights.engineering' },
  dora:        { href: '/insights/dora',        capability: 'insights.delivery' },
  finance:     { href: '/insights/finance',     capability: 'insights.finance' },
  allocation:  { href: '/insights/allocation',  capability: 'insights.allocation' },
  compliance:  { href: '/insights/compliance',  capability: 'insights.compliance' },
  portfolio:   { href: '/pmo',                  capability: 'insights.portfolio' },
  delivery:    { href: '/insights/delivery',    capability: 'insights.delivery' },
};

export function isPersona(x: unknown): x is Persona {
  return typeof x === 'string' && (PERSONAS as readonly string[]).includes(x);
}

export function lensesFor(persona: Persona): Lens[] {
  return [...(PERSONA_LENSES[persona] ?? PERSONA_LENSES.ic)];
}

export function homeLensFor(persona: Persona): Lens {
  return lensesFor(persona)[0]!;
}

export function isHighlighted(persona: Persona, lens: Lens): boolean {
  return (PERSONA_LENSES[persona] ?? []).includes(lens);
}
