/**
 * The depth trail's model: system › module › class › method as crumbs (`depthCrumbs`). The header's spine carries the path now (the journey strip no longer
 * draws a second trail); the stage's code trail reads these crumbs.
 */

import type { DepthLabels } from '../labels/surface.act';

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
