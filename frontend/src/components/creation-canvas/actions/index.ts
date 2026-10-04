/**
 * The canvas's inline Brain vocabulary, assembled from its domain modules.
 *
 * Each module is a pure factory over {@link CanvasActionContext}; see `context.ts` for
 * why nothing here depends on the board's state — the vocabulary is built once per
 * session/role/locale and reads the CURRENT board when a tool runs.
 */
import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import type { CanvasActionContext } from './context';
import { canvasExecutiveActions } from './executive';
import { canvasRecruitingActions } from './recruiting';
import { canvasReaderActions } from './readers';
import { canvasPeopleOpsActions } from './peopleOps';
import { canvasDataQueryActions } from './dataQuery';
import { canvasDataModelActions } from './dataModel';
import { canvasDataGovernanceActions } from './dataGovernance';
import { canvasDataScienceActions } from './dataScience';
import { canvasDataSourceActions } from './dataSources';
import { canvasInboxActions } from './inbox';
import { canvasSocialActions } from './social';
import { canvasRealizationActions } from './realization';
import { canvasMediaActions } from './media';
import { canvasVideoActions } from './video';
import { canvasObjectActions } from './objects';
import { canvasQaPlanningActions } from './qaPlanning';
import { canvasQaExecutionActions } from './qaExecution';

const FACTORIES: ReadonlyArray<(ctx: CanvasActionContext) => BrainAction[]> = [
  canvasExecutiveActions,
  canvasRecruitingActions,
  canvasReaderActions,
  canvasPeopleOpsActions,
  canvasDataQueryActions,
  canvasDataModelActions,
  canvasDataGovernanceActions,
  canvasDataScienceActions,
  canvasDataSourceActions,
  canvasInboxActions,
  canvasSocialActions,
  canvasRealizationActions,
  canvasMediaActions,
  canvasVideoActions,
  canvasObjectActions,
  canvasQaPlanningActions,
  canvasQaExecutionActions,
];

export function canvasInlineActions(ctx: CanvasActionContext): BrainAction[] {
  return FACTORIES.flatMap((factory) => factory(ctx));
}
