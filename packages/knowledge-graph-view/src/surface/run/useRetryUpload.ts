/**
 * Retry upload: the source's own `retrySync` port (an editor that pumps a replica; the web has none). The host answers once the upload has STARTED, never when it ends (an upload can outlast
 * any request timeout): `running` covers the call, the sync status is read again when it returns, and `useSyncStatus` polls it while the replica sends. A rejection of the start is `failed`
 * (said in words by the panel) and the button is enabled again.
 * The object travels by context: the review action and the Server tab both read it, and an absent port means no Retry anywhere.
 */

import { createContext, useCallback, useContext, useState } from 'react';
import type { KnowledgeGraphSource } from '../../types';

export interface RetryUpload {
    /** Forgets the recorded upload failures and sends the queue now. */
    retry(): void;
    /** The start of a retry is under way (the upload itself is followed through the polled sync status). */
    running: boolean;
    /** The last retry was refused or could not run. */
    failed: boolean;
}

export const RetryUploadContext = createContext<RetryUpload | undefined>(undefined);

/** The root's Retry upload, when the source can; undefined otherwise. */
export const useRetryUpload = (): RetryUpload | undefined => useContext(RetryUploadContext);

/** Builds the root's {@link RetryUpload} from the source (the view provides it once). */
export function useRetryUploadState(source: KnowledgeGraphSource, rootId: string | null, refresh: () => void): RetryUpload | undefined {
    const [running, setRunning] = useState(false);
    const [failed, setFailed] = useState(false);
    const port = source.retrySync;
    const retry = useCallback(() => {
        if (!port || !rootId) return;
        setRunning(true);
        setFailed(false);
        port.call(source, rootId).then(() => undefined, () => setFailed(true)).then(() => { setRunning(false); refresh(); });
    }, [port, source, rootId, refresh]);
    return port && rootId ? { retry, running, failed } : undefined;
}
