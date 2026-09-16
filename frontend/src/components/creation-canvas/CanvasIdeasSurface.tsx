/*
 * No `'use client'` here on purpose. This is imported only by `CreationCanvas.tsx`,
 * which already declares the boundary — the same reason `CanvasInsightsSurface` and
 * `CanvasAppSurface` state in their own headers.
 */
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  IDEA_KIND, ideaLogEntries, ideaStageCounts, untestedIdeaCount, withTestedBy,
  type IdeaLogEntry,
} from '@/lib/ideaLog';
import { makeSpecDeriveBoard } from '@/lib/specObjects';
import type { CreationNodeData } from './types';
import { IdeaLogRow } from './IdeaLogRow';
import { IdeaStageBar, type IdeaStageFilter } from './IdeaStageBar';
import canvasStyles from './CreationCanvas.module.css';
import styles from './CanvasIdeasSurface.module.css';

/** The two kinds this surface ever creates: the idea itself, and the interview that
 *  tests it. Narrow on purpose — a scratchpad is not a second object palette. */
export type IdeaSurfaceCreatableKind = typeof IDEA_KIND | 'customerInterview' | 'form';

export interface CanvasIdeasSurfaceProps {
  nodes: ReadonlyArray<{ id: string; data: CreationNodeData }>;
  /**
   * Appends an object to the board. ABSENT when the viewer cannot edit this canvas.
   *
   * It no longer carries the idea itself — the composer's `captureIdea` intent does
   * that, through the host. What is left is the OTHER card this surface creates: the
   * `customerInterview` that "Plan an interview" puts on the board beside an idea.
   */
  onCreate?: (kind: IdeaSurfaceCreatableKind, data: Partial<CreationNodeData>) => void;
  /** Patches an object on the board. ABSENT when the viewer cannot edit this canvas. */
  onUpdate?: (id: string, patch: Partial<CreationNodeData>) => void;
  /** Returns to the board with this object selected. */
  onOpenObject: (id: string) => void;
  /** Escape hands the board back. No exit BUTTON, same as `CanvasInsightsSurface`: this
   *  surface is in the switcher, so pressing Board is the way out. */
  onExit: () => void;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * THE IDEA SCRATCHPAD — write an idea down in seconds, and keep track of every one.
 *
 * ── IT HAS NO INPUT OF ITS OWN, AND THAT IS THE POINT ────────────────────────────
 * It used to draw `IdeaCaptureForm` — a textarea, a hint and a Capture button — eight
 * hundred pixels above the canvas's own composer. Two boxes on one screen, both asking
 * for a sentence, and nothing saying which one the Enter key you were about to press
 * belonged to. On a phone the pair cost the screen two lots of chrome for one act.
 *
 * A surface does not want an input; it wants a MEANING for the input that is already
 * there. So this surface declares `composerIntents: ['captureIdea', 'ask']`
 * (`lib/canvasSurfaces.ts`) and the ONE composer captures — through the same board
 * mutation the form called, from the same `ideaFromScratch` parse. The form is deleted.
 *
 * ── WHAT IT READS ────────────────────────────────────────────────────────────────
 * Nothing of its own. Every line captured becomes an `idea` card ON THE BOARD
 * (`founderObjects.ts`), so the scratchpad and the board are two readings of one set of
 * objects: Brain can research an idea you jotted, an idea Brain authored shows up in
 * this list, and dragging a card on the board never desynchronises a second store. The
 * list, the stage counts and the "untested" number are `lib/ideaLog.ts` over those cards.
 *
 * ── WHERE CUSTOMER INTERVIEWS COME IN ────────────────────────────────────────────
 * "Plan an interview" puts a `customerInterview` card on the board titled after the
 * idea, names it in the idea's `testedBy`, and moves a still-early idea to `validating`.
 * The idea's `evidence` then counts it — which is the whole loop BurnRateOS's scratch pad
 * ran through meetings, expressed as the objects the canvas already had.
 */
export function CanvasIdeasSurface({ nodes, onCreate, onUpdate, onOpenObject, onExit }: CanvasIdeasSurfaceProps) {
  const t = useTranslations('creationCanvas.surface.ideas');
  const entries = useMemo(() => ideaLogEntries(nodes), [nodes]);
  const counts = useMemo(() => ideaStageCounts(entries), [entries]);
  const untested = useMemo(() => untestedIdeaCount(entries), [entries]);
  // Indexed once per board change, for every row's `evidence` derivation — see
  // `makeSpecDeriveBoard` for why this is O(N) exactly once.
  const board = useMemo(() => makeSpecDeriveBoard(nodes.map((node) => node.data)), [nodes]);

  /**
   * WHICH STAGE IS BEING READ, and why the count it was taken at is held beside it.
   *
   * A fresh idea is always `captured`. Filtered to any other stage it would land
   * invisibly — the reader types a line, the composer clears, and nothing appears. The
   * form that used to live here handled that itself because it was the thing doing the
   * capturing; the composer is not, and it cannot reach this surface's filter.
   *
   * So the filter widens back to All when the list GROWS under a narrower one. Keyed on
   * the count taken when the filter was set, adjusted during render rather than in an
   * effect: an effect paints one frame of an empty list, and that frame is the one that
   * reads as "my idea did not save".
   */
  const [filter, setFilter] = useState<{ at: number; value: IdeaStageFilter }>({ at: entries.length, value: 'all' });
  const grew = entries.length > filter.at;
  const value = grew && filter.value !== 'captured' ? 'all' : filter.value;
  if (filter.at !== entries.length || filter.value !== value) setFilter({ at: entries.length, value });
  const visible = value === 'all' ? entries : entries.filter((entry) => entry.stage === value);

  const planInterview = (entry: IdeaLogEntry) => {
    if (!onCreate || !onUpdate) return;
    const title = t('row.interviewTitle', { idea: text(entry.data.title) || t('row.untitled') });
    const segment = text(entry.data.segment);
    onCreate('customerInterview', { title, ...(segment ? { segment } : {}) } as Partial<CreationNodeData>);
    onUpdate(entry.id, {
      testedBy: withTestedBy(entry.data, title),
      // Planning a conversation IS starting to validate. A later stage is never pulled back.
      ...(entry.stage === 'captured' || entry.stage === 'exploring' ? { stage: 'validating' } : {}),
    } as Partial<CreationNodeData>);
  };

  return (
    <section
      className={canvasStyles.ideasSurface}
      data-testid="canvas-ideas-surface"
      aria-label={t('regionLabel')}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onExit(); } }}
    >
      <div className={styles.body}>
        <header className={styles.head}>
          <h2 className={styles.heading}>{t('heading')}</h2>
          <p className={styles.lede}>{t('lede')}</p>
        </header>
        {entries.length === 0 ? (
          <div className={styles.empty} role="status">
            <strong>{t('empty.title')}</strong>
            <p>{t('empty.body')}</p>
          </div>
        ) : (
          <div className={styles.columns}>
            <IdeaStageBar counts={counts} total={entries.length} untested={untested} value={value} onChange={(next) => setFilter({ at: entries.length, value: next })} />
            <div className={styles.list}>
              <p className={styles.count}>{t('count', { count: visible.length })}</p>
              {visible.length === 0 ? (
                <p className={styles.filteredEmpty} role="status">{t('filteredEmpty')}</p>
              ) : visible.map((entry) => (
                <IdeaLogRow
                  key={entry.id}
                  entry={entry}
                  board={board}
                  onOpen={() => onOpenObject(entry.id)}
                  {...(onUpdate ? { onStage: (stage) => onUpdate(entry.id, { stage } as Partial<CreationNodeData>) } : {})}
                  {...(onCreate && onUpdate ? { onPlanInterview: () => planInterview(entry) } : {})}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
