/**
 * The Reviews panel's Server tab: how many files are here and on the server (two bars), the files not stored (of which too large, and missing on the server) with
 * a link to what is left out, the upload queue (waiting: Upload now; failed: red, with the replica detail, Retry and Diagnose) and the Before / After revision the map
 * shows. Every number is the host's sync status, read once by the root. Retry and Upload now are the source's one `retrySync` port, read from context: no port, no button.
 */

import { useState } from 'react';
import { cssVar } from '../../scene/themeColors';
import type { KnowledgeGraphLabels } from '../../labels';
import { fillTemplate } from '../../labels';
import { SkippedItems } from '../../SkippedList';
import { button } from '../../styles';
import type { SyncStatus } from '../../types';
import { FixBeforeAfter, type FixRevision } from '../fix/FixBeforeAfter';
import { splitSkipped } from '../drawers/syncDeltaModel';
import { syncGap } from '../drawers/syncModel';
import { SyncReplica } from '../drawers/SyncReplica';
import { Bar, Section } from '../drawers/ui';
import { counted } from '../plural';
import { parityText } from '../syncPill';
import { TYPE } from '../ui/type';
import { ServerMore, type ServerMoreProps } from './ServerMore';
import { useRetryUpload } from './useRetryUpload';

export interface ServerTabProps {
    labels: KnowledgeGraphLabels;
    sync: SyncStatus | null | undefined;
    revision?: FixRevision | undefined;
    /** What the old Sync drawer's lower sections read (sources, excluded folders, commits, resend); absent ⇒ they are not drawn. */
    more?: Omit<ServerMoreProps, 'labels' | 'sync'> | undefined;
    /** Opens the Diagnostics tab (offered only when an upload failed). */
    onDiagnose(): void;
}

function Count({ label, n, max }: { label: string; n: number; max: number }) {
    return (
        <li style={{ display: 'grid', gap: 2 }}>
            <span style={{ display: 'flex', gap: 8 }}><span style={{ ...TYPE.body, flex: 1 }}>{label}</span><span style={TYPE.monoValue}>{n.toLocaleString()}</span></span>
            <Bar frac={max > 0 ? n / max : 0} label={label} />
        </li>
    );
}

const hint = (text: string) => <p style={{ ...TYPE.caption, margin: 0 }}>{text}</p>;

export function ServerTab({ labels, sync, revision, more, onDiagnose }: ServerTabProps) {
    const r = labels.surface.run.review;
    const retry = useRetryUpload();
    const [showLeftOut, setShowLeftOut] = useState(false);
    const gap = syncGap(sync);
    const replica = sync?.replica;
    const failed = replica?.failed.length ?? 0;
    const sending = replica?.sending === true;
    const leftOut = sync?.skipped ? splitSkipped(sync.skipped).files : [];
    const missingOnServer = sync?.server ? Math.max(0, sync.local.files - sync.server.files) : 0;
    const upload = !replica ? null
        : failed > 0 ? fillTemplate(r.uploadFailed, { count: replica.dirty, failed })
            : replica.dirty > 0 ? fillTemplate(r.uploadWaiting, { count: replica.dirty }) : r.uploadNone;
    const busy = retry?.running === true || sending;
    const parity = parityText(labels, sync ?? null);
    return (
        <div data-testid="kg-server-tab" style={{ display: 'grid', gap: 16 }}>
            {sync && (
                <Section title={r.serverTitle}>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                        <Count label={r.hereLabel} n={sync.local.files} max={Math.max(sync.local.files, sync.server?.files ?? 0)} />
                        {sync.server && <Count label={r.onServerLabel} n={sync.server.files} max={Math.max(sync.local.files, sync.server.files)} />}
                    </ul>
                    {parity && <p data-testid="kg-review-parity" style={{ ...TYPE.meta, margin: 0 }}>{parity}</p>}
                    {hint(r.hintParity)}
                </Section>
            )}
            {sync && (gap.missing > 0 || missingOnServer > 0) && (
                <Section title={r.notStoredTitle}>
                    <ul data-testid="kg-review-not-stored" style={{ margin: 0, paddingInlineStart: 18, display: 'grid', gap: 2, ...TYPE.body }}>
                        {gap.missing > 0 && <li>{counted(labels, 'fileNotStored', gap.missing)}</li>}
                        {gap.tooLarge > 0 && <li>{counted(labels, 'fileTooLarge', Math.min(gap.tooLarge, gap.missing))}</li>}
                        {missingOnServer > 0 && <li>{counted(labels, 'fileMissing', missingOnServer)}</li>}
                    </ul>
                    {leftOut.length > 0 && (
                        <>
                            <div><button type="button" data-testid="kg-left-out-link" style={button} aria-expanded={showLeftOut} onClick={() => setShowLeftOut((v) => !v)}>{r.leftOutLink}</button></div>
                            {showLeftOut && <SkippedItems items={leftOut} labels={labels} testId="kg-left-out-list" />}
                        </>
                    )}
                    {hint(r.hintNotStored)}
                </Section>
            )}
            {upload && (
                <Section title={r.uploadTitle}>
                    <p data-testid="kg-review-upload" style={{ ...TYPE.body, margin: 0, color: failed > 0 ? cssVar('violation') : cssVar('text') }}>{upload}</p>
                    {failed > 0 && replica && <SyncReplica replica={replica} labels={labels} />}
                    {retry?.failed && <p role="alert" data-testid="kg-retry-failed" style={{ ...TYPE.meta, margin: 0, color: cssVar('violation') }}>{r.retryFailed}</p>}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {retry && (failed > 0 || (replica && replica.dirty > 0)) && (
                            <button type="button" data-testid={failed > 0 ? 'kg-retry-upload' : 'kg-upload-now'} style={button} disabled={busy} onClick={retry.retry}>
                                {busy ? r.uploadRetrying : failed > 0 ? r.actionRetryUpload : r.uploadNow}
                            </button>
                        )}
                        {failed > 0 && <button type="button" style={button} onClick={onDiagnose}>{labels.surface.overlay.diagnose}</button>}
                    </div>
                    {hint(r.hintQueue)}
                </Section>
            )}
            {sync && more && <ServerMore labels={labels} sync={sync} {...more} />}
            {revision && (
                <Section title={r.revisionTitle}>
                    <FixBeforeAfter revision={revision} labels={labels} />
                </Section>
            )}
        </div>
    );
}
