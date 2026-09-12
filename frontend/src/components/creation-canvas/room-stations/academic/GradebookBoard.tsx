import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { gradebookOf } from '@/lib/academic/derivations';
import { atRiskLearners, gradebookStats } from '@/lib/academic/gradebook';
import { moderationNeeded, moderationRowsFromNode } from '@/lib/academic/marking';
import type { RoomStationInstance } from '@/lib/canvas/roomStations';
import { useCanRunCardActs, useCardActRunner } from '../../cardActRunner';
import type { RoomStationModel, RoomStationView } from '../types';
import { AcademicFace } from './AcademicFace';
import { nodesOfKind, titleOf, useAcademicBoard } from './academicBoard';
import styles from './academicStations.module.css';

/**
 * THE GRADEBOOK BOARD — the cohort's marks, read as "who needs me this week" before
 * it is read as a grid.
 *
 * Every figure is the one the gradebook CARD derives (`gradebookOf`, the same cached
 * matrix), so the wall in the room, the card on the board and the CSV cannot disagree.
 * The learners at risk lead (`atRiskLearners`, ordered by how much trouble they are in),
 * and their rows in the grid carry the same flag in WORDS as well as in tint — a colour
 * is not an accessible way to say a student is failing. Export runs the gradebook's own
 * `export` card act, so there is one CSV and it goes through the platform's download.
 *
 * Entitlement: staff only. A gradebook is every learner's marks, and a learner on a
 * distributed board does not get a wall of their classmates' grades.
 */

function useGradebooks() {
  const { board, nodes, specBoard, staff } = useAcademicBoard();
  const books = useMemo(() => nodesOfKind(nodes, 'gradebook').map((node) => {
    const { matrix, bands } = gradebookOf(node.data, specBoard);
    const stats = matrix.rows.length && matrix.columns.length ? gradebookStats(matrix, bands) : null;
    const atRisk = stats ? atRiskLearners(matrix, bands) : [];
    return {
      id: node.id,
      title: titleOf(node.data),
      matrix,
      stats,
      atRisk,
      atRiskRefs: new Set(atRisk.map((learner) => learner.ref)),
      moderation: moderationNeeded(moderationRowsFromNode(node.data.moderation)),
    };
  }), [nodes, specBoard]);
  return { board, books, staff };
}

function useGradebookModel(): RoomStationModel | null {
  const t = useTranslations('roomStations.gradebook');
  const { board, books, staff } = useGradebooks();
  if (!board || !staff || !books.length) return null;
  const atRisk = books.flatMap((book) => book.atRisk);
  return {
    title: t('title'),
    summary: t('summary', { count: atRisk.length }),
    face: (
      <AcademicFace
        figure={String(atRisk.length)}
        headline={t('atRiskHead', { count: atRisk.length })}
        lines={atRisk.slice(0, 3).map((learner) => `${learner.label} · ${t(`reason.${learner.reason}`)}`)}
        tone={atRisk.length ? 'attention' : 'calm'}
      />
    ),
  };
}

function GradebookBoardPanel(_props: { instance: RoomStationInstance }) {
  const t = useTranslations('roomStations.gradebook');
  const runAct = useCardActRunner();
  const canAct = useCanRunCardActs();
  const { board, books, staff } = useGradebooks();
  if (!board || !staff || !books.length) return null;

  return (
    <div className={styles.panel} data-testid="gradebook-board-panel">
      {books.map((book) => {
        const title = book.title || t('untitled');
        return (
          <section key={book.id} className={styles.section} aria-label={title}>
            <div className={styles.sectionBar}>
              <h3 className={styles.sectionHead}>{title}</h3>
              {canAct && book.stats && (
                <button type="button" className={styles.action} onClick={() => runAct(book.id, 'export')} aria-label={t('exportNamed', { title })}>
                  {t('export')}
                </button>
              )}
            </div>
            {!book.stats ? <p className={styles.line}>{t('empty')}</p> : (
              <>
                <p className={styles.insight} data-tone={book.atRisk.length ? 'attention' : 'calm'}>
                  {t('atRiskHead', { count: book.atRisk.length })}
                  {' · '}
                  {book.stats.mean != null
                    ? t('stats', { mean: book.stats.mean, median: book.stats.median ?? 0, passRate: book.stats.passRate })
                    : t('statsNoMarks', { passRate: book.stats.passRate })}
                </p>
                {book.stats.awaitingMarkingCount > 0 && <p className={styles.line}>{t('awaiting', { count: book.stats.awaitingMarkingCount })}</p>}
                {book.atRisk.length > 0 && (
                  <ol className={styles.rows} aria-label={t('atRiskHead', { count: book.atRisk.length })}>
                    {book.atRisk.map((learner) => (
                      <li key={learner.ref} className={styles.rowItem} data-tone="attention" data-testid="at-risk-learner">
                        <strong>{learner.label}</strong>
                        <span>{t(`reason.${learner.reason}`)}{learner.runningPercent != null ? ` · ${learner.runningPercent}%` : ''}{learner.missingCount ? ` · ${t('missing', { count: learner.missingCount })}` : ''}</span>
                      </li>
                    ))}
                  </ol>
                )}
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <caption className={styles.srOnly}>{t('tableLabel', { title })}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t('column.learner')}</th>
                        {book.matrix.columns.map((column) => <th key={column} scope="col">{column}</th>)}
                        <th scope="col">{t('column.running')}</th>
                        <th scope="col">{t('column.final')}</th>
                        <th scope="col">{t('column.grade')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {book.matrix.rows.map((row) => {
                        const atRisk = book.atRiskRefs.has(row.ref);
                        return (
                          <tr key={row.ref} data-at-risk={atRisk ? 'true' : 'false'}>
                            <th scope="row">
                              {row.label}
                              {atRisk && <span className={styles.badge} data-tone="attention">{t('atRisk')}</span>}
                            </th>
                            {row.cells.map((cell, index) => <td key={book.matrix.columns[index] ?? index}>{cell ?? '—'}</td>)}
                            <td>{row.runningPercent ?? '—'}</td>
                            <td>{row.finalPercent}</td>
                            <td>{row.grade || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {book.moderation.length > 0 && (
              <>
                <p className={styles.line}>{t('moderationHead', { count: book.moderation.length })}</p>
                <ul className={styles.rows}>
                  {book.moderation.map((row) => (
                    <li key={row.learnerRef} className={styles.rowItem}>
                      {row.firstMark != null && row.secondMark != null
                        ? t('moderationGap', { learner: row.learnerRef, first: row.firstMark, second: row.secondMark })
                        : t('moderationMissing', { learner: row.learnerRef })}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

export const gradebookBoardView: RoomStationView = {
  useModel: () => useGradebookModel(),
  Panel: GradebookBoardPanel,
};
