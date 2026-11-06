/**
 * The Sync drawer's footer: the view's own diagnostics text in a `<pre>` (the same text
 * *Copy diagnostics* copies), the copy button, and *Resend skipped files*. Resend starts the
 * view's ONE review flow again for this root, so the confirm chip still asks first; a host
 * that cannot review shows "Not available here".
 */

import { CopiedNote, CopyFallback, useCopyText } from '../../copyText';
import type { KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { MONO, button, muted } from '../../styles';
import { Section, Unavailable } from './ui';

export function SyncDiagnostics({ text, labels, skippedCount, onResend }: {
    text: string | undefined;
    labels: KnowledgeGraphLabels;
    skippedCount: number;
    onResend?: (() => void) | undefined;
}) {
    const t = labels.surface.sync;
    const copier = useCopyText();
    return (
        <Section title={t.diagnosticsTitle}>
            {text !== undefined && (
                <pre
                    data-testid="kg-sync-diagnostics"
                    style={{ margin: 0, padding: 10, borderRadius: 8, border: `1px solid ${cssVar('border')}`, background: cssVar('bg'), color: cssVar('text'), fontFamily: MONO, fontSize: 11, lineHeight: '16px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                >
                    {text}
                </pre>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {text !== undefined && <button type="button" style={button} onClick={() => void copier.copy(text)}>{labels.copyDiagnostics}</button>}
                {skippedCount > 0 && (onResend
                    ? <button type="button" data-testid="kg-sync-resend" style={button} onClick={onResend}>{t.resend}</button>
                    : <Unavailable labels={labels} label={t.resend} testId="kg-sync-resend-unavailable" />)}
                <CopiedNote status={copier.status} labels={labels} />
            </div>
            {skippedCount > 0 && onResend && <p style={{ ...muted, margin: 0 }}>{t.resendNote}</p>}
            {text !== undefined && <CopyFallback status={copier.status} text={text} label={labels.copyDiagnostics} labels={labels} />}
        </Section>
    );
}
