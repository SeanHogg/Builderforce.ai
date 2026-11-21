/**
 * The depth trail above the path stops: system › module › class › method. Each crumb before the
 * current one is a button that climbs back to that depth (`onClimb(depth)`, 0 = the system); the
 * current crumb is plain text. Nothing is drawn while the drill stack is empty (the world map).
 */

import { cssVar } from '../scene/themeColors';
import { muted } from '../styles';
import type { DrillFrame } from './transit/drillView';

export interface DepthCrumb {
    /** Frames deep: 0 = the system, 1 = the first drilled level. */
    depth: number;
    name: string;
}

/** The crumbs for a drill stack: the system first, then one per frame. Empty stack ⇒ none. */
export function depthCrumbs(stack: readonly DrillFrame[], systemName: string): DepthCrumb[] {
    if (stack.length === 0) return [];
    return [{ depth: 0, name: systemName }, ...stack.map((f, i) => ({ depth: i + 1, name: f.name }))];
}

export interface DepthTrailProps {
    trail: readonly DrillFrame[];
    systemName: string;
    onClimb(depth: number): void;
}

export function DepthTrail({ trail, systemName, onClimb }: DepthTrailProps) {
    const crumbs = depthCrumbs(trail, systemName);
    if (crumbs.length === 0) return null;
    const current = crumbs.length - 1;
    return (
        <nav aria-label="Depth" data-testid="kg-depth-trail" style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', minWidth: 0 }}>
            {crumbs.map((c, i) => (
                <span key={c.depth} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {i > 0 && <span aria-hidden="true" style={muted}>›</span>}
                    {i === current
                        ? <span aria-current="location" style={{ fontWeight: 600 }}>{c.name}</span>
                        : (
                            <button
                                type="button" data-depth={c.depth} onClick={() => onClimb(c.depth)}
                                style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: cssVar('muted'), font: 'inherit', textDecoration: 'underline' }}
                            >{c.name}</button>
                        )}
                </span>
            ))}
        </nav>
    );
}
