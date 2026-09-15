/*
 * No `'use client'` here on purpose: imported only by `CanvasIdeasSurface`.
 */
import { useTranslations } from 'next-intl';
import { IDEA_STAGES, isIdeaStage, type IdeaStage } from '@builderforce/creation-canvas-contract';
import { useFormat } from '@/i18n/useFormat';
import type { IdeaLogEntry } from '@/lib/ideaLog';
import { specFieldValue, specObjectNamespace, specObjectSpec, type SpecDeriveBoard } from '@/lib/specObjects';
import { formatSpecVerdict, isSpecVerdictResult, type SpecVerdictTranslate } from '@/lib/specVerdict';
// The vocabularies register as an import side effect; importing the sets here is what
// lets `specObjectSpec('idea')` resolve when this row is rendered on its own.
import '@/lib/specObjectSets';
import styles from './CanvasIdeasSurface.module.css';

export interface IdeaLogRowProps {
  entry: IdeaLogEntry;
  /** The board the `evidence` derivation resolves `testedBy` refs against. */
  board: SpecDeriveBoard;
  /** Absent when the viewer cannot edit — the select is disabled, never hidden. */
  onStage?: (stage: IdeaStage) => void;
  /** Absent when the viewer cannot edit. */
  onPlanInterview?: () => void;
  onOpen: () => void;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * One idea in the log.
 *
 * The evidence sentence is NOT recomputed here: it is the `idea` spec's own `evidence`
 * derivation, formatted through the same `formatSpecVerdict` the card on the board uses,
 * so the list and the card cannot disagree about whether an idea was tested.
 */
export function IdeaLogRow({ entry, board, onStage, onPlanInterview, onOpen }: IdeaLogRowProps) {
  const t = useTranslations('creationCanvas.surface.ideas');
  const tRoot = useTranslations();
  const fmt = useFormat();

  const title = text(entry.data.title) || t('row.untitled');
  const scratch = text(entry.data.scratch);
  // A one-line capture's scratch IS its title; printing it twice is noise.
  const body = scratch && scratch !== title ? scratch : text(entry.data.problem);
  const nextStep = text(entry.data.nextStep);

  const namespace = specObjectNamespace('idea');
  const evidenceField = specObjectSpec('idea')?.fields.find((field) => field.name === 'evidence');
  const evidenceValue = evidenceField ? specFieldValue(evidenceField, entry.data as Record<string, unknown>, board) : undefined;
  const evidence = namespace && isSpecVerdictResult(evidenceValue)
    ? formatSpecVerdict(evidenceValue, namespace, tRoot as unknown as SpecVerdictTranslate, fmt.locale)
    : '';

  return (
    <article className={styles.row} data-stage={entry.stage} data-testid="idea-log-row">
      <header className={styles.rowHead}>
        <h3 className={styles.rowTitle}>{title}</h3>
        <label className={styles.stageSelect}>
          <span className={styles.srOnly}>{t('stageLabel', { idea: title })}</span>
          <select
            value={entry.stage}
            disabled={!onStage}
            onChange={(event) => { if (isIdeaStage(event.target.value)) onStage?.(event.target.value); }}
          >
            {IDEA_STAGES.map((stage) => <option key={stage} value={stage}>{t(`stage.${stage}`)}</option>)}
          </select>
        </label>
      </header>
      {body && <p className={styles.rowBody}>{body}</p>}
      <ul className={styles.rowMeta}>
        {entry.capturedAt && <li>{t('row.captured', { when: fmt.relative(entry.capturedAt) })}</li>}
        {nextStep && <li>{t('row.nextStep', { step: nextStep })}</li>}
        {evidence && <li className={entry.testedBy.length ? styles.evidence : styles.evidenceMissing}>{evidence}</li>}
      </ul>
      <div className={styles.rowActions}>
        <button type="button" className={styles.rowAction} disabled={!onPlanInterview} onClick={onPlanInterview}>
          {t('row.planInterview')}
        </button>
        <button type="button" className={styles.rowAction} onClick={onOpen}>{t('row.openOnBoard')}</button>
      </div>
    </article>
  );
}
