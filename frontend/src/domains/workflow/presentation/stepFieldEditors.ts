import type { ComponentType } from 'react';
import type { WorkflowNodeKind } from '@/lib/builderforceApi';
import { ConnectorNodeFields } from './ConnectorNodeFields';
import { SubflowNodeFields } from './SubflowNodeFields';

/**
 * THE STEP KINDS THAT BRING THEIR OWN EDITOR.
 *
 * Almost every kind declares typed `fields` in the step catalog and is rendered
 * generically. Two cannot, for the same reason: their options are not knowable at
 * build time. `connector`'s actions come from the tenant's live catalog, including
 * connectors they authored; `subflow`'s canvases are whatever canvases they have.
 * Hardcoding either would make the extensibility those steps exist to provide
 * unreachable.
 *
 * A REGISTRY rather than two `kind === '…'` branches inside `StepConfigForm`. The
 * first branch is a special case; the second is a pattern, and the third is the
 * form quietly becoming the file every step edits. Adding a kind that needs a live
 * editor is now one entry here and one component beside it — the form does not
 * change at all.
 */

export interface StepFieldEditorProps {
  config: Record<string, unknown>;
  setConfig: (key: string, value: unknown) => void;
  /** Patch several keys at once, for a choice that settles more than one field. */
  patchConfig: (patch: Record<string, unknown>) => void;
}

export const STEP_FIELD_EDITORS: Partial<Record<WorkflowNodeKind, ComponentType<StepFieldEditorProps>>> = {
  connector: ConnectorNodeFields,
  subflow: SubflowNodeFields,
};
