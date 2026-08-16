'use client';

/**
 * Your Google Drive and OneDrive, browsable on the canvas.
 *
 * The point is to remove a round trip a person should never have had to make:
 * downloading a document out of Drive onto their desktop so they can drag it
 * back into the board. Opening a file here fetches its bytes and hands them to
 * the SAME import engine a dragged-in file goes through — so a Google Doc lands
 * as an editable document, a Sheet as a live grid, a Deck as slides, with no
 * separate code path to keep in step.
 *
 * A drive is arbitrarily deep, so it is WALKED, never fetched whole: one folder
 * per request, cached briefly on the API, with a breadcrumb rather than an
 * eagerly-expanded tree. `FileExplorer` was the obvious thing to reuse and is
 * the wrong shape here — it takes a flat list of every path up front and builds
 * the hierarchy client-side, which for a real Drive is an unbounded fan-out.
 *
 * ── A BROWSER, NOT A PANEL ───────────────────────────────────────────────────
 * This draws no frame, header or close button: it is the "Cloud" source INSIDE
 * `CanvasFilesPanel`. Cloud files and board files were two rail buttons opening
 * two panels that docked at the identical coordinates — so they stacked on top
 * of each other — for what a person reads as one question: which file do I want
 * on this board. One panel, one source picker.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from './CreationCanvas.module.css';
import { driveApi, type DriveConnection, type DriveItem, type DriveProviderStatus } from '@/lib/driveApi';
import { formatBytes } from '@/lib/canvasDocuments';

/** One step of the walk. The root has no id — each provider names it itself. */
interface Crumb {
  id: string | null;
  name: string;
}

/** Glyph per item, so a folder reads as a folder before the label is read. */
function itemGlyph(item: DriveItem): string {
  if (item.kind === 'folder') return '▸';
  const type = item.mimeType;
  if (type.includes('wordprocessing') || type.includes('google-apps.document')) return '▤';
  if (type.includes('spreadsheet')) return '▦';
  if (type.includes('presentation')) return '▣';
  if (type.startsWith('image/')) return '▢';
  if (type === 'application/pdf') return '▤';
  return '□';
}

export interface CanvasDriveBrowserProps {
  /** Handed a real `File`, exactly as a drop would be. */
  onImport: (file: File) => void | Promise<void>;
  /** Dismisses the host panel once a file has landed on the board. */
  onClose: () => void;
  /** Where the OAuth round trip should return the browser to. */
  returnTo: string;
}

export function CanvasDriveBrowser({ onImport, onClose, returnTo }: CanvasDriveBrowserProps) {
  const t = useTranslations('creationCanvas.drive');
  const [providers, setProviders] = useState<DriveProviderStatus[]>([]);
  const [connections, setConnections] = useState<DriveConnection[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [items, setItems] = useState<DriveItem[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadProviders = useCallback(async () => {
    try {
      const data = await driveApi.providers();
      setProviders(data.providers);
      setConnections(data.connections);
      // Open the first connected drive rather than making a person pick when
      // there is only one thing to pick.
      setActiveId((current) => current ?? data.connections.find((c) => c.status === 'connected')?.id ?? null);
    } catch {
      setError(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void loadProviders(); }, [loadProviders]);

  /** Read one folder. `append` is the "load more" page within the same folder. */
  const openFolder = useCallback(async (connectionId: number, folder: Crumb | null, append = false) => {
    setLoading(true);
    setError(null);
    try {
      const listing = await driveApi.list(connectionId, folder?.id ?? null, append ? cursor : undefined);
      setItems((current) => append ? [...current, ...listing.items] : listing.items);
      setCursor(listing.nextCursor);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [cursor, t]);

  // Selecting a drive resets the walk to its root.
  useEffect(() => {
    if (activeId == null) { setItems([]); setCrumbs([]); return; }
    setCrumbs([]);
    void openFolder(activeId, null);
    // `openFolder` closes over `cursor`, which changes as pages load; re-running
    // on that would restart the walk mid-scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const connect = useCallback(async (provider: DriveProviderStatus) => {
    try {
      const { authUrl } = await driveApi.connectUrl(provider.name, returnTo);
      window.location.href = authUrl;
    } catch {
      setError(t('connectFailed', { provider: provider.label }));
    }
  }, [returnTo, t]);

  const enter = useCallback((item: DriveItem) => {
    if (activeId == null) return;
    const crumb = { id: item.id, name: item.name };
    setCrumbs((current) => [...current, crumb]);
    void openFolder(activeId, crumb);
  }, [activeId, openFolder]);

  const goTo = useCallback((index: number) => {
    if (activeId == null) return;
    const next = crumbs.slice(0, index + 1);
    setCrumbs(next);
    void openFolder(activeId, next[next.length - 1] ?? null);
  }, [activeId, crumbs, openFolder]);

  const importItem = useCallback(async (item: DriveItem) => {
    if (activeId == null) return;
    setBusyId(item.id);
    setError(null);
    try {
      await onImport(await driveApi.fetchFile(activeId, item));
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('openFailed', { name: item.name }));
    } finally {
      setBusyId(null);
    }
  }, [activeId, onClose, onImport, t]);

  const connectable = providers.filter((provider) => !connections.some((account) => account.provider === provider.name));
  /** A grant the provider has since rejected. The row stays so the person can
   * see WHICH drive needs attention rather than it silently disappearing. */
  const needsReconnect = connections.some((account) => account.id === activeId && account.status !== 'connected');

  return (
    <>
      {connections.length > 0 && <div className={styles.driveAccounts} role="group" aria-label={t('accounts')}>
        {connections.map((connection) => <button
          key={connection.id}
          type="button"
          aria-pressed={connection.id === activeId}
          title={connection.accountEmail}
          onClick={() => setActiveId(connection.id)}
        >{connection.accountEmail || connection.displayName}</button>)}
      </div>}

      {needsReconnect && <p className={styles.driveNotice} role="alert">{t('reconnectNeeded')}</p>}

      {connectable.length > 0 && <div className={styles.driveConnect}>
        {connectable.map((provider) => <button
          key={provider.name}
          type="button"
          disabled={!provider.configured}
          title={provider.configured ? undefined : t('notConfigured', { provider: provider.label })}
          onClick={() => void connect(provider)}
        >{t('connect', { provider: provider.label })}</button>)}
      </div>}

      {activeId != null && <nav className={styles.driveCrumbs} aria-label={t('breadcrumb')}>
        <button type="button" onClick={() => goTo(-1)}>{t('root')}</button>
        {crumbs.map((crumb, index) => <button
          key={`${crumb.id}-${index}`}
          type="button"
          aria-current={index === crumbs.length - 1 ? 'page' : undefined}
          onClick={() => goTo(index)}
        >{crumb.name}</button>)}
      </nav>}

      {error && <p className={styles.driveNotice} role="alert">{error}</p>}

      <div className={styles.driveList} role="list">
        {items.map((item) => <div key={item.id} className={styles.driveRow} role="listitem">
          <button
            type="button"
            className={styles.driveRowMain}
            disabled={busyId === item.id}
            onClick={() => item.kind === 'folder' ? enter(item) : void importItem(item)}
          >
            <span aria-hidden>{itemGlyph(item)}</span>
            <span className={styles.driveRowName}>{item.name}</span>
            <small>{busyId === item.id
              ? t('opening')
              : item.kind === 'folder'
                ? t('folder')
                : item.sizeBytes ? formatBytes(item.sizeBytes) : ''}</small>
          </button>
        </div>)}
        {loading && <p className={styles.driveEmpty}>{t('loading')}</p>}
        {!loading && !items.length && activeId != null && <p className={styles.driveEmpty}>{t('emptyFolder')}</p>}
        {!loading && activeId == null && !connectable.length && <p className={styles.driveEmpty}>{t('noAccounts')}</p>}
        {!loading && activeId == null && connectable.length > 0 && <p className={styles.driveEmpty}>{t('connectPrompt')}</p>}
      </div>

      {cursor && !loading && activeId != null && <button
        type="button"
        className={styles.driveMore}
        onClick={() => void openFolder(activeId, crumbs[crumbs.length - 1] ?? null, true)}
      >{t('loadMore')}</button>}
    </>
  );
}
