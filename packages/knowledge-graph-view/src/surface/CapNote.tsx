/**
 * "Showing 15,000 of 113,975 links": said whenever a camera's link budget leaves some out, so fewer lines are never a
 * silent change. The stage host reads the placement's `caption` (`edgeCaption` in the worker) and says it here.
 */

import type { ReactNode } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import { TYPE } from './ui/type';

export function CapNote({ testId, children }: { testId: string; children: ReactNode }) {
    return (
        <p data-testid={testId} style={{ position: 'absolute', insetInlineEnd: 56, bottom: 10, margin: 0, padding: '2px 8px', borderRadius: 6, ...TYPE.meta, background: cssVar('panel') }}>
            {children}
        </p>
    );
}

export interface LinkCaption { shown: number; total: number; capped: boolean }

/** `text` words the count when it is not of links (the Map counts stations). */
export function EdgesCapped({ caption, labels, text }: { caption: LinkCaption | null; labels: KnowledgeGraphLabels; text?: string | undefined }) {
    if (!caption?.capped) return null;
    return (
        <CapNote testId="kg-edges-capped">
            {fillTemplate(text ?? labels.surface.scene.edgesCapped, { shown: caption.shown.toLocaleString(), total: caption.total.toLocaleString() })}
        </CapNote>
    );
}
