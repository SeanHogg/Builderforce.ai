/**
 * PRESCRIPTION_ACTION_UI — how each `ReplayPrescriptionRouteAction` is offered on
 * a card (PRD 33 §5.1.4, D13). DATA: the card renders the DTO's `next` through
 * this record and never branches on an action.
 *
 *   • `gate` is the human gate before the POST:
 *       none     — one press (Fix it, Ticket, Test it drafts a test);
 *       reason   — an inline reason field in the card (Dismiss; D16: never a second overlay);
 *       preview  — the follow-up preview (matched contacts + draft) first, then a confirm that enrols;
 *       confirm  — `useConfirm` (Start test, Publish preview, Revert: they change what visitors see).
 *   • `project` — a ticket is filed on a project (an external site needs the reader's choice).
 *   • `tone` — primary for the action that makes the fix, the rest secondary/ghost.
 *   • `onCard: false` — the §5.2 page-review actions (Copy prompt, Apply page, Apply
 *     in composer) answer with a compiled prompt the `fix` kind's Prompt tab (S4f)
 *     handles; the card never draws them.
 */

import type { ReplayPrescriptionRouteAction } from '@builderforce/interaction-contract';
import type { IconName } from '@/components/ui/Icon';

export type PrescriptionActionGate = 'none' | 'reason' | 'preview' | 'confirm';

export interface PrescriptionActionUi {
  /** Under `replay.prescription.actions`. */
  labelKey: string;
  icon: IconName;
  gate: PrescriptionActionGate;
  /** Sends the reader's project (`projectId`) — the ticket's home on an external site. */
  project?: boolean;
  tone: 'primary' | 'secondary' | 'ghost';
  /** False: offered by another surface (the Prompt tab), not by the card. */
  onCard?: false;
}

export const PRESCRIPTION_ACTION_UI: Readonly<Record<ReplayPrescriptionRouteAction, PrescriptionActionUi>> = {
  fix: { labelKey: 'fix', icon: 'code', gate: 'none', project: true, tone: 'primary' },
  test: { labelKey: 'test', icon: 'branch', gate: 'none', tone: 'secondary' },
  'start-test': { labelKey: 'start-test', icon: 'play', gate: 'confirm', tone: 'primary' },
  'follow-up': { labelKey: 'follow-up', icon: 'mail', gate: 'preview', tone: 'primary' },
  ticket: { labelKey: 'ticket', icon: 'flag', gate: 'none', project: true, tone: 'secondary' },
  'publish-preview': { labelKey: 'publish-preview', icon: 'external-link', gate: 'confirm', tone: 'primary' },
  revert: { labelKey: 'revert', icon: 'refresh', gate: 'confirm', tone: 'secondary' },
  dismiss: { labelKey: 'dismiss', icon: 'close', gate: 'reason', tone: 'ghost' },
  'copy-prompt': { labelKey: 'copy-prompt', icon: 'copy', gate: 'none', tone: 'secondary', onCard: false },
  'apply-page': { labelKey: 'apply-page', icon: 'document', gate: 'none', tone: 'secondary', onCard: false },
  'apply-in-composer': { labelKey: 'apply-in-composer', icon: 'sparkles', gate: 'none', tone: 'secondary', onCard: false },
};

/** The buttons a card shows: `next`, in the API's order, each through the registry (card actions only). */
export function offeredActions(
  next: readonly ReplayPrescriptionRouteAction[],
  only?: readonly ReplayPrescriptionRouteAction[],
): Array<{ action: ReplayPrescriptionRouteAction; ui: PrescriptionActionUi }> {
  return next
    .filter((action) => (only ? only.includes(action) : true))
    .flatMap((action) => {
      const ui = PRESCRIPTION_ACTION_UI[action];
      return ui && ui.onCard !== false ? [{ action, ui }] : [];
    });
}
