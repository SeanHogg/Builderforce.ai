/** Re-export — the use case lives in application/project (ticket 3089). */
export {
  afterBrainProjectCreate,
  ensureProjectCodingTarget,
  hasConnectedRepo,
  workspaceFilesPath,
  type CodingTargetProject,
  type EnsureCodingTargetOpts,
  type ProjectCodingTarget,
} from '../application/project/ensureProjectCodingTarget';
