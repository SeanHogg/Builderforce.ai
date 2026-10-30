/**
 * The view's ONE "copy this text" behaviour (Copy as Mermaid, Copy details): write to the
 * clipboard, say "Copied", and when the clipboard refuses show the same text in a read-only
 * box to select by hand.
 */

import { useState } from 'react';
import type { KnowledgeGraphLabels } from './labels';
import { muted } from './styles';

export type CopyStatus = 'idle' | 'copied' | 'failed';

export function useCopyText(): { status: CopyStatus; copy(text: string): Promise<void> } {
    const [status, setStatus] = useState<CopyStatus>('idle');
    const copy = async (text: string): Promise<void> => {
        try {
            await navigator.clipboard.writeText(text);
            setStatus('copied');
        } catch {
            setStatus('failed');
        }
    };
    return { status, copy };
}

/** "Copied" beside the button. */
export function CopiedNote({ status, labels }: { status: CopyStatus; labels: KnowledgeGraphLabels }) {
    return status === 'copied' ? <span role="status" style={muted}>{labels.copied}</span> : null;
}

/** The clipboard refused: the text itself, selectable. `label` names the box for assistive tech. */
export function CopyFallback({ status, text, label, labels }: { status: CopyStatus; text: string; label: string; labels: KnowledgeGraphLabels }) {
    if (status !== 'failed') return null;
    return (
        <>
            <p role="status" style={muted}>{labels.copyFailed}</p>
            <textarea readOnly value={text} aria-label={label} rows={6} style={{ width: '100%', font: '12px monospace' }} />
        </>
    );
}
