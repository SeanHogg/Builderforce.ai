import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CARD_ACTS } from '@/domains/canvas/application/cardActs';
import { cardActFor } from '@/domains/canvas/application/CardAct';
import type { CreationObjectKind } from '@/domains/canvas/domain/canvasObject';
import { formatterFor } from '@/i18n/format';
import type { Locale } from '@/i18n/config';
import type { Actor } from '@/lib/canvasApprovalGate';
import {
  actsUnblockedBy,
  approvalInboxOf,
  pendingChangeCount,
  reviewPendingChanges,
  type ApprovalInboxItem,
  type ReviewVerdict,
} from '@/lib/canvas/approvalInbox';
import type { RoomStationInstance } from '@/lib/canvas/roomStations';
import { useCanvasBoardBridge } from '../canvasBoardBridge';
import { useCardActRunner } from '../cardActRunner';
import type { RoomStationModel, RoomStationView } from './types';
import styles from './roomStations.module.css';

/**
 * THE APPROVAL DESK — where a change a tool or a widget made to a figure somebody will
 * rely on waits for a named person, and where that person signs it off or refuses it.
 *
 * Everything it decides is `lib/canvas/approvalInbox.ts`, which decides it with the
 * gate's own rules; this renders and applies. The write is the board's ordinary edit
 * path (`edits.patch`), carrying the stamped trail. When a signature unblocks one of the
 * object's gated acts and the board has a card act for it, the desk offers "Approve and
 * <act>", which stamps the trail and then runs the act through the ONE card-act runner —
 * so the approval and the act it authorised are the same click, in that order.
 *
 * Entitlement: a PERSON on this board sees the desk (null for a guest the board cannot
 * name, and never for an agent); only an editor can sign.
 */

function useApprovalInbox() {
  const board = useCanvasBoardBridge();
  const objects = board?.objects;
  const items = useMemo(() => (objects ? approvalInboxOf(objects) : []), [objects]);
  const viewer = board?.viewer ?? null;
  const reviewer = useMemo<Actor | null>(
    () => (viewer ? { kind: 'human', ref: viewer.userId, name: viewer.displayName } : null),
    [viewer],
  );
  return { board, items, reviewer };
}

function useKindLabel() {
  const tCanvas = useTranslations('creationCanvas');
  return (item: Pick<ApprovalInboxItem, 'kind' | 'title'>) => item.title || tCanvas(`object.${item.kind}`);
}

function ApprovalFace({ count, headline, lines }: { count: number; headline: string; lines: readonly string[] }) {
  return (
    <div className={styles.face} data-tone={count ? 'attention' : 'calm'}>
      <strong className={styles.faceFigure}>{count}</strong>
      <p className={styles.faceHeadline}>{headline}</p>
      {lines.length > 0 && (
        <ul className={styles.faceList}>
          {lines.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}
        </ul>
      )}
    </div>
  );
}

function useApprovalDeskModel(): RoomStationModel | null {
  const t = useTranslations('roomStations.approvals');
  const label = useKindLabel();
  const { board, items, reviewer } = useApprovalInbox();
  if (!board || !reviewer) return null;
  const count = pendingChangeCount(items);
  return {
    title: t('title'),
    summary: t('summary', { count }),
    face: <ApprovalFace count={count} headline={count ? t('faceCount', { count }) : t('faceEmpty')} lines={items.slice(0, 3).map(label)} />,
  };
}

function ApprovalDeskPanel(_props: { instance: RoomStationInstance }) {
  const t = useTranslations('roomStations.approvals');
  const locale = useLocale() as Locale;
  const fmt = useMemo(() => formatterFor(locale), [locale]);
  const label = useKindLabel();
  const runAct = useCardActRunner();
  const { board, items, reviewer } = useApprovalInbox();
  const [status, setStatus] = useState<{ tone: 'done' | 'refused'; text: string } | null>(null);
  if (!board || !reviewer) return null;
  const edits = board.edits;

  const actorName = (actor: Actor) => actor.name ?? t(`actor.${actor.kind}`);

  const review = (item: ApprovalInboxItem, verdict: ReviewVerdict, act?: string) => {
    const object = board.objects.find((candidate) => candidate.id === item.objectId);
    if (!object || !edits) return;
    const outcome = reviewPendingChanges(object.data, reviewer, new Date().toISOString(), verdict);
    if (!outcome.ok) {
      setStatus({ tone: 'refused', text: outcome.reason === 'self-approval' ? t('selfApproval') : t('nothingPending') });
      return;
    }
    edits.patch(item.objectId, outcome.patch);
    const text = verdict === 'approve'
      ? t('approved', { count: outcome.count, title: label(item) })
      : t('refused', { count: outcome.count, title: label(item) });
    setStatus({ tone: 'done', text });
    board.notice(text);
    if (act) runAct(item.objectId, act);
  };

  return (
    <div className={styles.panel} data-testid="approval-desk-panel">
      <p className={styles.intro}>{t('intro')}</p>
      {!edits && <p className={styles.note} role="note">{t('readOnly')}</p>}
      <p className={styles.live} role="status" aria-live="polite" data-tone={status?.tone}>{status?.text ?? ''}</p>
      {items.length === 0 ? (
        <p className={styles.empty}>{t('empty')}</p>
      ) : (
        <ul className={styles.inbox}>
          {items.map((item) => {
            const object = board.objects.find((candidate) => candidate.id === item.objectId);
            const acts = object
              ? actsUnblockedBy(object.data, reviewer).filter((action) => cardActFor(CARD_ACTS, item.kind as CreationObjectKind, action))
              : [];
            const headingId = `approval-${item.objectId}`;
            return (
              <li key={item.objectId} className={styles.item} aria-labelledby={headingId} data-testid="approval-item">
                <div className={styles.itemHead}>
                  <h3 id={headingId} className={styles.itemTitle}>{label(item)}</h3>
                  <span className={styles.itemKind}>{t('waiting', { when: fmt.relative(item.waitingSince) })}</span>
                </div>
                <ul className={styles.changes}>
                  {item.pending.map((entry) => (
                    <li key={entry.id} className={styles.change}>
                      <span className={styles.changeField}>{entry.field}</span>
                      <span className={styles.changeMove}>{t('move', { from: entry.from, to: entry.to })}</span>
                      <small className={styles.changeMeta}>
                        {t('by', { actor: actorName(entry.by), when: fmt.dateTime(entry.at) })}
                        {entry.source ? ` · ${t('source', { source: entry.source })}` : ''}
                      </small>
                    </li>
                  ))}
                </ul>
                {item.gatedActions.length > 0 && (
                  <p className={styles.unblocks}>{t('unblocks', { actions: fmt.list(item.gatedActions) })}</p>
                )}
                {edits && (
                  <div className={styles.actions}>
                    <button type="button" className={styles.primary} onClick={() => review(item, 'approve')} data-testid="approval-approve">
                      {t('approve')}
                    </button>
                    {acts.map((act) => (
                      <button key={act} type="button" className={styles.secondary} onClick={() => review(item, 'approve', act)}>
                        {t('approveAndRun', { action: act })}
                      </button>
                    ))}
                    <button type="button" className={styles.quiet} onClick={() => review(item, 'refuse')} data-testid="approval-refuse">
                      {t('refuse')}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export const approvalDeskView: RoomStationView = {
  useModel: () => useApprovalDeskModel(),
  Panel: ApprovalDeskPanel,
};
