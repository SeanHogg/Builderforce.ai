/**
 * Persona → lens mapping — the LATERAL "lens persona" dimension of the 2D RBAC.
 *
 * The four-tier access level (viewer < developer < manager < owner) is the HARD
 * gate: it decides what a user may DO. The persona is orthogonal — it decides what
 * a user WANTS TO SEE FIRST, by mapping the organizational role the person plays
 * (CEO / CFO / CTO / CISO / PMO / EM / IC) to the set of insight lenses that role
 * lives in. It is a VIEW-shaping input only: it reorders / highlights lenses, it
 * NEVER expands access. Access remains role-gated by requireRole on every
 * /api/insights/* route — a viewer with a 'ceo' persona still can't read the
 * manager lenses.
 *
 * Pure + DB-free so it is unit-testable and can be shared by the API (default
 * lens set for a persona) and mirrored on the client (lib/lensPersona.ts).
 */

/** The seven lateral personas. 'ic' (individual contributor) is the default. */
export const PERSONAS = ['ceo', 'cfo', 'cto', 'ciso', 'pmo', 'em', 'ic'] as const;
export type Persona = (typeof PERSONAS)[number];

/** The canonical insight lens keys a persona can be routed to. These mirror the
 *  /api/insights/* route names and the frontend /insights/<lens> pages. */
export const LENSES = [
  'engineering', 'dora', 'finance', 'allocation', 'compliance', 'portfolio', 'delivery',
] as const;
export type Lens = (typeof LENSES)[number];

/** Type guard for an untrusted persona string (route input validation). */
export function isPersona(x: unknown): x is Persona {
  return typeof x === 'string' && (PERSONAS as readonly string[]).includes(x);
}

/**
 * Persona → ordered highlighted lens set. The FIRST entry is the persona's home
 * lens (where its dashboard lands); the rest are the lenses it also cares about,
 * in priority order. Every lens here still enforces its own role gate downstream.
 */
export const PERSONA_LENSES: Record<Persona, Lens[]> = {
  // Chief Executive — portfolio-level delivery + engineering health + investment mix.
  ceo:  ['portfolio', 'engineering', 'allocation', 'delivery'],
  // Chief Financial — cost / budgets first, then how effort is capitalized.
  cfo:  ['finance', 'allocation', 'portfolio'],
  // Chief Technical — engineering effectiveness + the four keys + delivery flow.
  cto:  ['engineering', 'dora', 'delivery', 'allocation'],
  // Chief Information Security — audit / evidence.
  ciso: ['compliance', 'engineering'],
  // PMO — portfolio rollup, investment allocation, delivery forecasting.
  pmo:  ['portfolio', 'allocation', 'delivery'],
  // Engineering Manager — team delivery + DORA + where the team invests time.
  em:   ['delivery', 'dora', 'allocation', 'engineering'],
  // Individual Contributor — personal delivery + the four keys.
  ic:   ['delivery', 'dora'],
};

/** The default (home) lens for a persona — the first highlighted lens. */
export function homeLensFor(persona: Persona): Lens {
  return (PERSONA_LENSES[persona] ?? PERSONA_LENSES.ic)[0]!;
}

/** Ordered highlighted lens set for a persona (defensive copy). */
export function lensesFor(persona: Persona): Lens[] {
  return [...(PERSONA_LENSES[persona] ?? PERSONA_LENSES.ic)];
}

/** True when `lens` is highlighted for `persona` (drives the UI emphasis). */
export function isHighlighted(persona: Persona, lens: Lens): boolean {
  return (PERSONA_LENSES[persona] ?? []).includes(lens);
}
