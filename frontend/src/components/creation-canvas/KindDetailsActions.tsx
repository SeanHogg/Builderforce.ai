'use client';

import { useTranslations } from 'next-intl';
import { CARD_ACT_HANDLER, kindSettingsActions } from '@/lib/canvasKindSettings';
import { useCardActRunner } from './cardActRunner';
import type { CreationNodeData } from './types';
import styles from './CreationCanvas.module.css';

/**
 * A kind's declared actions, as buttons.
 *
 * The MANIFEST (`lib/canvasKindSettings.*.ts`) says which actions a kind offers, in
 * which order, and when they apply. Each names how it is performed:
 *
 *   • {@link CARD_ACT_HANDLER} — run the act of the same name from the card-act
 *     registry. The runner is read from the board's context, so an act needs no
 *     callback threaded down to get a button; this is the path a new act should take.
 *   • anything else — a key into `handlers`, the map the inspector builds from the
 *     side-effecting functions that still live in `CreationCanvas`'s closure. These are
 *     the pre-registry acts; each one that moves into `CARD_ACTS` leaves the map.
 *
 * An action naming a handler that does not exist renders NOTHING rather than an inert
 * button, because a control that cannot do the thing it is labelled with is worse than
 * no control — that is the failure the registry was introduced to stop.
 */
export function KindDetailsActions({ objectId, kind, data, editable, handlers }: {
  /** The board object these actions act on — what a card act is addressed by. */
  objectId: string;
  kind: string;
  data: CreationNodeData;
  editable: boolean;
  handlers: Record<string, () => void>;
}) {
  const t = useTranslations('creationCanvas');
  const runCardAct = useCardActRunner();
  const actions = kindSettingsActions(kind, data);
  if (!actions.length) return null;

  return <>{actions.map((action) => {
    const handler = action.handler === CARD_ACT_HANDLER
      ? () => runCardAct(objectId, action.name)
      : handlers[action.handler];
    if (!handler) return null;
    return <button
      key={action.name}
      type="button"
      className={action.style === 'primary' ? styles.fullButton : styles.secondaryFullButton}
      disabled={!editable || (action.disabled ? action.disabled(data) : false)}
      onClick={handler}
    >{t(action.labelKey as never)}</button>;
  })}</>;
}
