/**
 * What a camera shows while its layout is still being computed on idle: a quiet, localized status line, never a blank canvas.
 * `corner` is the same words over a picture that keeps drawing while a newer layout of it is on its way (a resize).
 */

import type { KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import { TYPE } from './ui/type';

export function LayingOut({ labels, corner = false }: { labels: KnowledgeGraphLabels; corner?: boolean }) {
    const at = corner
        ? { insetBlockStart: 4, insetInlineEnd: 8, padding: '2px 8px', borderRadius: 6, background: cssVar('panel'), pointerEvents: 'none' as const }
        : { insetBlockStart: '50%', insetInlineStart: 0, insetInlineEnd: 0, textAlign: 'center' as const };
    return (
        <p
            role="status" data-testid={corner ? 'kg-relaying-out' : 'kg-laying-out'}
            style={{ position: 'absolute', margin: 0, ...at, color: cssVar('muted'), ...TYPE.meta }}
        >
            {labels.surface.scene.layingOut}
        </p>
    );
}
