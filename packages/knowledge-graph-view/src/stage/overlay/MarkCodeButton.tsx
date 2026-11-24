/**
 * The Code button on a selected file or symbol mark (a `node:` slot). Station cards carry their own Code button;
 * this one gives every other mark the same way into the docked code panel. It rides the mark's SLOT with
 * `useSlotAnchor` (as `StageCard` does) and hides when the slot leaves the stage.
 */

import { useRef } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cardAction } from '../../surface/transit/StationCard';
import { cssVar } from '../../scene/themeColors';
import { useSlotAnchor } from '../anchor/useSlotAnchor';

export interface MarkCodeButtonProps {
    /** The selected mark's slot key; null = no button. */
    slotKey: string | null;
    /** The mark's name, for the accessible name. */
    name: string;
    labels: KnowledgeGraphLabels;
    onCode(): void;
}

export function MarkCodeButton({ slotKey, name, labels, onCode }: MarkCodeButtonProps) {
    const ref = useRef<HTMLButtonElement | null>(null);
    const { missing } = useSlotAnchor(slotKey, ref);
    if (!slotKey) return null;
    // Hidden, not unmounted, while the slot is off the stage: the anchor writes its position only on frames and settles,
    // so a remounted button would sit at the corner until the next camera frame.
    return (
        <button
            ref={ref} type="button" data-action="mark-code" hidden={missing} aria-label={fillTemplate(labels.surface.code.buttonAria, { name })}
            style={{ ...cardAction, position: 'absolute', left: 0, top: 0, zIndex: 2, background: cssVar('panel') }} onClick={onCode}
        >
            {labels.surface.code.button}
        </button>
    );
}
