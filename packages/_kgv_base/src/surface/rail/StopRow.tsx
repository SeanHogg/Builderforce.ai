/**
 * A stop row of the left rail: a dot filled with the colour channel (bordered in the line's colour), the
 * mono name, and the tag at the right (first finding, else coverage, else nothing).
 */

import type { KnowledgeGraphLabels } from '../../labels';
import { counted } from '../plural';
import { cssVar } from '../../scene/themeColors';
import { muted } from '../../styles';
import { lineTone, type OverlayModel } from '../overlays';
import type { Station } from '../stations';
import { TYPE } from '../ui/type';
import { clip, railRow } from './railRow';
import type { StopTag } from './stopTag';

export interface StopRowProps {
    station: Station;
    selected: boolean;
    overlay: OverlayModel;
    /** The line the rail is listing: the dot's border. */
    lineColourIndex: number;
    /** Lines that stop here, when more than one. */
    interchange: number;
    tag: StopTag | null;
    labels: KnowledgeGraphLabels;
    onSelect(id: string): void;
}

export function StopRow({ station: st, selected, overlay, lineColourIndex, interchange, tag, labels, onSelect }: StopRowProps) {
    return (
        <button type="button" aria-pressed={selected} data-station-row={st.id} title={st.path ?? st.name} onClick={() => onSelect(st.id)} style={{ ...railRow(selected, '26px'), borderRadius: 6 }}>
            <span
                aria-hidden="true" data-dot
                style={{ width: 9, height: 9, borderRadius: 999, flex: 'none', boxSizing: 'content-box', background: cssVar(overlay.style(st).tone), border: `2px solid ${cssVar(lineTone(lineColourIndex))}` }}
            />
            <span style={{ ...clip, flex: 1, ...TYPE.mono }}>
                {st.name}
                {interchange > 1 && <span style={{ ...muted, marginInlineStart: 6 }}>{counted(labels, 'interchange', interchange)}</span>}
            </span>
            {tag && <span data-tag={tag.kind} style={{ ...clip, maxWidth: '55%', ...TYPE.tag, fontWeight: 600, color: cssVar(tag.tone) }}>{tag.text}</span>}
        </button>
    );
}
