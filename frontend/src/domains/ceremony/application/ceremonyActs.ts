/**
 * THE CEREMONY, as card acts — what a stand-up card DOES once the stand-up is over.
 *
 * ── THE ASYMMETRY THIS FIXES ────────────────────────────────────────────────
 * The board could START a ceremony and could not read one. `standup.start` opened a
 * `ceremony_sessions` row, stamped the card with its ref and drew a `joins` edge from
 * every seat — and there the relationship ended. The minutes, the decisions and the
 * follow-up work all landed on the companion meeting, on a different surface, and the
 * card that convened the meeting went on displaying the sentence it was created with.
 *
 * ── ONE WRITER, AND IT IS ON THE SERVER ─────────────────────────────────────
 * The write-back now happens BY ITSELF: when a ceremony's minutes are written, or a
 * ceremony concludes over minutes that exist, the API replaces the card's summary and
 * places each open action item beside it as a task
 * (`api/src/application/ceremony/ceremonyMinutesToCanvas.ts`). This act used to parse
 * the minutes in the browser and place the cards itself, keyed by title — a second
 * writer with a second idempotency key, so the two together put one meeting's action
 * items on the board twice.
 *
 * So `standup.minutes` is now the on-demand door to the same use case: it asks the
 * server to sync and says what happened. The placed cards arrive through
 * `canvas.changed`, the way any collaborator's edit does. Pressing it twice, or after
 * the automatic sync already ran, changes nothing.
 */

import { ceremonySessionsApi, type CeremonyMinutesToCanvasResult } from '@/lib/builderforceApi';
import { resourceIdOfType } from '@builderforce/creation-canvas-contract';
import type { CardAct } from '@/domains/canvas/application/CardAct';
import type { CanvasTextTranslator } from '@/domains/canvas/domain/canvasText';
import type { CanvasObject, CreationObjectKind } from '@/domains/canvas/domain/canvasObject';

/** The ceremony a stand-up card stands for, or null when it has never been convened. */
export function ceremonyIdOf(object: Pick<CanvasObject, 'data'>): string | null {
  return resourceIdOfType(object.data.resourceId, 'ceremony');
}

/**
 * The sentence for a sync outcome. Every refusal is NAMED — "never convened", "still
 * running", "nobody has generated minutes" and "nothing was said" are different things
 * for the person pressing the button, and exactly one of them is fixed by pressing it
 * again later.
 */
export function minutesSyncNotice(result: CeremonyMinutesToCanvasResult, t: CanvasTextTranslator): string {
  switch (result.status) {
    case 'not_found': return t('noticeStandupNeverConvened');
    case 'still_running': return t('noticeStandupStillRunning');
    case 'no_meeting': return t('noticeStandupNoMeeting');
    case 'not_summarized': return t('noticeStandupNotSummarized');
    case 'nothing_captured': return t('noticeStandupNothingCaptured');
    case 'synced':
      // The card is on no SAVED board yet — the server can only write to what it holds.
      if (result.boards === 0) return t('noticeStandupNotOnSavedBoard');
      if (result.placed > 0) return t('noticeStandupActionItemsPlaced', { count: result.placed });
      if (result.actionItems === 0) return t('noticeStandupNoActionItems');
      return t('noticeStandupActionItemsAlreadyOnBoard', { count: result.actionItems });
  }
}

/** `standup.minutes` — bring the meeting's minutes and action items onto the board. */
export const pullStandupMinutesAct: CardAct = {
  kind: 'standup' as CreationObjectKind,
  actions: ['minutes'],
  accountRequired: 'noticeStandupMinutesNeedsAccount',
  failureNotice: 'noticeStandupMinutesFailed',
  async run({ object, t }) {
    const ceremonyId = ceremonyIdOf(object);
    if (!ceremonyId) return { notice: t('noticeStandupNeverConvened') };
    return { notice: minutesSyncNotice(await ceremonySessionsApi.minutesToCanvas(ceremonyId), t) };
  },
};

export const CEREMONY_CARD_ACTS: readonly CardAct[] = [pullStandupMinutesAct];
