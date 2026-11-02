/**
 * The one Brain UI. Used by BOTH the full-page Brain Storm route
 * (`variant="page"`) and the global docked drawer (`variant="docked"`). All
 * logic comes from the shared hooks (`useBrainChats` / `useBrainConversation`)
 * and the page-action registry — the only thing that differs between variants
 * is chrome (two-column page vs. collapsible drawer).
 *
 * This module is the seam only: the state machine is `useBrainPanelController`
 * (composed from the focused hooks in `./hooks`), the sections are in `./panel`
 * and read that controller through `BrainPanelContext`.
 */

import '@seanhogg/builderforce-brain-ui/styles.css';
import { AssigneeProfilesProvider } from '../workforce/AssigneeProfilesContext';
import { useBrainPanelController } from './hooks/useBrainPanelController';
import { BrainPanelContext } from './panel/BrainPanelContext';
import { BrainPageLayout } from './panel/BrainPageLayout';
import { BrainDockedLayout } from './panel/BrainDockedLayout';
import type { BrainPanelProps } from './panel/brainPanelTypes';

export type { BrainPanelProps } from './panel/brainPanelTypes';

export function BrainPanel(props: BrainPanelProps) {
  const controller = useBrainPanelController(props);

  // ---- Layouts (chrome only) ------------------------------------------------
  return (
    // ONE fetch of the tenant's personality map for the whole panel, so the recipient
    // hovercard in the composer costs no per-render request and self-hides for anyone
    // with no personality on file.
    <AssigneeProfilesProvider>
      <BrainPanelContext.Provider value={controller}>
        {controller.isPage ? <BrainPageLayout /> : <BrainDockedLayout />}
      </BrainPanelContext.Provider>
    </AssigneeProfilesProvider>
  );
}
