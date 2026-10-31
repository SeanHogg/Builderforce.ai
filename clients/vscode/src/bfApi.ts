/**
 * Client for BuilderForce's tenant APIs — a barrel over `./bfApi/`, one module per
 * domain, all sharing the single session + transport core (`session.ts`,
 * `transport.ts`). Callers keep importing from here; nothing is defined in this file.
 */

// Session: the key → tenant-JWT exchange, workspace scoping, sign-out.
export {
  clearJwt,
  getTenantJwt,
  onEditorKeyRejected,
  probeEditorKey,
  refreshTenantJwt,
  setSelectedWorkspace,
  workspaceTenantId,
} from "./bfApi/session";

// Transport: the authenticated fetch every domain rides.
export { authed, authedRaw, fetchAuthed } from "./bfApi/transport";
export type { AuthedInit } from "./bfApi/transport";

// Identity and workspaces.
export {
  canManageActiveWorkspace,
  createWorkspace,
  getCurrentUserId,
  getCurrentWorkspace,
  listWorkspaces,
} from "./bfApi/workspace";
export type { BfWorkspace } from "./bfApi/workspace";

export { connect, diagnose } from "./bfApi/connection";

// Projects, their Evermind head and shared facts.
export { createProject, listProjects } from "./bfApi/projects";
export type { BfProject } from "./bfApi/projects";
export {
  bfApiRequest,
  forgetProjectFact,
  getProjectEvermindHead,
  invalidateProjectEvermind,
  projectEvermindHooks,
  recallProjectFacts,
  rememberProjectFact,
} from "./bfApi/projectMemory";

export { createCreationSession, listCreationSessions } from "./bfApi/creationSessions";
export type { BfCreationSessionSummary } from "./bfApi/creationSessions";

// The board: tickets and objectives.
export {
  convertTaskType,
  DEFAULT_HIDE_DONE,
  deleteTask,
  invalidateObjectives,
  invalidateTasks,
  listAssignedTasks,
  listClosedTasks,
  listProjectObjectives,
  listTasks,
  listTasksForReview,
  setTaskArchived,
  updateTaskStatus,
} from "./bfApi/tasks";
export type { BfObjective, BfTask } from "./bfApi/tasks";

// Brain chats and the turns written to them.
export {
  createBrainChat,
  deleteBrainChat,
  listAgentPool,
  listBrainChats,
  renameBrainChat,
} from "./bfApi/brainChats";
export type { BfBrainChat } from "./bfApi/brainChats";
// Side effect only: registers the "brain-turns" durable outbox with the dead-letter queue.
import "./bfApi/brainMessages";

// Platform runs, approvals and the live attention map.
export {
  BfDispatchError,
  getAttention,
  listHumanRequests,
  resolveHumanRequest,
  submitExecution,
} from "./bfApi/runtime";
export type {
  BfApproval,
  BfAttention,
  BfAttentionManager,
  BfAttentionState,
} from "./bfApi/runtime";

export { postActivitySignals } from "./bfApi/activitySignals";
export type { VsixActivitySignal } from "./bfApi/activitySignals";

export { getProjectDiagnostics, listSystemAudits, runAudit } from "./bfApi/diagnostics";
export type { BfProjectDiagnostic } from "./bfApi/diagnostics";

export { joinMeeting, listMeetings } from "./bfApi/meetings";
export type { BfMeetingDetail, BfMeetingJoin } from "./bfApi/meetings";

export { beginMcpOAuthConnect, createMcpExtension, listMcpExtensions } from "./bfApi/mcpExtensions";
export type { BfMcpExtension } from "./bfApi/mcpExtensions";

export { fetchPolicyGates, fetchRunContextSection } from "./bfApi/runContext";

export {
  listByoProviders,
  removeByoProvider,
  setByoProviderKey,
  testByoProvider,
} from "./bfApi/byoProviders";
export type { ByoProvider } from "./bfApi/byoProviders";
