'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { CanvasDriveIcon, CanvasFilesIcon } from '@/components/canvas/CanvasCommands';
import styles from './CreationCanvas.module.css';
import { CanvasPanelFilters } from './CanvasPanelFilters';
import { CanvasDriveBrowser } from './CanvasDriveBrowser';
import { formatBytes, type CanvasFile, type CanvasFileCategory } from '@/lib/canvasDocuments';

const CATEGORY_ICON: Readonly<Record<CanvasFileCategory, string>> = {
  document: '▤', presentation: '▣', diagram: '◈', spreadsheet: '▦',
  image: '▢', media: '▶', code: '</>', web: '◎', other: '□',
};

const FILTERS: ReadonlyArray<CanvasFileCategory | 'all'> = ['all', 'document', 'presentation', 'diagram', 'spreadsheet', 'image', 'media', 'code', 'web', 'other'];

/** Where the files on offer come from. Sources are DATA so adding a third one
 *  (a repo, a bucket) is an entry here plus its body, not a fourth rail button. */
const SOURCES = [
  { value: 'board', labelKey: 'sourceBoard', Icon: CanvasFilesIcon },
  { value: 'cloud', labelKey: 'sourceCloud', Icon: CanvasDriveIcon },
] as const;
type CanvasFileSource = typeof SOURCES[number]['value'];

/**
 * Every file this session can put on the board, in one place.
 *
 * TWO SOURCES, ONE PANEL. The board shows objects where they were placed; the
 * "This board" source shows what a person can actually take away — the market
 * analysis, the deck, the diagram, the sheet, and each artifact exported or
 * published from them — and opening a row focuses the object it came from, so
 * the library and the canvas are two views of one set of files rather than two
 * lists that drift apart. The "Cloud" source is the same question asked of a
 * connected Google Drive or OneDrive, and picking a file there imports it
 * through the identical engine a dragged-in file goes through.
 *
 * They were two rail buttons opening two panels docked at the same coordinates,
 * which meant opening both stacked one invisibly over the other. A person does
 * not think "board files" and "cloud files"; they think "the file I want".
 */
export function CanvasFilesPanel({
  files, onOpen, onDownload, onClose, onImportFile, returnTo, onRequireAccount,
}: {
  files: CanvasFile[];
  onOpen: (nodeId: string) => void;
  onDownload: (file: CanvasFile) => void;
  onClose: () => void;
  /** Handed a real `File` from the cloud source, exactly as a drop would be. */
  onImportFile: (file: File) => void | Promise<void>;
  /** Where the cloud provider's OAuth round trip should return the browser to. */
  returnTo: string;
  /** The canvas's ONE connected-account door. False keeps the cloud source shut
   *  rather than letting a signed-out visitor fire a request that returns 401. */
  onRequireAccount: (source: string) => boolean;
}) {
  const t = useTranslations('creationCanvas.files');
  const [source, setSource] = useState<CanvasFileSource>('board');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<CanvasFileCategory | 'all'>('all');
  const available = useMemo(() => FILTERS.filter((category) => category === 'all' || files.some((file) => file.category === category)), [files]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return files.filter((file) => (filter === 'all' || file.category === filter) && (!query || file.name.toLowerCase().includes(query)));
  }, [files, filter, search]);

  return (
    <aside className={styles.filesPanel} aria-label={t('title')}>
      <header>
        <strong>{t('title')}</strong>
        {source === 'board' && <small>{t('count', { count: files.length })}</small>}
        <button type="button" aria-label={t('close')} title={t('close')} onClick={onClose}>×</button>
      </header>
      <div className={styles.panelSources} role="group" aria-label={t('sourceGroup')}>
        {SOURCES.map(({ value, labelKey, Icon: SourceIcon }) => <button
          key={value}
          type="button"
          aria-pressed={source === value}
          onClick={() => { if (value !== 'cloud' || onRequireAccount(t('sourceCloud'))) setSource(value); }}
        ><SourceIcon />{t(labelKey)}</button>)}
      </div>
      {source === 'cloud'
        ? <CanvasDriveBrowser onImport={onImportFile} onClose={onClose} returnTo={returnTo} />
        : <>
      {files.length > 0 && <CanvasPanelFilters
        search={search}
        onSearchChange={setSearch}
        searchLabel={t('search')}
        filterGroupLabel={t('filterByType')}
        filter={filter}
        onFilterChange={(value) => setFilter(value as CanvasFileCategory | 'all')}
        chips={available.map((category) => ({
          value: category,
          label: category === 'all' ? t('filterAll') : t(`category_${category}` as 'category_document'),
        }))}
      />}
      {files.length === 0
        ? <p className={styles.filesEmpty}>{t('empty')}</p>
        : visible.length === 0
          ? <p className={styles.filesEmpty}>{t('noMatches')}</p>
          : <ul className={styles.filesList}>
            {visible.map((file) => <li key={file.id} className={styles.fileRow}>
              <button type="button" className={styles.fileOpen} onClick={() => onOpen(file.nodeId)} title={t('openOnCanvas')}>
                {file.previewImageUrl
                  ? <img src={file.previewImageUrl} alt="" aria-hidden />
                  : <span className={styles.fileIcon} aria-hidden><Icon source={CATEGORY_ICON[file.category]} size={18} /></span>}
                <span className={styles.fileText}>
                  <b>{file.name}</b>
                  <small>
                    {[
                      t(`category_${file.category}` as 'category_document'),
                      file.sizeBytes ? formatBytes(file.sizeBytes) : '',
                      file.source === 'export' ? t('exported') : file.editable ? t('editable') : '',
                    ].filter(Boolean).join(' · ')}
                  </small>
                </span>
              </button>
              <button type="button" className={styles.fileDownload} aria-label={t('download', { name: file.name })} title={t('download', { name: file.name })} onClick={() => onDownload(file)}>↓</button>
            </li>)}
          </ul>}
        </>}
    </aside>
  );
}
