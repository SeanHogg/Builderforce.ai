/**
 * Client for BuilderForce's tenant APIs — a barrel over `./bfApi/`, one module per
 * domain, all sharing the single session + transport core (`session.ts`,
 * `transport.ts`). Callers keep importing from here; nothing is defined in this file.
 */
// Session: the key → tenant-JWT exchange, workspace scoping, sign-out.
export { boundToken, clearJwt, dropWorkspaceSelection, getTenantJwt, onEditorKeyRejected, onWorkspaceDropped, probeEditorKey, refreshTenantJwt, setSelectedWorkspace, signedInTenantId, workspaceTenantId, } from "./bfApi/session";
// Transport: the authenticated fetch every domain rides.
export { authed, authedRaw, fetchAuthed, isWorkspaceParked, WorkspaceParkedError } from "./bfApi/transport";
// Identity and workspaces.
export { activeWorkspaceManager, bindIdentityCache, canManageActiveWorkspace, createWorkspace, getCurrentUserId, getCurrentUserName, getCurrentWorkspace, listWorkspaces, } from "./bfApi/workspace";
export { connect, diagnose } from "./bfApi/connection";
// Projects, their Evermind head and shared facts.
export { createProject, listProjects } from "./bfApi/projects";
export { bfApiRequest, forgetProjectFact, getProjectEvermindHead, invalidateProjectEvermind, projectEvermindHooks, recallProjectFacts, rememberProjectFact, } from "./bfApi/projectMemory";
export { createCreationSession, listCreationSessions } from "./bfApi/creationSessions";
// The board: tickets and objectives.
export { convertTaskType, DEFAULT_HIDE_DONE, deleteTask, invalidateObjectives, invalidateTasks, listAssignedTasks, listClosedTasks, listProjectObjectives, listTasks, listTasksForReview, setTaskArchived, updateTaskStatus, } from "./bfApi/tasks";
// Brain chats and the turns written to them.
export { createBrainChat, deleteBrainChat, listAgentPool, listBrainChats, renameBrainChat, updateBrainChatProject, } from "./bfApi/brainChats";
// Side effect only: registers the "brain-turns" durable outbox with the dead-letter queue.
import "./bfApi/brainMessages";
// Platform runs, approvals and the live attention map.
export { BfDispatchError, getAttention, listHumanRequests, resolveHumanRequest, submitExecution, } from "./bfApi/runtime";
export { postActivitySignals } from "./bfApi/activitySignals";
export { getProjectDiagnostics, listSystemAudits, runAudit } from "./bfApi/diagnostics";
export { joinMeeting, listMeetings } from "./bfApi/meetings";
export { beginMcpOAuthConnect, createMcpExtension, listMcpExtensions } from "./bfApi/mcpExtensions";
export { fetchPolicyGates, fetchRunContextSection } from "./bfApi/runContext";
export { listByoProviders, removeByoProvider, setByoProviderKey, testByoProvider, } from "./bfApi/byoProviders";
//# sourceMappingURL=bfApi.js.map