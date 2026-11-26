/**
 * The map's bar while the code pane is open (PRD 43 B1a rule 9): the zoom path — the drill's levels (system › module ›
 * class, `depthCrumbs`), then the methods drilled into at the code level, then a callee opened in another file — with
 * Follow (the stage follows the code's reading line) and Out. Every earlier crumb goes back to it: a level climbs the
 * drill, a level's own crumb leaves the code level, a method goes back along the trail, and the crumb you are on is not
 * a control. Up, out and back across are all one click from here, Escape or Out.
 */

import type { CSSProperties } from 'react';
import type { KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { depthCrumbs, type DepthFrame } from '../../surface/DepthTrail';
import { TYPE } from '../../surface/ui/type';
import { toggleButton as toggle } from './cardStyles';

/** The bar's height: the stage below it is this much shorter. */
export const CODE_BAR_PX = 36;

const crumb: CSSProperties = { ...TYPE.meta, border: 0, padding: '3px 6px', borderRadius: 4, background: 'transparent', color: cssVar('text'), cursor: 'pointer', whiteSpace: 'nowrap', font: 'inherit' };

interface Crumb { key: string; name: string; go?: (() => void) | undefined }

export interface CodeTrailProps {
    /** The drill's levels, outermost first (`DrillModel.stack`). */
    stack: readonly DepthFrame[];
    /** Climb the drill back to a depth (0 is the system). */
    onClimb(depth: number): void;
    /** The methods drilled into at the code level, outermost first (`SemanticZoom.trail`). */
    methods: readonly { ref: string; name: string }[];
    /** Back along the trail to its `index`th method. */
    onMethod(index: number): void;
    /** Leave the code level altogether (the level's own crumb while a method is open). */
    onLeaveCode(): void;
    /** A callee opened in another file (the last crumb), when there is one. */
    across: string | null;
    follow: boolean;
    onFollow(): void;
    onOut?: (() => void) | undefined;
    labels: KnowledgeGraphLabels;
}

export function CodeTrail({ stack, onClimb, methods, onMethod, onLeaveCode, across, follow, onFollow, onOut, labels }: CodeTrailProps) {
    const t = labels.surface.code;
    const coding = methods.length > 0;
    const levels = depthCrumbs(stack, null, labels.surface.depth);
    const crumbs: Crumb[] = [
        ...levels.map((c, i): Crumb => ({ key: `level:${c.depth}`, name: c.name, go: i < levels.length - 1 ? () => onClimb(c.depth) : coding ? onLeaveCode : undefined })),
        ...methods.map((m, i): Crumb => ({ key: `method:${m.ref}`, name: m.name, go: i < methods.length - 1 || across ? () => onMethod(i) : undefined })),
        ...(across ? [{ key: `across:${across}`, name: `${across.slice(across.lastIndexOf('#') + 1)} ↗` }] : []),
    ];
    const last = crumbs.length - 1;
    return (
        <div data-code-trail style={{ height: CODE_BAR_PX, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px', borderBottom: `1px solid ${cssVar('border')}`, background: cssVar('bg') }}>
            <nav aria-label={t.trailAria} style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, overflow: 'hidden', flex: '1 1 auto' }}>
                {crumbs.map((c, i) => (
                    <span key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
                        {i > 0 && <span aria-hidden="true" style={{ ...TYPE.meta, color: cssVar('muted') }}>›</span>}
                        {c.go
                            ? <button type="button" data-trail-crumb={c.key} onClick={c.go} style={crumb}>{c.name}</button>
                            : <span data-trail-crumb={c.key} aria-current={i === last ? 'location' : undefined} style={{ ...crumb, cursor: 'default', fontWeight: 700 }}>{c.name}</span>}
                    </span>
                ))}
            </nav>
            <button type="button" data-action="follow" aria-pressed={follow} onClick={onFollow} style={{ ...toggle, borderColor: cssVar(follow ? 'accent' : 'border') }}>{t.follow}</button>
            {onOut && <button type="button" data-action="out" onClick={onOut} style={toggle}>{t.out}</button>}
        </div>
    );
}
