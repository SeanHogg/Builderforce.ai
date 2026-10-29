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
 *
 * `PRESCRIPTION_LINK_ACTIONS` are the steps a person takes OUTSIDE the API: not a
 * `next` entry but a link into the product, drawn when the DTO says the step is open.
 * Today: "Build the preview" (`buildPreview`, set by the API once a hosted site's Fix it
 * is applied and its coding run has finished; "Rebuild the preview" when one already
 * exists) — a person builds the edited workspace in the browser and publishes the build
 * as a preview release (§5.1.4).
 */

import type { ReplayPrescriptionDto, ReplayPrescriptionRouteAction } from '@builderforce/interaction-contract';
import type { IconName } from '@/components/ui/Icon';
import { studioFixPreviewHref } from '@/lib/studio/studioDeepLink';

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

export interface PrescriptionLinkAction {
  id: 'build-preview';
  /** Under `replay.prescription.actions`. */
  labelKey: string;
  /** Replaces `labelKey` when the API flags the step as a repeat (`buildPreview.rebuild`). */
  rebuildLabelKey?: string;
  icon: IconName;
  tone: PrescriptionActionUi['tone'];
  /** The link for this fix, or null when the API does not offer the step (it decides; the UI never re-derives it). */
  href: (prescription: ReplayPrescriptionDto) => string | null;
}

export const PRESCRIPTION_LINK_ACTIONS: ReadonlyArray<PrescriptionLinkAction> = [
  {
    id: 'build-preview',
    labelKey: 'build-preview',
    rebuildLabelKey: 'rebuild-preview',
    icon: 'code',
    tone: 'primary',
    href: (p) => (p.buildPreview ? studioFixPreviewHref(p.buildPreview.projectId, p.id) : null),
  },
];

/** The link actions this fix offers right now, each with its address. */
export function offeredLinkActions(prescription: ReplayPrescriptionDto): Array<{ row: PrescriptionLinkAction; href: string; textKey: string }> {
  return PRESCRIPTION_LINK_ACTIONS.flatMap((row) => {
    const href = row.href(prescription);
    if (!href) return [];
    const repeat = row.id === 'build-preview' && prescription.buildPreview?.rebuild === true;
    return [{ row, href, textKey: repeat && row.rebuildLabelKey ? row.rebuildLabelKey : row.labelKey }];
  });
}
