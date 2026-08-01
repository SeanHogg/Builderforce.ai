export type { CreationObjectKind } from '@builderforce/creation-canvas-contract';
import type { CreationObjectKind } from '@builderforce/creation-canvas-contract';

export type CreationNodeData = {
  [key: string]: unknown;
  kind: CreationObjectKind;
  title: string;
  subtitle?: string;
  resourceId?: string;
  status?: string;
  model?: string;
  role?: string;
  focus?: string;
  accent?: string;
};
