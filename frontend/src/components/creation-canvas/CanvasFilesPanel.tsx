'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import styles from './CreationCanvas.module.css';
import { formatBytes, type CanvasFile, type CanvasFileCategory } from '@/lib/canvasDocuments';

const CATEGORY_ICON: Readonly<Record<CanvasFileCategory, string>> = {
  document: '▤', presentation: '▣', diagram: '◈', spreadsheet: '▦',
  image: '▢', media: '▶', code: '</>', web: '◎', other: '□',
};

const FILTERS: ReadonlyArray<CanvasFileCategory | 'all'> = ['all', 'document', 'presentation', 'diagram', 'spreadsheet', 'image', 'media', 'code', 'web', 'other'];

/**
 * Every file this session holds, in one place.
 *
 * The board shows objects where they were placed; this shows what a person can
 * actually take away — the market analysis, the deck, the diagram, the sheet,
 * and each artifact exported or published from them. Opening a row focuses the
 * object it came from, so the library and the canvas are two views of one set of
 * files rather than two lists that drift apart.
 */
export function CanvasFilesPanel({
  files, onOpen, onDownload, onClose,
}: {
  files: CanvasFile[];
  onOpen: (nodeId: string) => void;
  onDownload: (file: CanvasFile) => void;
  onClose: () => void;
}) {
  const t = useTranslations('creationCanvas.files');
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
        <small>{t('count', { count: files.length })}</small>
        <button type="button" aria-label={t('close')} title={t('close')} onClick={onClose}>×</button>
      </header>
      {files.length > 0 && <div className={styles.filesControls}>
        <input
          className={styles.filesSearch}
          value={search}
          aria-label={t('search')}
          placeholder={t('search')}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className={styles.filesFilters} role="group" aria-label={t('filterByType')}>
          {available.map((category) => <button
            key={category}
            type="button"
            aria-pressed={filter === category}
            onClick={() => setFilter(category)}
          >{category === 'all' ? t('filterAll') : t(`category_${category}` as 'category_document')}</button>)}
        </div>
      </div>}
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
    </aside>
  );
}
