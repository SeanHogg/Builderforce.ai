import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  CITATION_STYLES, citationFromNode, citationsFromBibliographyNode, citationStyleOf, formatBibliography,
  inTextCitation, isCitationStyle, toBibtex, type CitationStyle,
} from '@/lib/academic/citations';
import { exportFilenameStem } from '@/lib/brain/messageExport';
import type { RoomStationInstance } from '@/lib/canvas/roomStations';
import { downloadText } from '@/lib/download';
import type { RoomStationModel, RoomStationView } from '../types';
import { AcademicFace } from './AcademicFace';
import { nodesOfKind, useAcademicBoard } from './academicBoard';
import styles from './academicStations.module.css';

/**
 * THE CITATIONS DESK — every reference on the board, in one style, each with the
 * in-text citation a writer drops into their prose and the whole list as BibTeX.
 *
 * The references are the board's own: every `citation` object and every row of every
 * `bibliography`, formatted by `formatBibliography` (which de-duplicates on DOI and key,
 * so a paper imported twice is listed once). The in-text marker is `inTextCitation` at
 * the entry's position — which is what the numeric styles print — so "[3]" on the desk is
 * "[3]" in the list. Insert puts it on the clipboard for wherever the writer's cursor is,
 * and says so in words; export is `toBibtex` through the platform's one download.
 *
 * Entitlement: anyone on the board — a reference list is the board's content.
 */

function useReferences() {
  const { board, nodes } = useAcademicBoard();
  const records = useMemo(() => [
    ...nodesOfKind(nodes, 'citation').map((node) => citationFromNode(node.data)),
    ...nodesOfKind(nodes, 'bibliography').flatMap((node) => citationsFromBibliographyNode(node.data)),
  ].filter((record) => record.title), [nodes]);
  const declaredStyle = useMemo<CitationStyle>(() => {
    const bibliography = nodesOfKind(nodes, 'bibliography')[0];
    return bibliography ? citationStyleOf(bibliography.data) : 'apa';
  }, [nodes]);
  return { board, records, declaredStyle };
}

function useCitationsModel(): RoomStationModel | null {
  const t = useTranslations('roomStations.citations');
  const { board, records, declaredStyle } = useReferences();
  const entries = useMemo(() => formatBibliography(records, declaredStyle), [records, declaredStyle]);
  if (!board || !entries.length) return null;
  return {
    title: t('title'),
    summary: t('summary', { count: entries.length }),
    face: (
      <AcademicFace
        figure={String(entries.length)}
        headline={t('faceHead', { style: t(`style.${declaredStyle}`) })}
        lines={entries.slice(0, 3).map((entry, index) => `${inTextCitation(entry.record, declaredStyle, index)} ${entry.record.title}`)}
        tone="calm"
      />
    ),
  };
}

function CitationsDeskPanel(_props: { instance: RoomStationInstance }) {
  const t = useTranslations('roomStations.citations');
  const { board, records, declaredStyle } = useReferences();
  const [chosen, setChosen] = useState<CitationStyle | null>(null);
  const [status, setStatus] = useState('');
  const style = chosen ?? declaredStyle;
  const entries = useMemo(() => formatBibliography(records, style), [records, style]);
  if (!board || !entries.length) return null;

  const insert = (citation: string) => {
    const done = () => setStatus(t('copied', { citation }));
    const fail = () => setStatus(t('copyFailed', { citation }));
    try {
      if (!navigator.clipboard) { fail(); return; }
      void navigator.clipboard.writeText(citation).then(done, fail);
    } catch { fail(); }
  };

  const exportBibtex = () => {
    const list = entries.map((entry) => entry.record);
    downloadText(toBibtex(list), `${exportFilenameStem(board.title, 'references')}.bib`, 'application/x-bibtex');
    setStatus(t('exported', { count: list.length }));
  };

  return (
    <div className={styles.panel} data-testid="citations-desk-panel">
      <div className={styles.sectionBar}>
        <label className={styles.field}>
          <span>{t('styleLabel')}</span>
          <select value={style} onChange={(event) => { if (isCitationStyle(event.target.value)) setChosen(event.target.value); }}>
            {CITATION_STYLES.map((option) => <option key={option} value={option}>{t(`style.${option}`)}</option>)}
          </select>
        </label>
        <button type="button" className={styles.action} onClick={exportBibtex}>{t('export')}</button>
      </div>
      <p className={styles.line} role="status" aria-live="polite">{status}</p>
      <ol className={styles.rows} aria-label={t('listLabel')}>
        {entries.map((entry, index) => {
          const citation = inTextCitation(entry.record, style, index);
          return (
            <li key={`${entry.record.key}-${index}`} className={styles.rowItem} data-testid="citation-entry">
              <span>
                {entry.marker && <span className={styles.marker}>{entry.marker}</span>}
                {entry.formatted.segments.map((segment, part) => (segment.italic ? <em key={part}>{segment.text}</em> : <span key={part}>{segment.text}</span>))}
              </span>
              <span className={styles.rowActions}>
                <code className={styles.code}>{citation}</code>
                <button type="button" className={styles.action} onClick={() => insert(citation)} aria-label={t('insertNamed', { title: entry.record.title })}>
                  {t('insert')}
                </button>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export const citationsDeskView: RoomStationView = {
  useModel: () => useCitationsModel(),
  Panel: CitationsDeskPanel,
};
