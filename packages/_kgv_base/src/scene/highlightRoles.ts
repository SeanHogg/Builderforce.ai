/**
 * Paints an anti-pattern highlight onto the Tower's bodies: an offender takes the violation tone, a
 * partner the partner tone, and every other tower is dimmed. The scene's own bodies, one pass; no
 * second scene. Pure, so it is tested without WebGL.
 */

import type { Body } from './channels';

export type TowerRole = 'offender' | 'partner';

export const ROLE_TONE = { offender: 'violation', partner: 'partner' } as const;

/** `bodies` unchanged when nothing is highlighted. */
export function applyRoles(bodies: readonly Body[], roles: ReadonlyMap<string, TowerRole> | undefined): readonly Body[] {
    if (!roles || roles.size === 0) return bodies;
    return bodies.map((b) => {
        const role = roles.get(b.ref);
        return role ? { ...b, tone: ROLE_TONE[role], dim: false } : { ...b, dim: true };
    });
}
