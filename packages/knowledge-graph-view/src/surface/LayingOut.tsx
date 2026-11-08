/** What a camera shows while its layout is still being computed on idle: a quiet, localized status line, never a blank canvas. */

import type { KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import { TYPE } from './ui/type';

export function LayingOut({ labels }: { labels: KnowledgeGraphLabels }) {
    return (
        <p
            role="status" data-testid="kg-laying-out"
            style={{ position: 'absolute', insetBlockStart: '50%', insetInlineStart: 0, insetInlineEnd: 0, margin: 0, textAlign: 'center', color: cssVar('muted'), ...TYPE.meta }}
        >
            {labels.surface.scene.layingOut}
        </p>
    );
}
