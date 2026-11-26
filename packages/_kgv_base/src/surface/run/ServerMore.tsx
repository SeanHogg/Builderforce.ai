/**
 * The Server tab's lower sections, each its own small component from the old Sync drawer (nothing the drawer showed was left without a surface): the files that could not be
 * stored with "review again" (`ServerResend`), the data sources with their set-up actions (`SyncSources`), the folders the review never read (`SyncExcluded`) and the commits since
 * the last review (`SyncDelta`). They read the same props that fed the drawer: the root's sync status and history, the source, the composer and the review flow.
 */

import type { KnowledgeGraphLabels } from '../../labels';
import type { KnowledgeGraphSource, SyncStatus } from '../../types';
import type { HistoryRead } from '../TimeSlider';
import { SyncDelta } from '../drawers/SyncDelta';
import { SyncExcluded } from '../drawers/SyncExcluded';
import { SyncSources } from '../drawers/SyncSources';
import { splitSkipped } from '../drawers/syncDeltaModel';
import { ServerResend } from './ServerResend';

export interface ServerMoreProps {
    labels: KnowledgeGraphLabels;
    sync: SyncStatus;
    source?: KnowledgeGraphSource | undefined;
    history?: HistoryRead | undefined;
    lastReviewedAt?: string | undefined;
    onCompose?: ((text: string) => void) | undefined;
    /** Opens another drawer (a source's "Generate" opens the API drawer). */
    onOpenPanel(id: string): void;
    onResend?: (() => void) | undefined;
}

export function ServerMore({ labels, sync, source, history, lastReviewedAt, onCompose, onOpenPanel, onResend }: ServerMoreProps) {
    // One recorded list holds skipped files and the folders never read: told apart by reason.
    const split = splitSkipped(sync.skipped ?? []);
    return (
        <>
            <ServerResend labels={labels} skippedCount={split.files.length} onResend={onResend} />
            <SyncSources sources={sync.sources} labels={labels} onCompose={onCompose} onOpenPanel={onOpenPanel} />
            <SyncExcluded folders={split.folders} recorded={sync.skipped !== undefined} labels={labels} />
            <SyncDelta commits={history?.commits ?? []} hasHistory={!!source?.history} loading={history?.loading} lastReviewedAt={lastReviewedAt} labels={labels} />
        </>
    );
}
