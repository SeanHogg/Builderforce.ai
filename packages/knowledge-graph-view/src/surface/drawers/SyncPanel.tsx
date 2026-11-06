/**
 * The Sync drawer: where the reviewed root stands against the server. The six pipeline steps
 * with their state, local-against-server bars for files, edges and docs, the skipped files
 * with their reasons (nothing is dropped without a trace), the data sources and whether each
 * was collected, estimated or is not set up, and the folders the walk never reads. *Copy
 * diagnostics* reuses the view's own diagnostics text. Nothing renders when the source cannot
 * report its status.
 */

import { cssVar, type ThemeTone } from '../../scene/themeColors';
import { button, muted } from '../../styles';
import type { PanelProps } from '../registry';
import { SkippedItems } from '../../SkippedList';
import { SyncDelta } from './SyncDelta';
import { SyncDiagnostics } from './SyncDiagnostics';
import { SyncExcluded } from './SyncExcluded';
import { SyncSources } from './SyncSources';
import { splitSkipped } from './syncDeltaModel';
import { SyncParity } from './SyncParity';
import { pipelineSteps, type StepState } from './syncModel';
import { Section, StateLabel } from './ui';

const STATE_TONE: Record<StepState, ThemeTone> = { ok: 'agrees', pending: 'muted', attention: 'cycle' };

/**
 * The status is the root's ONE read (`PanelProps.sync`, from `useSyncStatus`): this drawer does not
 * fetch. Refresh asks that same hook to read again.
 */
export function SyncPanel({ labels, source, sync: status, syncFailed, onRefreshSync, diagnosticsText, history, lastReviewedAt, onCompose, onResendSkipped, surface }: PanelProps) {
    const t = labels.surface.sync, s = labels.surface;
    if (!source?.syncStatus) return null;
    if (syncFailed) return <p role="alert" style={{ margin: 0 }}>{t.failed}</p>;
    if (!status) return <p role="status" style={{ ...muted, margin: 0 }}>{t.loading}</p>;

    const diagnostics = diagnosticsText?.();
    // One recorded list holds skipped files and the folders never read: told apart by reason.
    const split = splitSkipped(status.skipped ?? []);
    return (
        <div data-testid="kg-sync" style={{ display: 'grid', gap: 16 }}>
            {onRefreshSync && <div><button type="button" style={button} onClick={onRefreshSync}>{t.refresh}</button></div>}
            <Section title={t.pipelineTitle}>
                <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                    {pipelineSteps(status).map((step) => (
                        <li key={step.id} data-step={step.id} data-state={step.state} style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 36 }}>
                            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 999, background: cssVar(STATE_TONE[step.state]), flex: 'none' }} />
                            <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 1 }}>
                                <span>{s.syncSteps[step.id]}</span>
                                <span style={muted}>{s.syncStepDetails[step.id]}</span>
                            </span>
                            <StateLabel tone={STATE_TONE[step.state]}>{s.syncStates[step.state]}</StateLabel>
                        </li>
                    ))}
                </ol>
            </Section>
            <SyncParity status={status} labels={labels} />
            <Section title={t.skippedTitle}>
                {status.skipped === undefined ? <p data-testid="kg-sync-skipped-unknown" style={{ ...muted, margin: 0 }}>{t.skippedUnknown}</p>
                    : split.files.length === 0 ? <p style={{ ...muted, margin: 0 }}>{t.skippedNone}</p>
                        : <SkippedItems items={split.files} labels={labels} testId="kg-sync-skipped" />}
            </Section>
            <SyncDelta commits={history?.commits ?? []} hasHistory={!!source.history} loading={history?.loading} lastReviewedAt={lastReviewedAt} labels={labels} />
            <SyncSources sources={status.sources} labels={labels} onCompose={onCompose} onOpenPanel={(id) => surface.openPanel(id)} />
            <SyncExcluded folders={split.folders} recorded={status.skipped !== undefined} labels={labels} />
            <SyncDiagnostics text={diagnostics} labels={labels} skippedCount={split.files.length} onResend={onResendSkipped} />
        </div>
    );
}
