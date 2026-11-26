/**
 * The header's "Copy diagnostics": reachable in EVERY status (loading, idle, empty, error, load-failed, not-here, ready),
 * because the drawer that holds the Diagnostics only exists once a graph is drawn. `text` is taken fresh when pressed
 * (async: the host's trace is read then), so the copy carries the First-load timeline, its decisions and the host log.
 */

import { useState } from 'react';
import { CopiedNote, CopyFallback, useCopyText } from '../copyText';
import type { KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import { ghostButtonStyle } from './ui';
import { questionGlyph } from './ui/glyphs';

export function DiagnosticsButton({ labels, text }: { labels: KnowledgeGraphLabels; text: () => string | Promise<string> }) {
    const copier = useCopyText();
    const [taken, setTaken] = useState('');
    const press = async (): Promise<void> => {
        const t = await text();
        setTaken(t);
        await copier.copy(t);
    };
    return (
        <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <button
                type="button" data-testid="kg-diagnostics-button" aria-label={labels.copyDiagnostics} title={labels.copyDiagnostics}
                onClick={() => void press()} style={ghostButtonStyle(false, true)}
            >{questionGlyph('more')}</button>
            <CopiedNote status={copier.status} labels={labels} />
            {copier.status === 'failed' && (
                <span style={{ position: 'absolute', top: '100%', right: 0, zIndex: 5, width: 'min(360px, 90vw)', padding: 8, background: cssVar('panel'), border: `1px solid ${cssVar('border')}`, borderRadius: 8 }}>
                    <CopyFallback status={copier.status} text={taken} label={labels.copyDiagnostics} labels={labels} />
                </span>
            )}
        </span>
    );
}
