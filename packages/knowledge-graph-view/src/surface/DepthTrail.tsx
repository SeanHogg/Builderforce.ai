/**
 * The depth trail: system › module › class › method. Each earlier crumb climbs back to that
 * depth (0 is the system, the world map). The crumb you are on is not a control.
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import type { DepthLabels } from '../labels/surface.act';
import { cssVar } from '../scene/themeColors';
import { TYPE } from './ui/type';

/** A drill frame, as the trail reads it (package → module, class → class, function → method). */
export interface DepthFrame {
    level: 'package' | 'class' | 'function';
    name: string;
}

export type DepthLevel = 'system' | 'module' | 'class' | 'method';

export interface DepthCrumb {
    /** 0 is the system. 1 is the first drilled frame. */
    depth: number;
    level: DepthLevel;
    name: string;
}

const LEVEL_OF: Record<DepthFrame['level'], DepthLevel> = { package: 'module', class: 'class', function: 'method' };

/** The drill stack as crumbs, system first. An empty stack is just the system. */
export function depthCrumbs(stack: readonly DepthFrame[], systemName: string | null | undefined, labels: DepthLabels): DepthCrumb[] {
    const crumbs: DepthCrumb[] = [{ depth: 0, level: 'system', name: systemName?.trim() || labels.system }];
    stack.forEach((frame, i) => {
        crumbs.push({ depth: i + 1, level: LEVEL_OF[frame.level], name: frame.name });
    });
    return crumbs;
}

export interface DepthTrailProps {
    /** The drill stack, outermost first. Empty ⇒ the system map, and the trail is not drawn. */
    stack: readonly DepthFrame[];
    /** The system crumb. Absent ⇒ the "System" word. */
    systemName?: string | null | undefined;
    labels: KnowledgeGraphLabels;
    /** Climb back to a depth. 0 is the system. */
    onClimb(depth: number): void;
}

const crumbButton = {
    ...TYPE.meta,
    margin: 0,
    padding: '2px 8px',
    border: 0,
    borderRadius: 999,
    background: 'transparent',
    color: cssVar('accent'),
    cursor: 'pointer',
    font: 'inherit',
    fontWeight: 600,
} as const;

/** The breadcrumb of the drill path. Hidden until you have gone inside something. */
export function DepthTrail({ stack, systemName, labels, onClimb }: DepthTrailProps) {
    if (stack.length === 0) return null;
    const d = labels.surface.depth;
    const crumbs = depthCrumbs(stack, systemName, d);
    const last = crumbs.length - 1;
    return (
        <nav aria-label={d.aria} data-testid="kg-depth-trail">
            <ol style={{ listStyle: 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, margin: 0, padding: 0, minWidth: 0 }}>
                {crumbs.map((crumb, i) => {
                    const here = i === last;
                    const level = d[crumb.level];
                    return (
                        <li key={`${crumb.level}:${crumb.depth}`} style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                            {i > 0 && <span aria-hidden="true" style={{ ...TYPE.meta, color: cssVar('muted') }}>›</span>}
                            {here ? (
                                <span aria-current="location" title={level} style={{ ...TYPE.meta, fontWeight: 700, overflowWrap: 'anywhere' }}>{crumb.name}</span>
                            ) : (
                                <button
                                    type="button"
                                    title={level}
                                    aria-label={fillTemplate(d.climb, { name: crumb.name })}
                                    style={crumbButton}
                                    onClick={() => onClimb(crumb.depth)}
                                >{crumb.name}</button>
                            )}
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}
