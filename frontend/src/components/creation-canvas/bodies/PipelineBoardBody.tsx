import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { PIPELINE_MAX_CARDS_PER_CELL, cardProbabilityPercent, cardsAt, pipelineTotals, readPipelineModel, stageTotals } from '@/lib/canvasSalesPipeline';
import { useMoneyFormat } from '@/lib/useMoneyFormat';
import type { CreationBodyProps } from './types';
import { useCreationNodeActions } from './nodeActions';

/**
 * A pipeline, as a kanban with swimlanes — and a deal you can actually drag.
 *
 * Stages across, segments down, a deal at the intersection — because "qualified"
 * is different work for a founder and for an enterprise buyer, and one column of
 * both is a list nobody can act on. The model (`canvasSalesPipeline`) does the
 * normalising; this only draws it.
 *
 * ── WHY THE DRAG IS THE POINT ────────────────────────────────────────────────
 * FO-F1 made the board a PROJECTION and gave every card its `dealId`, and named
 * itself after "a deal dragged on the board" — which was then possible through the
 * MODEL (`canvas_move_deal`) and not through a pointer, because this component had
 * no drag handler. Everything the gesture needs already existed: the card carries
 * the canonical id, and ONE call both moves the deal and returns the redrawn
 * board. So this is an affordance over an existing write, and it is deliberately
 * not a second write path — `onMoveDeal` reaches exactly the same `moveDeal` the
 * tool does, and the card is redrawn from that call's own response.
 *
 * A card with no `dealId` is NOT draggable, and that is the honest rendering: a
 * hand-authored card has no row behind it to move, and letting it slide into
 * another column would show a change the CRM never made.
 *
 * `nowheel`/`nodrag` on the scroller: the board owns the wheel for zoom, so
 * without them scrolling to a later stage zooms the canvas instead, and a pointer
 * drag on a card would pan the board rather than move the deal.
 */
export function PipelineBoardBody({ data }: CreationBodyProps) {
  const { moveDeal: onMoveDeal } = useCreationNodeActions();
  const { formatCents } = useMoneyFormat();
  const t = useTranslations('creationCanvas.node');
  const model = useMemo(() => readPipelineModel(data as unknown as Record<string, unknown>), [data]);
  const stageLabel = (stage: string) => (t.has(`pipelineStage.${stage}`) ? t(`pipelineStage.${stage}`) : stage);
  // ONE cents formatter, shared with every other money surface in the product. The private
  // `$${cents / 100}` this used to carry rendered US dollars with no decimals whatever the
  // board's currency was, and was the twenty-first copy of the same three lines — see
  // `formatCents`.
  const money = (cents: number) => formatCents(cents, { maximumFractionDigits: 0 });
  // The whole board's OPEN pipeline, weighted. This is what makes the object answer the
  // question it exists for — "will I hit my number" — rather than only "how many cards".
  const totals = useMemo(() => pipelineTotals(model), [model]);

  /** The deal under the pointer, and the column it is over. Local because it is
   *  pure gesture state — nothing outside this card needs to know a drag is in
   *  flight, and putting it on the node would make a hover a board mutation. */
  const [dragging, setDragging] = useState<number | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  const canMove = Boolean(onMoveDeal);
  const endDrag = () => { setDragging(null); setOverStage(null); };

  const drop = (stage: string) => (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const dealId = Number(event.dataTransfer.getData('application/x-builderforce-deal') || dragging || 0);
    endDrag();
    // A drop back into the column it came from is not a move. Refused here rather
    // than at the API, so an accidental nudge costs nothing and writes no touch.
    if (!dealId || !onMoveDeal) return;
    const card = model.cards.find((row) => row.dealId === dealId);
    if (card && card.stage === stage) return;
    onMoveDeal(dealId, stage);
  };

  return (
    <div
      className={`${styles.pipelineBoard} nodrag nowheel`}
      // The column count is DATA, so the grid template reads it rather than the
      // stylesheet hard-coding seven and breaking on a six-stage pipeline.
      style={{ ['--pipeline-stages' as string]: String(model.stages.length) }}
    >
      <div className={styles.pipelineHead}>
        {/* The lane gutter's header cell — empty, so the stage columns line up. */}
        <span aria-hidden="true" />
        {model.stages.map((stage) => {
          const column = stageTotals(model, stage);
          return (
            <span key={stage} className={styles.pipelineStageHead}>
              <b>{stageLabel(stage)}</b>
              <small>{column.valueCents > 0 ? `${column.count} · ${money(column.valueCents)}` : String(column.count)}</small>
            </span>
          );
        })}
      </div>
      {/* The line a pipeline is actually read for. Shown only once there is money on the
          board: a weighted total of zero would read as a dead quarter when what it means
          is that nobody has priced anything yet — and the unpriced count says exactly that
          instead. */}
      {totals.openCount > 0 && (
        <p className={styles.pipelineTotals}>
          <span>{t('pipelineWeighted', { amount: money(totals.weightedCents) })}</span>
          <span>{t('pipelineOpen', { count: totals.openCount, amount: money(totals.openValueCents) })}</span>
          {totals.unpricedCount > 0 && <span>{t('pipelineUnpriced', { count: totals.unpricedCount })}</span>}
        </p>
      )}
      {model.lanes.map((lane, laneIndex) => (
        <div key={lane.id} className={styles.pipelineLane}>
          <span className={styles.pipelineLaneHead}>
            <b>{lane.title || t('pipelineAllSegments')}</b>
            {lane.hint && <small>{lane.hint}</small>}
          </span>
          {model.stages.map((stage) => {
            const cards = cardsAt(model, laneIndex, stage);
            const shown = cards.slice(0, PIPELINE_MAX_CARDS_PER_CELL);
            return (
              <span
                key={stage}
                className={styles.pipelineCell}
                data-drop={canMove && dragging != null && overStage === stage ? 'true' : undefined}
                // `preventDefault` on drag-over is what MAKES an element a drop
                // target in the HTML drag protocol — without it the drop event
                // never fires and the card silently springs back.
                onDragOver={canMove ? (event) => { event.preventDefault(); setOverStage(stage); } : undefined}
                onDrop={canMove ? drop(stage) : undefined}
              >
                {shown.map((card) => {
                  const draggable = canMove && card.dealId != null;
                  return (
                    <article
                      key={card.id}
                      className={styles.pipelineCard}
                      draggable={draggable}
                      data-draggable={draggable ? 'true' : undefined}
                      data-dragging={dragging != null && dragging === card.dealId ? 'true' : undefined}
                      // Named so a screen reader is told the card is movable and
                      // where it currently sits — a drag affordance nobody can
                      // perceive is a drag affordance for one kind of user.
                      aria-grabbed={draggable ? (dragging === card.dealId) : undefined}
                      title={draggable ? t('pipelineDragHint', { stage: stageLabel(card.stage) }) : undefined}
                      onDragStart={draggable ? (event) => {
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('application/x-builderforce-deal', String(card.dealId));
                        setDragging(card.dealId);
                      } : undefined}
                      onDragEnd={draggable ? endDrag : undefined}
                    >
                      <b>{card.title}</b>
                      {card.note && <p>{card.note}</p>}
                      {card.valueCents != null && (
                        <em>{money(card.valueCents)} · {t('pipelineOdds', { percent: cardProbabilityPercent(card) })}</em>
                      )}
                    </article>
                  );
                })}
                {cards.length > shown.length && <small>{t('pipelineMore', { count: cards.length - shown.length })}</small>}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * One renderer for BOTH boards. A `fundingRound` whose `cards` were written by
 * the raise projection (FO-E1) is a pipeline in every sense the kanban cares
 * about — stages across, a deal at each intersection — and giving it a second
 * component would be two answers to "how is a pipeline drawn". A round nobody
 * has synced has no `cards` and falls through to its spec fields, unchanged.
 */
export function FundingRoundBody(props: CreationBodyProps) {
  return Array.isArray(props.data.cards) && props.data.cards.length > 0 ? <PipelineBoardBody {...props} /> : null;
}
