import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import ReactMarkdown from 'react-markdown';
import { DOCUMENT_REMARK_PLUGINS, MARKDOWN_REHYPE_PLUGINS } from '@/lib/markdownPipeline';
import styles from '../CreationCanvas.module.css';
import { authoredMarkdown, canvasDocument } from '@/lib/canvasDocuments';
import { DocumentEditor } from '../DocumentEditor';
import type { CreationBodyProps } from './types';
import { useCreationNodeActions } from './nodeActions';
import { AuthoredContent } from './shared';

/**
 * A document object rendered AS a document — the pages, headings, tables and
 * lists that were written — instead of the first paragraph of its source text.
 * Pages are turned, not scrolled past: a file imported from Word or PDF keeps
 * the breaks its author declared, so the page on the card is the page in the
 * source file, and a twenty-page market analysis is readable on the board
 * without opening anything.
 *
 * The card is also where the document is WORKED ON. Asking for a document and
 * then being sent to a markdown box in a side panel to fix one sentence — or to
 * a different surface again to get a file out of it — is three places to learn
 * for one document. Write it here, take it away from here.
 */
export function DocumentBody({ data }: CreationBodyProps) {
  /** Absent on a board this person cannot edit, which is what removes the Edit
   * control rather than leaving an inert one behind. */
  const { edit: onEdit } = useCreationNodeActions();
  const t = useTranslations('creationCanvas.node');
  const [requested, setRequested] = useState(0);
  const [editing, setEditing] = useState(false);
  // Paginating re-splits the whole body; a twenty-page import would do that on
  // every re-render of a card that is only being dragged.
  const document = useMemo(() => canvasDocument(data), [data]);
  // The editor works on the RAW body, not the paginated read of it: the page
  // breaks a Word or PDF import declared are markers inside that body, and
  // saving the flattened version back would collapse the file to one page.
  const source = authoredMarkdown(data) ?? '';
  const pages = document?.pages ?? [];
  // Editing can shorten a document under a reader who has turned past the new
  // last page, so the rendered page is always clamped to what exists.
  const page = Math.min(Math.max(requested, 0), Math.max(0, pages.length - 1));
  const paginated = !editing && pages.length > 1;

  // Only the Edit toggle lives here. Downloads are the shared export row that
  // every artifact card carries, so a document and a deck offer their formats
  // in the same place and neither list can drift from the other.
  const actions = onEdit ? <div className={`${styles.cardActions} nodrag nowheel`}>
    <button
      type="button"
      data-active={editing ? 'true' : undefined}
      aria-pressed={editing}
      onClick={(event) => { event.stopPropagation(); setEditing(!editing); }}
    >{editing ? t('documentDone') : t('documentEdit')}</button>
  </div> : null;

  if (editing && onEdit) return <div className={styles.documentBody}>
    {actions}
    <DocumentEditor markdown={source} label={data.title} onCommit={(markdown) => onEdit({ markdown, content: markdown })} />
  </div>;

  if (!document) return <>{actions}<AuthoredContent data={data} fallback={t('documentFallback')} /></>;

  return <div className={styles.documentBody}>
    <div className={styles.documentMeta}>
      <span>{t('documentPages', { count: document.pageCount })}</span>
      <span>{t('documentWords', { count: document.wordCount })}</span>
      <span>{t('documentReading', { minutes: document.readingMinutes })}</span>
      {typeof data.sourceFormat === 'string' && <span>{String(data.sourceFormat)}</span>}
    </div>
    {actions}
    <div className={`${styles.documentSheet} nowheel nodrag`} role="region" aria-label={data.title} tabIndex={0}>
      <div className={styles.documentPage} data-paginated={paginated ? 'true' : undefined}>
        <div className={styles.documentMarkdown}><ReactMarkdown remarkPlugins={DOCUMENT_REMARK_PLUGINS} rehypePlugins={MARKDOWN_REHYPE_PLUGINS}>{pages[page] ?? document.markdown}</ReactMarkdown></div>
        {paginated && <span className={styles.documentPageNumber} aria-hidden>{page + 1}</span>}
      </div>
    </div>
    {paginated && <div className={`${styles.documentPager} nodrag nowheel`}>
      <button
        type="button"
        disabled={page === 0}
        aria-label={t('previousPage')}
        title={t('previousPage')}
        onClick={(event) => { event.stopPropagation(); setRequested(page - 1); }}
      >‹</button>
      <span aria-live="polite">{t('pageOfPages', { page: page + 1, total: pages.length })}</span>
      <button
        type="button"
        disabled={page >= pages.length - 1}
        aria-label={t('nextPage')}
        title={t('nextPage')}
        onClick={(event) => { event.stopPropagation(); setRequested(page + 1); }}
      >›</button>
    </div>}
  </div>;
}
