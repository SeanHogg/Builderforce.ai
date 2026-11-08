/** "Copy diagnostics": the text of the view's ONE diagnostics (`graphDiagnostics.ts`, taken fresh when pressed) to the clipboard, with its "Copied" note and the select-by-hand fallback. */

import { CopiedNote, CopyFallback, useCopyText } from '../../copyText';
import type { KnowledgeGraphLabels } from '../../labels';
import { button } from '../../styles';

export function CopyDiagnostics({ labels, text }: { labels: KnowledgeGraphLabels; text: (() => string) | undefined }) {
    const copier = useCopyText();
    if (!text) return null;
    return (
        <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <button type="button" style={button} onClick={() => void copier.copy(text())}>{labels.copyDiagnostics}</button>
                <CopiedNote status={copier.status} labels={labels} />
            </span>
            <CopyFallback status={copier.status} text={copier.status === 'failed' ? text() : ''} label={labels.copyDiagnostics} labels={labels} />
        </span>
    );
}
