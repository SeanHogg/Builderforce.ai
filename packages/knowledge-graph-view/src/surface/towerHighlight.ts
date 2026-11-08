/**
 * Which files an anti-pattern lights in the Tower, and in what role: the OFFENDERS (the file that
 * breaks the rule: a layer violation's first node, a god module's file) and their PARTNERS (what an
 * offender reaches into). Every other tower is dimmed. Pure; `scene/highlightRoles.ts` paints it.
 */

import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import type { TowerRole } from '../scene/highlightRoles';
import { ruleOf } from './drawers/antiPatternRules';
import { stationOfRef, type StationModel } from './stations';

export type { TowerRole };

export interface TowerHighlight {
    /** The finding kinds lit (the legend reads their "good looks like"). */
    kinds: readonly string[];
    roles: ReadonlyMap<string, TowerRole>;
}

/** The SVG Tower draws stations, not files: a station takes its strongest role (an offender over a partner). */
export function stationRolesOf(roles: ReadonlyMap<string, TowerRole>, model: Pick<StationModel, 'stationOf'>): Map<string, TowerRole> {
    const out = new Map<string, TowerRole>();
    for (const [ref, role] of roles) {
        const id = stationOfRef(model, ref);
        if (id !== undefined && out.get(id) !== 'offender') out.set(id, role);
    }
    return out;
}

/** Where Show in Tower goes: the WebGL 3D view when there is one, else the SVG Tower; null when neither camera exists. */
export function towerCameraOf(cameras: readonly string[] | undefined): '3d' | 'tower' | null {
    return cameras?.includes('3d') ? '3d' : cameras?.includes('tower') ? 'tower' : null;
}

/** One file lit as the offender of a kind, with no finding behind it (a god module read from its badge on a graph reviewed before the finding existed). */
export const highlightForRef = (ref: string, kind: string): TowerHighlight => ({ kinds: [kind], roles: new Map<string, TowerRole>([[ref, 'offender']]) });

export function highlightFor(findings: readonly Finding[]): TowerHighlight {
    const roles = new Map<string, TowerRole>();
    const kinds = new Set<string>();
    for (const f of findings) {
        kinds.add(f.kind);
        const reaches = ruleOf(f.kind).diagram === 'layerArrow';
        f.nodes.forEach((ref, i) => {
            if (!reaches || i === 0) roles.set(ref, 'offender');
            else if (roles.get(ref) !== 'offender') roles.set(ref, 'partner');
        });
    }
    return { kinds: [...kinds], roles };
}
