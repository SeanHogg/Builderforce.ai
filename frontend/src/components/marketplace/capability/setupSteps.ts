import type { ComponentType } from 'react';
import type { ReplaySiteDto } from '@builderforce/interaction-contract';
import type { CapabilityAppDef, CapabilityAppId } from '@/lib/marketplace/capabilityApps';
import { WorkspaceStep } from './WorkspaceStep';
import { CapabilityInstall } from './CapabilityInstall';
import { SnippetStep } from './SnippetStep';
import { VerifyStep } from './VerifyStep';
import { PlanStep } from './PlanStep';

export interface SetupStepProps {
  app: CapabilityAppDef & { id: CapabilityAppId };
  /** The site the flow created or switched on; null before the site step. */
  site: ReplaySiteDto | null;
  /** Advance — called ONLY after the step's own call succeeded. */
  onDone: (site?: ReplaySiteDto) => void;
}

export interface SetupStepDef {
  id: 'workspace' | 'site' | 'snippet' | 'verify' | 'plan';
  Component: ComponentType<SetupStepProps>;
}

/**
 * The set-up flow (PRD 33 §4.2 steps 3–7) as DATA: one page walks these in
 * order. A step is added here, never as a branch in the page.
 */
export const SETUP_STEPS: ReadonlyArray<SetupStepDef> = [
  { id: 'workspace', Component: WorkspaceStep },
  { id: 'site', Component: CapabilityInstall },
  { id: 'snippet', Component: SnippetStep },
  { id: 'verify', Component: VerifyStep },
  { id: 'plan', Component: PlanStep },
];
