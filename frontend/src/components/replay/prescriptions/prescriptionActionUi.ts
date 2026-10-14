/**
 * PRESCRIPTION_ACTION_UI — how each `ReplayPrescriptionRouteAction` is offered on
 * a card (PRD 33 §5.1.4, D13). DATA: the card renders the DTO's `next` through
 * this record and never branches on an action.
 *
 *   • `gate` is the human gate before the POST:
 *       none     — one press (Fix it, Ticket, Test it drafts a test);
 *       reason   — an inline reason field in the card (Dismiss; D16: never a second overlay);
 *       preview  — the follow-up preview (matched contacts + draft) first, then a confirm that enrols;
 *       confirm  — `useConfirm` (Start test, Publish preview, Revert: they change what visitors see);
 *       promptTab — opens the `fix` kind's Prompt tab, where the audience is chosen and
 *                  the copy records the action (Copy prompt);
 *       audience — an inline audience switch, then the POST; the answer's bundled prompt
 *                  is shown in the card with its Copy button (Apply to the page);
 *       composer — the POST, then the answer's prompt + selectors go to the ONE composer
 *                  through the host's `ComposerBridge` (Apply in composer).
 *   • `project` — a ticket is filed on a project (an external site needs the reader's choice).
 *   • `agent` — Fix it runs on the coding agent the reader picks (`agentRef`).
 *   • `requires: 'composer'` — drawn only where the host provides a composer bridge
 *     (the canvas's Measure ▸ Visitors); hidden everywhere else.
 *   • `tone` — primary for the action that makes the fix, the rest secondary/ghost.
 */

import type { ReplayPrescriptionRouteAction } from '@builderforce/interaction-contract';
import type { IconName } from '@/components/ui/Icon';

export type PrescriptionActionGate = 'none' | 'reason' | 'preview' | 'confirm' | 'promptTab' | 'audience' | 'composer';

/** What the host must provide for an action to be drawn. */
export type PrescriptionActionRequirement = 'composer';

export interface PrescriptionActionUi {
  /** Under `replay.prescription.actions`. */
  labelKey: string;
  icon: IconName;
  gate: PrescriptionActionGate;
  /** Sends the reader's project (`projectId`) — the ticket's home on an external site. */
  project?: boolean;
  /** Sends the coding agent the reader picks (`agentRef`). */
  agent?: boolean;
  tone: 'primary' | 'secondary' | 'ghost';
  requires?: PrescriptionActionRequirement;
}

export const PRESCRIPTION_ACTION_UI: Readonly<Record<ReplayPrescriptionRouteAction, PrescriptionActionUi>> = {
  fix: { labelKey: 'fix', icon: 'code', gate: 'none', project: true, agent: true, tone: 'primary' },
  test: { labelKey: 'test', icon: 'branch', gate: 'none', tone: 'secondary' },
  'start-test': { labelKey: 'start-test', icon: 'play', gate: 'confirm', tone: 'primary' },
  'follow-up': { labelKey: 'follow-up', icon: 'mail', gate: 'preview', tone: 'primary' },
  ticket: { labelKey: 'ticket', icon: 'flag', gate: 'none', project: true, tone: 'secondary' },
  'publish-preview': { labelKey: 'publish-preview', icon: 'external-link', gate: 'confirm', tone: 'primary' },
  revert: { labelKey: 'revert', icon: 'refresh', gate: 'confirm', tone: 'secondary' },
  dismiss: { labelKey: 'dismiss', icon: 'close', gate: 'reason', tone: 'ghost' },
  'copy-prompt': { labelKey: 'copy-prompt', icon: 'copy', gate: 'promptTab', tone: 'secondary' },
  'apply-page': { labelKey: 'apply-page', icon: 'document', gate: 'audience', tone: 'secondary' },
  'apply-in-composer': { labelKey: 'apply-in-composer', icon: 'sparkles', gate: 'composer', tone: 'primary', requires: 'composer' },
};

/** The buttons a card shows: `next`, in the API's order, each through the registry — minus what the host cannot do. */
export function offeredActions(
  next: readonly ReplayPrescriptionRouteAction[],
  only?: readonly ReplayPrescriptionRouteAction[],
  host: { composer: boolean } = { composer: false },
): Array<{ action: ReplayPrescriptionRouteAction; ui: PrescriptionActionUi }> {
  return next
    .filter((action) => (only ? only.includes(action) : true))
    .flatMap((action) => {
      const ui = PRESCRIPTION_ACTION_UI[action];
      if (!ui) return [];
      if (ui.requires === 'composer' && !host.composer) return [];
      return [{ action, ui }];
    });
}
