/**
 * Client for BuilderForce's tenant APIs — a barrel over `./bfApi/`, one module per
 * domain, all sharing the single session + transport core (`session.ts`,
 * `transport.ts`). Callers keep importing from here; nothing is defined in this file.
 */

// Session: the key → tenant-JWT exchange, workspace scoping, sign-out.
export {
  boundToken,
  clearJwt,
  dropWorkspaceSelection,
  getTenantJwt,
  onEditorKeyRejected,
  onWorkspaceDropped,
  probeEditorKey,
  refreshTenantJwt,
  setSelectedWorkspace,
  signedInTenantId,
  workspaceTenantId,
} from "./session";

// Transport: the authenticated fetch every domain rides.
export { authed, authedRaw, fetchAuthed, isWorkspaceParked, WorkspaceParkedError } from "./transport";
export type { AuthedInit } from "./transport";

// Identity and workspaces.
export {
  activeWorkspaceManager,
  bindIdentityCache,
  canManageActiveWorkspace,
  createWorkspace,
  getCurrentUserId,
  getCurrentUserName,
  getCurrentWorkspace,
  listWorkspaces,
} from "./workspace";
export type { BfWorkspace } from "./workspace";

export { connect, diagnose } from "./connection";

// Projects, their Evermind head and shared facts.
export { createProject, listProjects } from "./projects";
export type { BfProject } from "./projects";
export {
  bfApiRequest,
  forgetProjectFact,
  getProjectEvermindHead,
  invalidateProjectEvermind,
  projectEvermindHooks,
  recallProjectFacts,
  rememberProjectFact,
} from "./projectMemory";

export { createCreationSession, listCreationSessions } from "./creationSessions";
export type { BfCreationSessionSummary } from "./creationSessions";

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
} from "./tasks";
export type { BfObjective, BfTask } from "./tasks";

// Brain chats and the turns written to them.
export {
  createBrainChat,
  deleteBrainChat,
  listAgentPool,
  listBrainChats,
  renameBrainChat,
  updateBrainChatProject,
} from "./brainChats";
export type { BfBrainChat } from "./brainChats";
// Side effect only: registers the "brain-turns" durable outbox with the dead-letter queue.
import "./brainMessages";

// Platform runs, approvals and the live attention map.
export {
  BfDispatchError,
  getAttention,
  listHumanRequests,
  resolveHumanRequest,
  submitExecution,
} from "./runtime";
export type {
  BfApproval,
  BfAttention,
  BfAttentionManager,
  BfAttentionState,
} from "./runtime";

export { postActivitySignals } from "./activitySignals";
export type { VsixActivitySignal } from "./activitySignals";

export { getProjectDiagnostics, listSystemAudits, runAudit } from "./diagnostics";
export type { BfProjectDiagnostic } from "./diagnostics";

export { joinMeeting, listMeetings } from "./meetings";
export type { BfMeetingDetail, BfMeetingJoin } from "./meetings";

export { beginMcpOAuthConnect, createMcpExtension, listMcpExtensions } from "./mcpExtensions";
export type { BfMcpExtension } from "./mcpExtensions";

export { fetchPolicyGates, fetchProjectShipPolicy, fetchRunContextSection } from "./runContext";

export {
  listByoProviders,
  removeByoProvider,
  setByoProviderKey,
  testByoProvider,
} from "./byoProviders";
export type { ByoProvider } from "./byoProviders";
