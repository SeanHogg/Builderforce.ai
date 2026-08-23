/**
 * THE CEREMONY, as card acts — what a stand-up card DOES once the stand-up is over.
 *
 * ── THE ASYMMETRY THIS FIXES ────────────────────────────────────────────────
 * The board could START a ceremony and could not read one. `standup.start` opened a
 * `ceremony_sessions` row, stamped the card with its ref and drew a `joins` edge from
 * every seat — and there the relationship ended. The minutes, the decisions and the
 * follow-up work all landed on the companion meeting, on a different surface, and the
 * card that convened the meeting went on displaying the sentence it was created with.
 * The board held the meeting's TRIGGER and never its OUTPUT.
 *
 * `standup.minutes` is the other half: it reads the ceremony's companion meeting, takes
 * the action items out of the minutes, and places each one on the board as a task beside
 * the card that called the meeting — where the rest of the work already is.
 *
 * ── IDEMPOTENT, BECAUSE IT WILL BE PRESSED TWICE ────────────────────────────
 * Minutes get regenerated and stand-ups get reopened, so the act matches what is already
 * on the board by title and places only what is missing. Pressing it again after a
 * re-summarize adds the new items and duplicates none of the old ones, which is the
 * behaviour `assignment.distribute` settled on for the same reason.
 */

import { meetingsApi, ceremonySessionsApi } from '@/lib/builderforceApi';
import { actionItemTitle, parseMeetingMinutes } from '@/lib/meetings/meetingMinutes';
import { resourceIdOfType } from '@/domains/canvas/domain/resourceRef';
import { actEdge, type CardAct } from '@/domains/canvas/application/CardAct';
import type { CanvasObject, CreationObjectKind } from '@/domains/canvas/domain/canvasObject';

/** The ceremony a stand-up card stands for, or null when it has never been convened. */
export function ceremonyIdOf(object: Pick<CanvasObject, 'data'>): string | null {
  return resourceIdOfType(object.data.resourceId, 'ceremony');
}

/** Compare titles the way a person would: case and surrounding space are not a
 *  difference, so a re-summarize that recapitalises an owner does not re-place the task. */
function titleKey(text: unknown): string {
  return String(text ?? '').trim().toLowerCase();
}

/**
 * `standup.minutes` — pull the meeting's action items onto the board as tasks.
 *
 * Every refusal is NAMED. "This stand-up was never convened", "it is still running",
 * "nobody has generated minutes" and "the minutes listed no action items" are four
 * different things for the person pressing the button, and exactly one of them is
 * something they can act on by pressing it again later.
 */
export const pullStandupMinutesAct: CardAct = {
  kind: 'standup' as CreationObjectKind,
  actions: ['minutes'],
  accountRequired: 'noticeStandupMinutesNeedsAccount',
  failureNotice: 'noticeStandupMinutesFailed',
  async run({ object, board, t }) {
    const ceremonyId = ceremonyIdOf(object);
    if (!ceremonyId) return { notice: t('noticeStandupNeverConvened') };

    const detail = await ceremonySessionsApi.detail(ceremonyId);
    const session = detail.session;
    if (!session) return { notice: t('noticeStandupNeverConvened') };
    // A live ceremony has no minutes by construction — the transcript is still being
    // written. Saying so beats "no action items", which reads as a finished meeting
    // that produced nothing.
    if (session.status === 'active') return { notice: t('noticeStandupStillRunning') };
    if (!session.meetingId) return { notice: t('noticeStandupNoMeeting') };

    const record = await meetingsApi.transcript(session.meetingId);
    if (!record.summary) {
      return {
        notice: record.segments.length
          ? t('noticeStandupNotSummarized')
          : t('noticeStandupNothingCaptured'),
      };
    }

    const { actionItems } = parseMeetingMinutes(record.summary);
    // A ticked item was already dealt with in the room; placing it would be handing the
    // team work they have just reported as finished.
    const open = actionItems.filter((item) => !item.done);
    if (!open.length) return { notice: t('noticeStandupNoActionItems') };

    const already = new Set(board.objects.filter((node) => node.data.kind === 'task').map((node) => titleKey(node.data.title)));
    const toPlace = open.filter((item) => !already.has(titleKey(actionItemTitle(item))));
    if (!toPlace.length) return { notice: t('noticeStandupActionItemsAlreadyOnBoard', { count: open.length }) };

    const created = toPlace.map((item, index) => {
      const node = board.create('task' as CreationObjectKind, {
        x: object.position.x + 420,
        y: object.position.y + index * 170,
      });
      node.data = {
        ...node.data,
        title: actionItemTitle(item),
        // The owner is the name the minutes used, kept as written. Resolving it to a
        // member here would be a guess made silently on somebody's behalf; the task
        // drawer's assignee picker is where a person makes it, seeing who they picked.
        subtitle: item.owner ?? undefined,
        // Where it came from, so a task nobody remembers agreeing to can be traced back
        // to the meeting that agreed it.
        sourceCeremonyId: ceremonyId,
      };
      return node;
    });

    return {
      add: { nodes: created, edges: created.map((node) => actEdge(object, node, 'action item', 'derivation')) },
      notice: t('noticeStandupActionItemsPlaced', { count: created.length }),
    };
  },
};

export const CEREMONY_CARD_ACTS: readonly CardAct[] = [pullStandupMinutesAct];
