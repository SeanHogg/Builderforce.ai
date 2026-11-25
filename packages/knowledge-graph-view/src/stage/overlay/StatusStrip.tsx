/**
 * The status strip along the bottom of the box while the code is open: the zoom level on show, whether the pane follows
 * the file or is pinned, and the line being read. Words come from `labels.surface.code`; colours are the accent tokens.
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { TYPE } from '../../surface/ui/type';
import { baseName } from '../drill/codeText';
import type { ZoomBand } from '../labels/lod';

export const STATUS_PX = 22;

export interface StatusStripProps {
    labels: KnowledgeGraphLabels;
    band: ZoomBand;
    follow: boolean;
    /** The file the pane reads. */
    path: string | null;
    /** The line being read; null before the pane reads. */
    line: number | null;
}

export function StatusStrip({ labels, band, follow, path, line }: StatusStripProps) {
    const t = labels.surface.code;
    const state = follow && path ? fillTemplate(t.following, { file: baseName(path) }) : t.pinnedStatus;
    return (
        <div
            role="status" data-status-strip
            style={{
                position: 'absolute', insetInline: 0, bottom: 0, height: STATUS_PX, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0 10px', background: cssVar('accent'), color: cssVar('onAccent'), ...TYPE.meta,
            }}
        >
            <span>{fillTemplate(t.status, { level: labels.surface.zoom[band], state })}</span>
            {line != null && <span>{fillTemplate(t.statusLine, { line })}</span>}
        </div>
    );
}
