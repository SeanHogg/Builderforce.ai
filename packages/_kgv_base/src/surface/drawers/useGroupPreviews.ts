/** The host's real preview for each group whose kind has a codemod: the files and lines of its first findings, read through the same `previewFix` port the Resolve flow uses. */

import { useEffect, useState } from 'react';
import type { FixPreview } from '../../fixPorts';
import type { KnowledgeGraphSource } from '../../types';
import { canApplyKind } from '../codemods';
import type { AntiPatternGroup } from './antiPatternGroups';

/** Findings of a group previewed, at most (the preview is a sample of a group, not every link). */
export const PREVIEW_SAMPLE = 3;

/** group id → the host's preview; a missing id is not (yet) known or has none. */
export function useGroupPreviews(groups: readonly AntiPatternGroup[], source: KnowledgeGraphSource | undefined): Readonly<Record<string, FixPreview>> {
    const [previews, setPreviews] = useState<Readonly<Record<string, FixPreview>>>({});
    useEffect(() => {
        let live = true;
        const read = source?.previewFix;
        if (!read) return undefined;
        for (const g of groups) {
            if (!canApplyKind(source, g.kind)) continue;
            Promise.all(g.findings.slice(0, PREVIEW_SAMPLE).map((f) => read.call(source, f).catch(() => null)))
                .then((rs) => {
                    const files = rs.flatMap((r) => r?.files ?? []);
                    if (live && files.length > 0) setPreviews((p) => ({ ...p, [g.id]: { files } }));
                }, () => undefined);
        }
        return () => { live = false; };
    }, [groups, source]);
    return previews;
}
