'use client';

/**
 * Your Miro boards, browsable on the canvas — the migration path off the whiteboard.
 *
 * The same shape as `CanvasDrivePanel`: list what the connected account can see,
 * pick one, and hand the result to the engine that turns it into objects. Here the
 * engine is `miroImport`, and the connection is a `miro` connector connection, so
 * the credential, the SSRF guard, the redaction and the call log are all the ones
 * every other connector already gets — this panel adds a browser, not a second
 * integration.
 *
 * ── PAGINATION IS NOT OPTIONAL ───────────────────────────────────────────────
 * Miro caps a page at 50 items and a real workshop board has hundreds, so the
 * import WALKS the cursor to the end before mapping. Importing page one and
 * calling it done is the failure mode that makes a migration tool untrustworthy:
 * the board appears to come across, and the half that is missing is the half
 * nobody notices until later. The walk is bounded — see `MAX_PAGES`.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from './CreationCanvas.module.css';
import { connectorsApi, type ConnectorConnection } from '@/lib/connectorsApi';
import {
  miroBoardToCanvas, type MiroBoardSummary, type MiroConnector, type MiroImportResult, type MiroItem,
} from '@/lib/miroImport';

/** 50 items a page × 40 pages = 2,000 items, comfortably past the largest real
 *  board and short of a runaway loop against a paginating API that never ends. */
const MAX_PAGES = 40;
const PAGE_SIZE = 50;

interface MiroPage<T> { data?: T[]; cursor?: string }

export interface CanvasMiroPanelProps {
  /** Handed the mapped graph, exactly as a file import hands over its objects. */
  onImport: (result: MiroImportResult, board: MiroBoardSummary) => void | Promise<void>;
  onClose: () => void;
  /** Where "Connect Miro" should send someone — the connector settings page. */
  connectHref: string;
}

export function CanvasMiroPanel({ onImport, onClose, connectHref }: CanvasMiroPanelProps) {
  const t = useTranslations('creationCanvas.miro');
  const [connections, setConnections] = useState<ConnectorConnection[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [boards, setBoards] = useState<MiroBoardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * One connector action, unwrapped.
   *
   * `runAction` reports a transport-level failure as a thrown error and an
   * API-level one as `ok: false` with a body — collapsing both into one throw here
   * is what lets every caller below be a plain `await`, and is the same unwrap
   * `readProxyChoice` makes for the LLM proxy.
   */
  const call = useCallback(async <T,>(connectionId: string, action: string, input: Record<string, unknown>): Promise<T> => {
    const result = await connectorsApi.runAction('miro', action, { connectionId, input });
    if (!result.ok) throw new Error(result.error || t('callFailed'));
    return result.data as T;
  }, [t]);

  const loadConnections = useCallback(async () => {
    try {
      const found = await connectorsApi.listConnections('miro');
      setConnections(found);
      setActiveId((current) => current ?? found.find((connection) => connection.enabled !== false)?.id ?? null);
    } catch {
      setError(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void loadConnections(); }, [loadConnections]);

  const loadBoards = useCallback(async (connectionId: string) => {
    setLoading(true);
    setError(null);
    try {
      const page = await call<MiroPage<MiroBoardSummary>>(connectionId, 'list_boards', { limit: PAGE_SIZE, sort: 'last_modified' });
      setBoards(page.data ?? []);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [call, t]);

  useEffect(() => {
    if (activeId == null) { setBoards([]); return; }
    void loadBoards(activeId);
  }, [activeId, loadBoards]);

  /** Walk one cursor-paginated endpoint to the end, or to `MAX_PAGES`. */
  const readAll = useCallback(async <T,>(connectionId: string, action: string, boardId: string, onPage?: (total: number) => void): Promise<T[]> => {
    const all: T[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const input: Record<string, unknown> = { board_id: boardId, limit: PAGE_SIZE };
      if (cursor) input.cursor = cursor;
      const result = await call<MiroPage<T>>(connectionId, action, input);
      all.push(...(result.data ?? []));
      onPage?.(all.length);
      cursor = result.cursor;
      if (!cursor) break;
    }
    return all;
  }, [call]);

  const importBoard = useCallback(async (board: MiroBoardSummary) => {
    if (activeId == null) return;
    setBusyId(board.id);
    setProgress(0);
    setError(null);
    try {
      const items = await readAll<MiroItem>(activeId, 'get_items', board.id, setProgress);
      const connectors = await readAll<MiroConnector>(activeId, 'get_connectors', board.id);
      await onImport(miroBoardToCanvas(items, connectors), board);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('importFailed', { name: board.name || board.id }));
    } finally {
      setBusyId(null);
      setProgress(null);
    }
  }, [activeId, onClose, onImport, readAll, t]);

  return (
    <aside className={styles.drivePanel} aria-label={t('title')}>
      <header>
        <strong>{t('title')}</strong>
        <button type="button" aria-label={t('close')} title={t('close')} onClick={onClose}>×</button>
      </header>

      {connections.length > 1 && <div className={styles.driveAccounts} role="group" aria-label={t('accounts')}>
        {connections.map((connection) => <button
          key={connection.id}
          type="button"
          aria-pressed={connection.id === activeId}
          onClick={() => setActiveId(connection.id)}
        >{connection.name}</button>)}
      </div>}

      {error && <p className={styles.driveNotice} role="alert">{error}</p>}

      <div className={styles.driveList} role="list">
        {boards.map((board) => <div key={board.id} className={styles.driveRow} role="listitem">
          <button
            type="button"
            className={styles.driveRowMain}
            disabled={busyId !== null}
            onClick={() => void importBoard(board)}
          >
            <span aria-hidden>▦</span>
            <span className={styles.driveRowName}>{board.name || t('untitledBoard')}</span>
            <small>{busyId === board.id
              ? (progress ? t('importingCount', { count: progress }) : t('importing'))
              : t('import')}</small>
          </button>
        </div>)}

        {loading && <p className={styles.driveEmpty}>{t('loading')}</p>}
        {!loading && !connections.length && <p className={styles.driveEmpty}>{t('connectPrompt')}</p>}
        {!loading && connections.length > 0 && !boards.length && <p className={styles.driveEmpty}>{t('noBoards')}</p>}
      </div>

      {/* The one honest thing to say about Miroverse, said where someone would
          otherwise go looking for it. A community template becomes importable the
          moment it is copied into the person's own Miro account, which is what
          Miro's own terms permit — so this is a route, not a refusal. */}
      <p className={styles.driveEmpty}>{t('communityTemplateHint')}</p>

      {!connections.length && <a className={styles.driveMore} href={connectHref}>{t('connect')}</a>}
    </aside>
  );
}
