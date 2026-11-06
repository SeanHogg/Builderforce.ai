/** The Before/After toggle inside the fix flow; the same revision state the header overflow menu sets. Absent when the host keeps no baseline. */

import type { KnowledgeGraphLabels } from '../../labels';
import type { Revision } from '../../revision';
import { Segmented } from '../ui';

export interface FixRevision { value: Revision; hasBefore: boolean; onChange(r: Revision): void }

export function FixBeforeAfter({ revision, labels }: { revision: FixRevision; labels: KnowledgeGraphLabels }) {
    const t = labels.surface.fix.beforeAfter;
    return (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Segmented
                label={t.group} value={revision.value} onChange={(id) => revision.onChange(id as Revision)}
                items={[{ id: 'before', label: labels.compareBefore, disabled: !revision.hasBefore, ...(revision.hasBefore ? {} : { title: t.noBaseline }) }, { id: 'after', label: labels.compareAfter }]}
            />
        </div>
    );
}
