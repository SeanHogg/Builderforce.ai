'use client';

/**
 * Platform capability manifest — the Brain's "MCP for everything" layer.
 *
 * Goal: make the Brain (on /brainstorm and the global floating drawer) the
 * epicenter for *every* action in the product. Every platform capability is
 * declared once here as a {@link PlatformCapability} that wraps the existing
 * typed API client (`@/lib/api` + `@/lib/builderforceApi`) — never a new HTTP
 * call. The manifest is the single source of truth.
 *
 * Exposure is two-tier so the always-sent tool list stays small and the model
 * stays accurate (the conversation hook sends ALL toolSpecs every request — a
 * flat list of ~100 tools would wreck selection accuracy and per-request cost):
 *
 *   Tier 1 — promoted core tools: the highest-frequency capabilities get a
 *            first-class, individually-described BrainAction (create_project,
 *            list_tasks, run_workflow, …) so the model calls them directly.
 *   Tier 2 — a generic dispatcher (`list_platform_capabilities` +
 *            `call_platform_capability`) that reaches EVERY remaining capability
 *            via discovery-then-call. This is what makes coverage exhaustive.
 *
 * Promoting a Tier-2 capability to Tier-1 later is a one-line `promote(...)`.
 * The same manifest can back a future first-party server-side MCP server.
 */

import {
  fetchProjects, fetchProject, createProject, updateProject, deleteProject,
  fetchFiles, fetchFileContent, saveFile, deleteFile,
  listAgents, fetchAgent, hireAgent,
  listMyAgents, listPurchasedAgents, createCloudAgent, updateAgent, deleteAgent,
  runArchitectureAnalysis,
} from '@/lib/api';
import {
  checkProjectKeyAvailable,
  brain,
  tasksApi, runtimeApi,
  workflows, workflowDefinitions,
  specsApi, approvalsApi,
  agentHosts, registeredAgents, projectAgents, agentAssignmentsApi,
  listMarketplaceSkills, artifactAssignments, agentHostSkillsApi, marketplaceStats,
  cronApi, integrationsApi, reposApi, boardConnectionsApi, boardsApi,
  channelsApi, workspaceApi, governanceApi, pokerApi, retroApi, analyticsApi,
  promptLibraryApi, tenantApiKeysApi, securityApi, mySessionsApi, embedApi,
  dashboardApi, llmApi, providerKeysApi, auditApi, dispatchApi,
  agentHostConfigApi, agentHostProjectsApi, chatSessionsApi, usageApi,
  alertsApi, decksApi, insightsApi,
} from '@/lib/builderforceApi';
import type { Task } from '@/lib/builderforceApi';
import { dashboardsApi } from '@/lib/dashboardsApi';
import type { BrainAction } from '@/lib/brain';
import { coerceFileContent } from '@/lib/fileContentGuard';
import { dispatchBrainDataChanged } from './brainDataEvent';

// ---------------------------------------------------------------------------
// Types + tiny JSON-Schema helpers (keep param specs terse)
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

export interface PlatformCapability {
  /** Capability area (≈ a platform page). */
  domain: string;
  /** Action within the domain. `domain.method` is globally unique. */
  method: string;
  description: string;
  /** JSON Schema for the call arguments. */
  parameters: Json;
  /** Write/side-effecting? Drives the confirm-before-mutate rule in the prompt. */
  mutates: boolean;
  run: (args: Json) => Promise<unknown> | unknown;
}

export interface PlatformActionContext {
  /** Router push (injected; the manifest never touches next/navigation). */
  navigate: (path: string) => void;
  /** Current workspace id (number) for tenant-scoped endpoints, or null. */
  getTenantId: () => number | null;
  /**
   * Capability domains relevant to where the user is right now (derived from the
   * route). Their list/get/create/update tools get promoted to first-class
   * BrainActions on top of the always-on core, so the Brain reaches for the most
   * likely tools without bloating the always-sent tool list. See
   * {@link focusDomainsForPath}.
   */
  focusDomains?: string[];
}

const S = { type: 'string' } as const;
const N = { type: 'number' } as const;
const B = { type: 'boolean' } as const;
const arr = (items: Json): Json => ({ type: 'array', items });
const obj = (properties: Json, required: string[] = []): Json => ({ type: 'object', properties, required });
const EMPTY = obj({});

/** Read a field off the loosely-typed args bag. */
function f<T = unknown>(args: Json, key: string): T {
  return args[key] as T;
}

/**
 * Narrow "did this write actually fail?" check for the data-changed gate. We
 * only announce a change when the call did NOT come back as a recoverable error
 * object (`{ ok:false }` / `{ error }`, e.g. the tenant guard). Deliberately
 * narrower than the triage report's `isFailedToolResult` (which regex-scans the
 * whole payload and would misfire on legit data containing the word "error").
 */
function isErrorResult(out: unknown): boolean {
  if (out == null || typeof out !== 'object') return false;
  const r = out as Record<string, unknown>;
  return r.ok === false || (typeof r.error === 'string' && r.error.length > 0);
}

/**
 * Build a partial-update capability whose patch body is whitelisted to exactly
 * the declared, non-identifier fields the model actually set.
 *
 * The schema's `required` keys ARE the record identifier(s) for every
 * update/patch action; everything else is the updatable body. The old
 * `a as Parameters<…>[1]` blind-forwarded the WHOLE args bag as the patch —
 * identifier included, plus any stray/hallucinated key — so a misfiring model
 * could overwrite a field it never meant to (e.g. write a new name onto an
 * "update the url" call). `run` gets the raw args (for the identifier) and the
 * sanitized `patch`.
 */
function updateCap(
  base: Omit<PlatformCapability, 'mutates' | 'run'>,
  run: (args: Json, patch: Json) => Promise<unknown> | unknown,
): PlatformCapability {
  const props = ((base.parameters as Json).properties ?? {}) as Json;
  const required = new Set(((base.parameters as Json).required as string[] | undefined) ?? []);
  const bodyKeys = Object.keys(props).filter((k) => !required.has(k));
  return {
    ...base,
    mutates: true,
    run: (a) => {
      const patch: Json = {};
      for (const k of bodyKeys) if (a[k] !== undefined) patch[k] = a[k];
      return run(a, patch);
    },
  };
}

// ---------------------------------------------------------------------------
// Navigation route table — every user-facing app page.
// ---------------------------------------------------------------------------

const STATIC_ROUTES: Record<string, string> = {
  dashboard: '/dashboard',
  projects: '/projects',
  ide: '/ide',
  ide_dashboard: '/ide/dashboard',
  brainstorm: '/brainstorm',
  tasks: '/projects?tab=tasks',
  workflows: '/workflows',
  workflow_builder: '/workflows/builder',
  workforce: '/workforce',
  agents: '/agents',
  agent_skills: '/agents/skills',
  agent_integrations: '/agents/integrations',
  agent_workflow_builder: '/agents/workflow-builder',
  marketplace: '/marketplace',
  skills: '/skills',
  personas: '/personas',
  prompts: '/prompts',
  models: '/models',
  approvals: '/workforce?tab=approvals',
  security: '/security',
  observability: '/workforce?tab=logs',
  timeline: '/workforce?tab=logs',
  logs: '/workforce?tab=logs',
  chats: '/workforce?tab=chats',
  contributors: '/workforce?tab=contributors',
  content_manager: '/content-manager',
  agent_worker: '/agent-worker',
  training: '/training',
  tenants: '/tenants',
  settings: '/settings',
  settings_members: '/workforce',
  settings_api_keys: '/settings/api-keys',
  compare: '/compare',
  pricing: '/pricing',
  product: '/product',
  admin: '/admin',
};

const DYNAMIC_ROUTES: Record<string, (id: string | number) => string> = {
  project: (id) => `/projects/${id}`,
  // The Tasks board scoped to one project — where a freshly-created task is
  // visible. NOT `/projects/{id}` (that redirects into the IDE).
  project_tasks: (id) => `/projects?tab=tasks&project=${id}`,
  ide_project: (id) => `/ide/${id}`,
  content_item: (id) => `/content-manager/${id}`,
  persona: (id) => `/personas/${id}`,
  skill: (id) => `/skills/${id}`,
};

const ALL_PAGE_KEYS = [...Object.keys(STATIC_ROUTES), ...Object.keys(DYNAMIC_ROUTES)];

/** Resolve a page key (+optional id/query) to a path, or an error object. */
function resolveRoute(page: string, id?: string | number, query?: string): string | { error: string } {
  let path: string | undefined;
  if (STATIC_ROUTES[page]) path = STATIC_ROUTES[page];
  else if (DYNAMIC_ROUTES[page]) {
    if (id == null || id === '') return { error: `Page "${page}" needs an id (e.g. the numeric project id).` };
    path = DYNAMIC_ROUTES[page](id);
  }
  if (!path) return { error: `Unknown page "${page}". Call list_platform_capabilities or use a known page key.` };
  return query ? `${path}?${String(query).replace(/^\?/, '')}` : path;
}

/** One assignable identity — a human teammate OR an agent. Humans and agents are
 *  one team, so each entry carries the SINGLE assignee field the Brain must set on
 *  tasks.create / tasks.update (the three id-spaces are disjoint, see taskAssignee.ts). */
type TaskAssignee =
  | { kind: 'human'; name: string; assignedUserId: string }
  | { kind: 'cloud_agent'; name: string; assignedAgentRef: string }
  | { kind: 'agent_host'; name: string; assignedAgentHostId: number };

/**
 * The FULL team a task can be assigned to — humans AND agents in one roster.
 *
 * The Brain resolves an assignee name (e.g. "Bob") through this single seam. Bob
 * may be a person, a cloud agent, or a self-hosted host; composing all three here
 * is why the Brain no longer mistakes a named cloud agent for "not on the team".
 * Reuses the human roster (tasks.assignees) and the workspace run-targets
 * (workflowDefinitions.runTargets already merges cloud agents + hosts, server-cached).
 */
async function listTaskAssignees(): Promise<TaskAssignee[]> {
  const [members, runTargets] = await Promise.all([
    tasksApi.assignees().catch(() => [] as { id: string; name: string }[]),
    workflowDefinitions.runTargets().catch(() => ({ hosts: [], cloudAgents: [] })),
  ]);
  return [
    ...members.map((m): TaskAssignee => ({ kind: 'human', name: m.name, assignedUserId: m.id })),
    ...runTargets.cloudAgents.map((a): TaskAssignee => ({ kind: 'cloud_agent', name: a.name, assignedAgentRef: a.ref })),
    ...runTargets.hosts.map((h): TaskAssignee => ({ kind: 'agent_host', name: h.name, assignedAgentHostId: h.id })),
  ];
}

/** Slim task projection sent to the model by tasks.list — the at-a-glance fields
 *  only, omitting the multi-KB `description` body (fetch it via tasks.get). */
export interface SlimTask {
  id: number;
  projectId: number;
  key: string;
  title: string;
  status: string;
  priority: Task['priority'];
  taskType: Task['taskType'];
  parentTaskId: number | null;
  sprintId: string | null;
  assignedUserId: string | null;
  assignedAgentRef: string | null;
  assignedAgentHostId: number | null;
  githubPrUrl: string | null;
  archived: boolean;
}

/** Project a full Task down to its {@link SlimTask} list shape. */
export function toSlimTask(t: Task): SlimTask {
  return {
    id: t.id,
    projectId: t.projectId,
    key: t.key,
    title: t.title,
    status: t.status,
    priority: t.priority,
    taskType: t.taskType,
    parentTaskId: t.parentTaskId,
    sprintId: t.sprintId,
    assignedUserId: t.assignedUserId,
    assignedAgentRef: t.assignedAgentRef,
    assignedAgentHostId: t.assignedAgentHostId,
    githubPrUrl: t.githubPrUrl,
    archived: t.archived,
  };
}

// ---------------------------------------------------------------------------
// The manifest. One entry per capability; run() wraps the existing client.
// ---------------------------------------------------------------------------

export function buildPlatformCapabilities(ctx: PlatformActionContext): PlatformCapability[] {
  /** Guard a tenant-scoped call: resolve the workspace id or return an error. */
  const tenant = <R>(fn: (tid: number) => R): R | { error: string } => {
    const tid = ctx.getTenantId();
    if (tid == null) return { error: 'No active workspace selected.' };
    return fn(tid);
  };

  const caps: PlatformCapability[] = [
    // ---- Projects --------------------------------------------------------
    { domain: 'projects', method: 'list', mutates: false, description: 'List all projects in the workspace.', parameters: EMPTY, run: () => fetchProjects() },
    { domain: 'projects', method: 'get', mutates: false, description: 'Get one project by id.', parameters: obj({ id: { ...N, description: 'Project id' } }, ['id']), run: (a) => fetchProject(f(a, 'id')) },
    { domain: 'projects', method: 'create', mutates: true, description: 'Create a new project. modality is the IDE type: designer (app builder), video, or llm.', parameters: obj({ name: S, description: S, template: S, modality: { type: 'string', enum: ['designer', 'video', 'llm'] } }, ['name']), run: (a) => createProject(a as Parameters<typeof createProject>[0]) },
    updateCap({ domain: 'projects', method: 'update', description: "Update a project's name/description/status/modality.", parameters: obj({ id: N, name: S, description: S, status: S, modality: S }, ['id']) }, (a, patch) => updateProject(f(a, 'id'), patch as Parameters<typeof updateProject>[1])),
    { domain: 'projects', method: 'delete', mutates: true, description: 'Delete a project permanently.', parameters: obj({ id: N }, ['id']), run: (a) => deleteProject(f(a, 'id')) },
    { domain: 'projects', method: 'check_key', mutates: false, description: 'Check whether a project key (prefix) is available.', parameters: obj({ key: S }, ['key']), run: (a) => checkProjectKeyAvailable(f(a, 'key')) },

    // ---- Project files ---------------------------------------------------
    { domain: 'project_files', method: 'list', mutates: false, description: 'List files in a project.', parameters: obj({ projectId: N }, ['projectId']), run: (a) => fetchFiles(f(a, 'projectId')) },
    { domain: 'project_files', method: 'read', mutates: false, description: 'Read a file’s content.', parameters: obj({ projectId: N, path: S }, ['projectId', 'path']), run: (a) => fetchFileContent(f(a, 'projectId'), f(a, 'path')) },
    { domain: 'project_files', method: 'save', mutates: true, description: 'Create or overwrite a project file.', parameters: obj({ projectId: N, path: S, content: S }, ['projectId', 'path', 'content']), run: (a) => saveFile(f(a, 'projectId'), f(a, 'path'), coerceFileContent(f(a, 'content'))) },
    { domain: 'project_files', method: 'delete', mutates: true, description: 'Delete a project file.', parameters: obj({ projectId: N, path: S }, ['projectId', 'path']), run: (a) => deleteFile(f(a, 'projectId'), f(a, 'path')) },

    // ---- Tasks (kanban) --------------------------------------------------
    // SLIM projection: the model only needs the at-a-glance fields to reason
    // about a backlog (id/key/title/status/priority/type/assignee/PR/archived).
    // The full Task body — notably the multi-KB `description` — is fetched on
    // demand via tasks.get, so a large active backlog no longer blows the
    // context window / token budget on a single list call (a real list result
    // was ~145k chars when every task's full body was returned verbatim).
    { domain: 'tasks', method: 'list', mutates: false, description: 'List tasks, optionally filtered by project. Returns a SLIM projection (id, key, title, status, priority, taskType, parentTaskId, assignee, PR link, archived) — call tasks.get for a single task’s full description/body.', parameters: obj({ projectId: N }), run: async (a) => (await tasksApi.list(f(a, 'projectId'))).map(toSlimTask) },
    { domain: 'tasks', method: 'get', mutates: false, description: 'Get a task by id.', parameters: obj({ id: N }, ['id']), run: (a) => tasksApi.get(f(a, 'id')) },
    { domain: 'tasks', method: 'create', mutates: true, description: 'Create a task on a project board. Set taskType="epic" to create a planning Epic (a container for other tasks), or pass parentTaskId to nest the new task under an existing Epic. Assign it by passing exactly one of: assignedUserId (a human member), assignedAgentRef (a cloud agent, e.g. one named "Bob") or assignedAgentHostId (a self-hosted agent host). Resolve ANY assignee name — person OR agent — with tasks.assignees, which returns the whole team and tells you which id field to set (humans and agents are one team).', parameters: obj({ projectId: N, title: S, description: S, priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] }, dueDate: S, taskType: { type: 'string', enum: ['task', 'epic'] }, parentTaskId: N, assignedUserId: S, assignedAgentRef: S, assignedAgentHostId: N }, ['projectId', 'title']), run: (a) => tasksApi.create(a as Parameters<typeof tasksApi.create>[0]) },
    updateCap({ domain: 'tasks', method: 'update', description: "Update a task. Link it under an Epic with parentTaskId (or null to detach), reclassify with taskType ('task'|'epic'), schedule into a sprint with sprintId, or (re)assign via exactly one of assignedUserId (human member; null unassigns), assignedAgentRef (cloud agent, e.g. one named 'Bob') or assignedAgentHostId (agent host) — resolve ANY assignee name, person OR agent, with tasks.assignees, which returns the whole team and the id field to set (humans and agents are one team). Also supports title, description, status/lane, priority, dueDate, archived.", parameters: obj({ id: N, title: S, description: S, status: S, priority: S, dueDate: S, archived: B, taskType: { type: 'string', enum: ['task', 'epic'] }, parentTaskId: { type: ['number', 'null'] }, sprintId: { type: ['string', 'null'] }, assignedUserId: { type: ['string', 'null'] }, assignedAgentRef: { type: ['string', 'null'] }, assignedAgentHostId: { type: ['number', 'null'] } }, ['id']) }, (a, patch) => tasksApi.update(f(a, 'id'), patch as Parameters<typeof tasksApi.update>[1])),
    { domain: 'tasks', method: 'delete', mutates: true, description: 'Delete a task.', parameters: obj({ id: N }, ['id']), run: (a) => tasksApi.delete(f(a, 'id')) },
    { domain: 'tasks', method: 'move', mutates: true, description: 'Move a task to another project board (re-keys it).', parameters: obj({ id: N, projectId: N }, ['id', 'projectId']), run: (a) => tasksApi.move(f(a, 'id'), f(a, 'projectId')) },
    { domain: 'tasks', method: 'assignees', mutates: false, description: 'List the FULL team a task can be assigned to — humans AND agents are one team. Each entry is { kind, name, …idField }: kind="human" carries assignedUserId; kind="cloud_agent" carries assignedAgentRef (a named cloud agent, e.g. "Bob"); kind="agent_host" carries assignedAgentHostId (a self-hosted runner). Resolve ANY assignee name here, then pass that ONE id field to tasks.create / tasks.update. A name that has no human match may well be an agent — check this roster before telling the user the person isn’t on the team.', parameters: EMPTY, run: () => listTaskAssignees() },

    // ---- Executions (runtime) -------------------------------------------
    { domain: 'executions', method: 'submit', mutates: true, description: 'Submit a task for agent execution (dispatches to an agent host or all connected hosts).', parameters: obj({ taskId: N, agentHostId: N, sessionId: S, payload: S }, ['taskId']), run: (a) => runtimeApi.submitExecution(a as Parameters<typeof runtimeApi.submitExecution>[0]) },
    { domain: 'executions', method: 'list_for_task', mutates: false, description: 'Execution history for a task.', parameters: obj({ taskId: N }, ['taskId']), run: (a) => runtimeApi.listForTask(f(a, 'taskId')) },
    { domain: 'executions', method: 'list_recent', mutates: false, description: 'Recent executions across the workspace.', parameters: obj({ limit: N }), run: (a) => runtimeApi.listRecent(f(a, 'limit') ?? 200) },
    { domain: 'executions', method: 'list_active', mutates: false, description: "What's running right now across the fleet.", parameters: EMPTY, run: () => runtimeApi.listActive() },
    { domain: 'executions', method: 'get', mutates: false, description: 'Get one execution.', parameters: obj({ id: N }, ['id']), run: (a) => runtimeApi.get(f(a, 'id')) },
    { domain: 'executions', method: 'trace', mutates: false, description: 'Execution trace: usage snapshots + tool-call audit.', parameters: obj({ id: N }, ['id']), run: (a) => runtimeApi.trace(f(a, 'id')) },
    { domain: 'executions', method: 'task_file_changes', mutates: false, description: 'Files an agent created/modified/deleted for a task.', parameters: obj({ taskId: N }, ['taskId']), run: (a) => runtimeApi.taskFileChanges(f(a, 'taskId')) },
    { domain: 'executions', method: 'cancel', mutates: true, description: 'Cancel a running/queued execution.', parameters: obj({ id: N }, ['id']), run: (a) => runtimeApi.cancel(f(a, 'id')) },
    { domain: 'executions', method: 'post_message', mutates: true, description: 'Send a follow-up direction to a running execution (steer it mid-run).', parameters: obj({ id: N, text: S }, ['id', 'text']), run: (a) => runtimeApi.postMessage(f(a, 'id'), f(a, 'text')) },

    // ---- Workflows -------------------------------------------------------
    { domain: 'workflows', method: 'list', mutates: false, description: 'List workflow definitions (the visually-authored agentic graphs).', parameters: EMPTY, run: () => workflowDefinitions.list() },
    { domain: 'workflows', method: 'get', mutates: false, description: 'Get a workflow definition (with its graph).', parameters: obj({ id: S }, ['id']), run: (a) => workflowDefinitions.get(f(a, 'id')) },
    { domain: 'workflows', method: 'runs', mutates: false, description: 'Run history for a workflow definition.', parameters: obj({ id: S }, ['id']), run: (a) => workflowDefinitions.runs(f(a, 'id')) },
    { domain: 'workflows', method: 'run_targets', mutates: false, description: 'Available run targets (agent hosts + cloud agents).', parameters: EMPTY, run: () => workflowDefinitions.runTargets() },
    { domain: 'workflows', method: 'triggers', mutates: false, description: 'Trigger activation state (webhook/schedule/rss/email) for a workflow.', parameters: obj({ id: S }, ['id']), run: (a) => workflowDefinitions.triggers(f(a, 'id')) },
    { domain: 'workflows', method: 'create', mutates: true, description: 'Create a workflow definition.', parameters: obj({ name: S, description: S, projectId: N }, ['name']), run: (a) => workflowDefinitions.create(a as Parameters<typeof workflowDefinitions.create>[0]) },
    updateCap({ domain: 'workflows', method: 'update', description: 'Update a workflow definition (name/description/project).', parameters: obj({ id: S, name: S, description: S, projectId: N }, ['id']) }, (a, patch) => workflowDefinitions.update(f(a, 'id'), patch as Parameters<typeof workflowDefinitions.update>[1])),
    { domain: 'workflows', method: 'remove', mutates: true, description: 'Delete a workflow definition.', parameters: obj({ id: S }, ['id']), run: (a) => workflowDefinitions.remove(f(a, 'id')) },
    { domain: 'workflows', method: 'run', mutates: true, description: 'Run a workflow on a target. runtime is "host" (pass agentHostId) or "cloud" (pass cloudAgentRef).', parameters: obj({ id: S, runtime: { type: 'string', enum: ['host', 'cloud'] }, agentHostId: N, cloudAgentRef: S }, ['id', 'runtime']), run: (a) => workflowDefinitions.run(f(a, 'id'), { runtime: f(a, 'runtime'), agentHostId: f(a, 'agentHostId') ?? null, cloudAgentRef: f(a, 'cloudAgentRef') ?? null }) },
    { domain: 'workflows', method: 'import_yaml', mutates: true, description: 'Create a workflow from a YAML/JSON document.', parameters: obj({ name: S, yaml: S }, ['name', 'yaml']), run: (a) => workflowDefinitions.importYaml(f(a, 'name'), f(a, 'yaml')) },
    { domain: 'workflow_runs', method: 'list', mutates: false, description: 'List workflow runs (executions), filterable by status/type/project.', parameters: obj({ status: S, workflowType: S, agentHostId: N, projectId: N }), run: (a) => workflows.list(a as Parameters<typeof workflows.list>[0]) },
    { domain: 'workflow_runs', method: 'get', mutates: false, description: 'Get a workflow run (with its tasks).', parameters: obj({ id: S }, ['id']), run: (a) => workflows.get(f(a, 'id')) },
    { domain: 'workflow_runs', method: 'graph', mutates: false, description: 'Get a workflow run’s node/edge graph for visualization.', parameters: obj({ id: S }, ['id']), run: (a) => workflows.getGraph(f(a, 'id')) },

    // ---- Specs / PRDs ----------------------------------------------------
    { domain: 'specs', method: 'list', mutates: false, description: 'List specs/PRDs, optionally by project.', parameters: obj({ projectId: N }), run: (a) => specsApi.list(f(a, 'projectId')) },
    { domain: 'specs', method: 'get', mutates: false, description: 'Get a spec by id.', parameters: obj({ id: S }, ['id']), run: (a) => specsApi.get(f(a, 'id')) },
    { domain: 'specs', method: 'create', mutates: true, description: 'Create a spec/PRD (goal + optional markdown PRD).', parameters: obj({ projectId: N, goal: S, prd: S, status: { type: 'string', enum: ['draft', 'ready', 'in_progress', 'complete'] } }, ['goal']), run: (a) => specsApi.create(a as Parameters<typeof specsApi.create>[0]) },
    updateCap({ domain: 'specs', method: 'patch', description: 'Update a spec (goal/status/prd).', parameters: obj({ id: S, goal: S, status: S, prd: S }, ['id']) }, (a, patch) => specsApi.patch(f(a, 'id'), patch as Parameters<typeof specsApi.patch>[1])),
    { domain: 'specs', method: 'delete', mutates: true, description: 'Delete a spec.', parameters: obj({ id: S }, ['id']), run: (a) => specsApi.delete(f(a, 'id')) },

    // ---- Approvals (human-in-the-loop) -----------------------------------
    { domain: 'approvals', method: 'list', mutates: false, description: 'List approval requests, optionally by status.', parameters: obj({ status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'expired'] }, agentHostId: N }), run: (a) => approvalsApi.list(a as Parameters<typeof approvalsApi.list>[0]) },
    { domain: 'approvals', method: 'get', mutates: false, description: 'Get an approval by id.', parameters: obj({ id: S }, ['id']), run: (a) => approvalsApi.get(f(a, 'id')) },
    { domain: 'approvals', method: 'decide', mutates: true, description: 'Approve or reject an approval request.', parameters: obj({ id: S, status: { type: 'string', enum: ['approved', 'rejected'] }, reviewNote: S }, ['id', 'status']), run: (a) => approvalsApi.decide(f(a, 'id'), { status: f(a, 'status'), reviewNote: f(a, 'reviewNote') }) },

    // ---- Workforce: published + cloud agents -----------------------------
    { domain: 'agents_published', method: 'list', mutates: false, description: 'List published workforce agents (marketplace registry).', parameters: EMPTY, run: () => listAgents() },
    { domain: 'agents_published', method: 'get', mutates: false, description: 'Get a published agent by id.', parameters: obj({ agentId: S }, ['agentId']), run: (a) => fetchAgent(f(a, 'agentId')) },
    { domain: 'agents_published', method: 'hire', mutates: true, description: 'Hire (acquire) a marketplace agent for this workspace.', parameters: obj({ agentId: S }, ['agentId']), run: (a) => hireAgent(f(a, 'agentId')) },
    { domain: 'cloud_agents', method: 'list_mine', mutates: false, description: "The workspace's own agents (any publish state).", parameters: EMPTY, run: () => listMyAgents() },
    { domain: 'cloud_agents', method: 'list_purchased', mutates: false, description: 'Agents acquired from the marketplace.', parameters: EMPTY, run: () => listPurchasedAgents() },
    { domain: 'cloud_agents', method: 'create', mutates: true, description: 'Create a cloud agent. engine: builderforce-v2 (Claude Agent SDK) or builderforce-v3 (V2 + limbic affective layer); V1 retired.', parameters: obj({ name: S, title: S, bio: S, skills: arr(S), baseModel: S, engine: { type: 'string', enum: ['builderforce-v2', 'builderforce-v3'] }, published: B }, ['name']), run: (a) => createCloudAgent(a as unknown as Parameters<typeof createCloudAgent>[0]) },
    updateCap({ domain: 'cloud_agents', method: 'update', description: 'Update a cloud agent (metadata or publish status).', parameters: obj({ agentId: S, name: S, title: S, bio: S, published: B, status: S }, ['agentId']) }, (a, patch) => updateAgent(f(a, 'agentId'), patch as Parameters<typeof updateAgent>[1])),
    { domain: 'cloud_agents', method: 'delete', mutates: true, description: 'Delete a cloud agent.', parameters: obj({ agentId: S }, ['agentId']), run: (a) => deleteAgent(f(a, 'agentId')) },

    // ---- Agent hosts (self-hosted runners) -------------------------------
    { domain: 'agent_hosts', method: 'list', mutates: false, description: 'List registered self-hosted agent hosts.', parameters: EMPTY, run: () => agentHosts.list() },
    { domain: 'agent_hosts', method: 'register', mutates: true, description: 'Register a new agent host (returns a one-time API key).', parameters: obj({ name: S }, ['name']), run: (a) => agentHosts.register(f(a, 'name')) },
    { domain: 'agent_hosts', method: 'deregister', mutates: true, description: 'Deregister an agent host (revokes its key).', parameters: obj({ agentHostId: N }, ['agentHostId']), run: (a) => agentHosts.deregister(f(a, 'agentHostId')) },
    { domain: 'agent_hosts', method: 'tool_audit', mutates: false, description: 'Tool-call audit events for an agent host.', parameters: obj({ agentHostId: N, runId: S, limit: N }, ['agentHostId']), run: (a) => agentHosts.toolAuditEvents(f(a, 'agentHostId'), a as Parameters<typeof agentHosts.toolAuditEvents>[1]) },
    { domain: 'agent_host_config', method: 'get', mutates: false, description: 'Get an agent host’s runtime config JSON.', parameters: obj({ agentHostId: N }, ['agentHostId']), run: (a) => agentHostConfigApi.get(f(a, 'agentHostId')) },
    { domain: 'agent_host_config', method: 'update', mutates: true, description: 'Replace an agent host’s runtime config JSON.', parameters: obj({ agentHostId: N, config: obj({}) }, ['agentHostId', 'config']), run: (a) => agentHostConfigApi.update(f(a, 'agentHostId'), f(a, 'config')) },
    { domain: 'agent_host_projects', method: 'list', mutates: false, description: 'Projects associated with an agent host.', parameters: obj({ agentHostId: N }, ['agentHostId']), run: (a) => agentHostProjectsApi.list(f(a, 'agentHostId')) },
    { domain: 'agent_host_projects', method: 'assign', mutates: true, description: 'Associate a project with an agent host.', parameters: obj({ agentHostId: N, projectId: N, role: S }, ['agentHostId', 'projectId']), run: (a) => agentHostProjectsApi.assign(f(a, 'agentHostId'), f(a, 'projectId'), f(a, 'role')) },
    { domain: 'agent_host_projects', method: 'unassign', mutates: true, description: 'Remove a project↔agent-host association.', parameters: obj({ agentHostId: N, projectId: N }, ['agentHostId', 'projectId']), run: (a) => agentHostProjectsApi.unassign(f(a, 'agentHostId'), f(a, 'projectId')) },
    { domain: 'dispatch', method: 'send', mutates: true, description: 'Send a command payload to an agent host via the relay.', parameters: obj({ agentHostId: N, payload: obj({}) }, ['agentHostId', 'payload']), run: (a) => dispatchApi.send(f(a, 'agentHostId'), f(a, 'payload')) },
    { domain: 'usage_snapshots', method: 'list', mutates: false, description: 'Token usage snapshots for an agent host.', parameters: obj({ agentHostId: N, limit: N }, ['agentHostId']), run: (a) => usageApi.list(f(a, 'agentHostId'), f(a, 'limit') ?? 50) },

    // ---- Agents: registered + per-project + assignments ------------------
    { domain: 'registered_agents', method: 'list', mutates: false, description: 'List tenant-registered endpoint agents (claude/openai/ollama/http).', parameters: EMPTY, run: () => registeredAgents.list() },
    { domain: 'project_agents', method: 'list', mutates: false, description: 'Agents attached to a project.', parameters: obj({ projectId: N }, ['projectId']), run: (a) => projectAgents.list(f(a, 'projectId')) },
    { domain: 'project_agents', method: 'add', mutates: true, description: 'Attach an agent to a project.', parameters: obj({ projectId: N, agentKind: { type: 'string', enum: ['workforce', 'registered'] }, agentRef: S, name: S, role: S }, ['projectId', 'agentKind', 'agentRef', 'name']), run: (a) => projectAgents.add(a as Parameters<typeof projectAgents.add>[0]) },
    { domain: 'project_agents', method: 'remove', mutates: true, description: 'Detach an agent from a project.', parameters: obj({ id: N }, ['id']), run: (a) => projectAgents.remove(f(a, 'id')) },
    { domain: 'agent_assignments', method: 'list', mutates: false, description: 'List agents assigned to a scope (project/workflow/security/swimlane/brain/global).', parameters: obj({ scope: S, scopeId: S }, ['scope']), run: (a) => agentAssignmentsApi.list(f(a, 'scope'), f(a, 'scopeId')) },
    { domain: 'agent_assignments', method: 'assign', mutates: true, description: 'Assign a registered agent to a scope.', parameters: obj({ agentKind: S, agentRef: S, scope: S, scopeId: S, role: S }, ['agentKind', 'agentRef', 'scope']), run: (a) => agentAssignmentsApi.assign(a as Parameters<typeof agentAssignmentsApi.assign>[0]) },
    { domain: 'agent_assignments', method: 'remove', mutates: true, description: 'Remove an agent assignment.', parameters: obj({ id: S }, ['id']), run: (a) => agentAssignmentsApi.remove(f(a, 'id')) },

    // ---- Skills + artifacts + marketplace --------------------------------
    { domain: 'skills_marketplace', method: 'list', mutates: false, description: 'Browse published marketplace skills (public).', parameters: obj({ category: S, q: S, page: N, limit: N }), run: (a) => listMarketplaceSkills(a as Parameters<typeof listMarketplaceSkills>[0]) },
    { domain: 'artifact_assignments', method: 'list', mutates: false, description: 'List artifacts (skill/persona/content) assigned to a scope.', parameters: obj({ scope: S, scopeId: N, artifactType: { type: 'string', enum: ['skill', 'persona', 'content'] } }, ['scope', 'scopeId']), run: (a) => artifactAssignments.list(f(a, 'scope'), f(a, 'scopeId'), f(a, 'artifactType')) },
    { domain: 'artifact_assignments', method: 'assign', mutates: true, description: 'Attach a skill/persona/content artifact to a scope.', parameters: obj({ artifactType: { type: 'string', enum: ['skill', 'persona', 'content'] }, artifactSlug: S, scope: S, scopeId: N, config: S }, ['artifactType', 'artifactSlug', 'scope', 'scopeId']), run: (a) => artifactAssignments.assign(f(a, 'artifactType'), f(a, 'artifactSlug'), f(a, 'scope'), f(a, 'scopeId'), f(a, 'config')) },
    { domain: 'artifact_assignments', method: 'unassign', mutates: true, description: 'Detach an artifact from a scope.', parameters: obj({ artifactType: S, artifactSlug: S, scope: S, scopeId: N }, ['artifactType', 'artifactSlug', 'scope', 'scopeId']), run: (a) => artifactAssignments.unassign(f(a, 'artifactType'), f(a, 'artifactSlug'), f(a, 'scope'), f(a, 'scopeId')) },
    { domain: 'agent_host_skills', method: 'list', mutates: false, description: 'Skills assigned to an agent host.', parameters: obj({ agentHostId: N }, ['agentHostId']), run: (a) => agentHostSkillsApi.list(f(a, 'agentHostId')) },
    { domain: 'agent_host_skills', method: 'assign', mutates: true, description: 'Assign a skill to an agent host.', parameters: obj({ agentHostId: N, skillSlug: S }, ['agentHostId', 'skillSlug']), run: (a) => agentHostSkillsApi.assignToAgentHost(f(a, 'agentHostId'), f(a, 'skillSlug')) },
    { domain: 'agent_host_skills', method: 'revoke', mutates: true, description: 'Revoke a skill assignment.', parameters: obj({ assignmentId: N }, ['assignmentId']), run: (a) => agentHostSkillsApi.revoke(f(a, 'assignmentId')) },
    { domain: 'marketplace_stats', method: 'get_stats', mutates: false, description: 'Likes/installs for artifacts.', parameters: obj({ type: { type: 'string', enum: ['skill', 'persona', 'content'] }, slugs: arr(S) }, ['type', 'slugs']), run: (a) => marketplaceStats.getStats(f(a, 'type'), f(a, 'slugs')) },
    { domain: 'marketplace_stats', method: 'toggle_like', mutates: true, description: 'Like/unlike an artifact.', parameters: obj({ type: S, artifactSlug: S }, ['type', 'artifactSlug']), run: (a) => marketplaceStats.toggleLike(f(a, 'type'), f(a, 'artifactSlug')) },

    // ---- Cron jobs -------------------------------------------------------
    { domain: 'cron', method: 'list', mutates: false, description: 'List cron jobs on an agent host.', parameters: obj({ agentHostId: N, projectId: N }, ['agentHostId']), run: (a) => cronApi.list(f(a, 'agentHostId'), f(a, 'projectId')) },
    { domain: 'cron', method: 'create', mutates: true, description: 'Create a cron job (name + cron schedule) on an agent host.', parameters: obj({ agentHostId: N, name: S, schedule: S, taskId: N, projectId: N, enabled: B }, ['agentHostId', 'name', 'schedule']), run: (a) => cronApi.create(f(a, 'agentHostId'), a as Parameters<typeof cronApi.create>[1]) },
    updateCap({ domain: 'cron', method: 'update', description: 'Update a cron job.', parameters: obj({ agentHostId: N, jobId: S, name: S, schedule: S, enabled: B }, ['agentHostId', 'jobId']) }, (a, patch) => cronApi.update(f(a, 'agentHostId'), f(a, 'jobId'), patch as Parameters<typeof cronApi.update>[2])),
    { domain: 'cron', method: 'delete', mutates: true, description: 'Delete a cron job.', parameters: obj({ agentHostId: N, jobId: S }, ['agentHostId', 'jobId']), run: (a) => cronApi.delete(f(a, 'agentHostId'), f(a, 'jobId')) },

    // ---- Integrations + repos + board connections ------------------------
    { domain: 'integrations', method: 'list', mutates: false, description: 'List integration credentials (GitHub/GitLab/Jira/etc). Secrets are never returned.', parameters: obj({ projectId: N }), run: (a) => integrationsApi.list(f(a, 'projectId') != null ? { projectId: f(a, 'projectId') } : undefined) },
    { domain: 'integrations', method: 'create', mutates: true, description: 'Store an integration credential.', parameters: obj({ provider: { type: 'string', enum: ['github', 'gitlab', 'bitbucket', 'jira', 'confluence', 'freshservice'] }, name: S, baseUrl: S, projectId: N, credentials: obj({}) }, ['provider', 'name', 'credentials']), run: (a) => integrationsApi.create(a as unknown as Parameters<typeof integrationsApi.create>[0]) },
    updateCap({ domain: 'integrations', method: 'update', description: 'Update an integration credential.', parameters: obj({ id: S, name: S, baseUrl: S, isEnabled: B }, ['id']) }, (a, patch) => integrationsApi.update(f(a, 'id'), patch as Parameters<typeof integrationsApi.update>[1])),
    { domain: 'integrations', method: 'remove', mutates: true, description: 'Delete an integration credential.', parameters: obj({ id: S }, ['id']), run: (a) => integrationsApi.remove(f(a, 'id')) },
    { domain: 'integrations', method: 'test', mutates: false, description: 'Test an integration connection.', parameters: obj({ id: S }, ['id']), run: (a) => integrationsApi.test(f(a, 'id')) },
    { domain: 'repos', method: 'list', mutates: false, description: 'List git repositories linked to a project.', parameters: obj({ projectId: N }, ['projectId']), run: (a) => reposApi.list(f(a, 'projectId')) },
    { domain: 'repos', method: 'add', mutates: true, description: 'Link a git repository to a project. Pass credentialId to bind an access key.', parameters: obj({ projectId: N, provider: S, owner: S, repo: S, defaultBranch: S, isDefault: B, credentialId: S }, ['projectId', 'provider', 'owner', 'repo']), run: (a) => reposApi.add(f(a, 'projectId'), a as unknown as Parameters<typeof reposApi.add>[1]) },
    updateCap({ domain: 'repos', method: 'update', description: 'Update a linked repository, including switching its bound access key (credentialId).', parameters: obj({ id: S, defaultBranch: S, isDefault: B, credentialId: S }, ['id']) }, (a, patch) => reposApi.update(f(a, 'id'), patch as Parameters<typeof reposApi.update>[1])),
    { domain: 'repos', method: 'set_default', mutates: true, description: 'Mark a repository as the project default.', parameters: obj({ id: S }, ['id']), run: (a) => reposApi.setDefault(f(a, 'id')) },
    { domain: 'repos', method: 'remove', mutates: true, description: 'Unlink a repository.', parameters: obj({ id: S }, ['id']), run: (a) => reposApi.remove(f(a, 'id')) },
    { domain: 'repos', method: 'list_pull_requests', mutates: false, description: 'List pull requests for a project.', parameters: obj({ projectId: N }, ['projectId']), run: (a) => reposApi.listPullRequests(f(a, 'projectId')) },
    { domain: 'board_connections', method: 'list', mutates: false, description: 'List external board connections (Jira/GitHub PM sync).', parameters: obj({ projectId: N }), run: (a) => boardConnectionsApi.list(f(a, 'projectId')) },
    { domain: 'board_connections', method: 'create', mutates: true, description: 'Create an external board connection.', parameters: obj({ projectId: N, provider: S, credentialId: S, externalBoardId: S }, ['projectId', 'provider']), run: (a) => boardConnectionsApi.create(a as unknown as Parameters<typeof boardConnectionsApi.create>[0]) },
    updateCap({ domain: 'board_connections', method: 'update', description: 'Update an external board connection.', parameters: obj({ id: S, status: S, externalBoardId: S }, ['id']) }, (a, patch) => boardConnectionsApi.update(f(a, 'id'), patch as Parameters<typeof boardConnectionsApi.update>[1])),
    { domain: 'board_connections', method: 'remove', mutates: true, description: 'Delete an external board connection.', parameters: obj({ id: S }, ['id']), run: (a) => boardConnectionsApi.remove(f(a, 'id')) },
    { domain: 'board_connections', method: 'sync', mutates: true, description: 'Trigger a sync for an external board connection.', parameters: obj({ id: S }, ['id']), run: (a) => boardConnectionsApi.sync(f(a, 'id')) },

    // ---- Autonomous boards + swimlanes -----------------------------------
    { domain: 'boards', method: 'list', mutates: false, description: 'List autonomous agent boards.', parameters: EMPTY, run: () => boardsApi.list() },
    { domain: 'boards', method: 'get', mutates: false, description: 'Get a board (with swimlanes).', parameters: obj({ boardId: S }, ['boardId']), run: (a) => boardsApi.get(f(a, 'boardId')) },
    { domain: 'boards', method: 'create', mutates: true, description: 'Find-or-create the autonomous board for a project (one board per project — returns the existing board if one already exists).', parameters: obj({ projectId: N, name: S, maxConcurrentTickets: N }, ['projectId', 'name']), run: (a) => boardsApi.create(a as Parameters<typeof boardsApi.create>[0]) },
    updateCap({ domain: 'boards', method: 'update', description: 'Update a board.', parameters: obj({ boardId: S, name: S, maxConcurrentTickets: N }, ['boardId']) }, (a, patch) => boardsApi.update(f(a, 'boardId'), patch as Parameters<typeof boardsApi.update>[1])),
    { domain: 'boards', method: 'remove', mutates: true, description: 'Delete a board.', parameters: obj({ boardId: S }, ['boardId']), run: (a) => boardsApi.remove(f(a, 'boardId')) },
    { domain: 'boards', method: 'dispatches', mutates: false, description: 'Live per-agent dispatch status across a board.', parameters: obj({ boardId: S }, ['boardId']), run: (a) => boardsApi.dispatches(f(a, 'boardId')) },
    { domain: 'swimlanes', method: 'list', mutates: false, description: 'List a board’s swimlanes.', parameters: obj({ boardId: S }, ['boardId']), run: (a) => boardsApi.swimlanes.list(f(a, 'boardId')) },
    { domain: 'swimlanes', method: 'create', mutates: true, description: 'Create a swimlane (stage) on a board.', parameters: obj({ boardId: S, key: S, name: S, position: N }, ['boardId', 'key', 'name']), run: (a) => boardsApi.swimlanes.create(f(a, 'boardId'), a as Parameters<typeof boardsApi.swimlanes.create>[1]) },
    { domain: 'swimlanes', method: 'remove', mutates: true, description: 'Delete a swimlane.', parameters: obj({ boardId: S, laneId: S }, ['boardId', 'laneId']), run: (a) => boardsApi.swimlanes.remove(f(a, 'boardId'), f(a, 'laneId')) },
    { domain: 'swimlane_agents', method: 'list', mutates: false, description: 'Agents assigned to a swimlane.', parameters: obj({ boardId: S, laneId: S }, ['boardId', 'laneId']), run: (a) => boardsApi.agents.list(f(a, 'boardId'), f(a, 'laneId')) },
    { domain: 'swimlane_agents', method: 'create', mutates: true, description: 'Assign an agent to a swimlane.', parameters: obj({ boardId: S, laneId: S, agentKind: { type: 'string', enum: ['workforce', 'registered'] }, agentRef: S, model: S }, ['boardId', 'laneId', 'agentKind', 'agentRef']), run: (a) => boardsApi.agents.create(f(a, 'boardId'), f(a, 'laneId'), a as Parameters<typeof boardsApi.agents.create>[2]) },
    { domain: 'swimlane_agents', method: 'remove', mutates: true, description: 'Unassign an agent from a swimlane.', parameters: obj({ boardId: S, laneId: S, id: S }, ['boardId', 'laneId', 'id']), run: (a) => boardsApi.agents.remove(f(a, 'boardId'), f(a, 'laneId'), f(a, 'id')) },

    // ---- Channels + workspace dirs ---------------------------------------
    { domain: 'channels', method: 'list', mutates: false, description: 'List messaging channels on an agent host.', parameters: obj({ agentHostId: N }, ['agentHostId']), run: (a) => channelsApi.list(f(a, 'agentHostId')) },
    { domain: 'channels', method: 'create', mutates: true, description: 'Create a messaging channel (whatsapp/telegram/slack/discord/teams/webhook…).', parameters: obj({ agentHostId: N, platform: S, name: S, config: S, enabled: B }, ['agentHostId', 'platform', 'name']), run: (a) => channelsApi.create(f(a, 'agentHostId'), a as Parameters<typeof channelsApi.create>[1]) },
    updateCap({ domain: 'channels', method: 'update', description: 'Update a messaging channel.', parameters: obj({ agentHostId: N, channelId: S, name: S, enabled: B }, ['agentHostId', 'channelId']) }, (a, patch) => channelsApi.update(f(a, 'agentHostId'), f(a, 'channelId'), patch as Parameters<typeof channelsApi.update>[2])),
    { domain: 'channels', method: 'delete', mutates: true, description: 'Delete a messaging channel.', parameters: obj({ agentHostId: N, channelId: S }, ['agentHostId', 'channelId']), run: (a) => channelsApi.delete(f(a, 'agentHostId'), f(a, 'channelId')) },
    { domain: 'workspace', method: 'list_directories', mutates: false, description: 'List synced directories on an agent host.', parameters: obj({ agentHostId: N }, ['agentHostId']), run: (a) => workspaceApi.listDirectories(f(a, 'agentHostId')) },
    { domain: 'workspace', method: 'list_files', mutates: false, description: 'List files in a synced directory.', parameters: obj({ agentHostId: N, directoryId: N }, ['agentHostId', 'directoryId']), run: (a) => workspaceApi.listFiles(f(a, 'agentHostId'), f(a, 'directoryId')) },
    { domain: 'workspace', method: 'trigger_sync', mutates: true, description: 'Trigger a directory re-sync on an agent host.', parameters: obj({ agentHostId: N, directoryId: N }, ['agentHostId', 'directoryId']), run: (a) => workspaceApi.triggerSync(f(a, 'agentHostId'), f(a, 'directoryId')) },

    // ---- Governance (SOC 2) ----------------------------------------------
    { domain: 'governance_soc2', method: 'list_controls', mutates: false, description: 'List SOC 2 controls and their status.', parameters: EMPTY, run: () => governanceApi.soc2.listControls() },
    { domain: 'governance_soc2', method: 'seed', mutates: true, description: 'Seed the SOC 2 control set.', parameters: EMPTY, run: () => governanceApi.soc2.seed() },
    updateCap({ domain: 'governance_soc2', method: 'patch_control', description: 'Update a SOC 2 control (status/owner/notes).', parameters: obj({ id: S, status: { type: 'string', enum: ['not_started', 'in_progress', 'ready', 'out_of_scope'] }, notes: S }, ['id']) }, (a, patch) => governanceApi.soc2.patchControl(f(a, 'id'), patch as Parameters<typeof governanceApi.soc2.patchControl>[1])),
    { domain: 'governance_soc2', method: 'add_evidence', mutates: true, description: 'Attach evidence to a SOC 2 control.', parameters: obj({ id: S, title: S, evidenceType: S, url: S, note: S }, ['id', 'title', 'evidenceType']), run: (a) => governanceApi.soc2.addEvidence(f(a, 'id'), a as Parameters<typeof governanceApi.soc2.addEvidence>[1]) },

    // ---- Agile: planning poker + retrospectives --------------------------
    { domain: 'poker', method: 'list_sessions', mutates: false, description: 'List planning-poker sessions.', parameters: EMPTY, run: () => pokerApi.listSessions() },
    { domain: 'poker', method: 'create_session', mutates: true, description: 'Create a planning-poker session.', parameters: obj({ name: S, votingSystem: S }, ['name']), run: (a) => pokerApi.createSession(f(a, 'name'), f(a, 'votingSystem')) },
    { domain: 'poker', method: 'get_session', mutates: false, description: 'Get a poker session (with stories).', parameters: obj({ id: S }, ['id']), run: (a) => pokerApi.getSession(f(a, 'id')) },
    { domain: 'poker', method: 'add_story', mutates: true, description: 'Add a story to a poker session.', parameters: obj({ sessionId: S, title: S, description: S }, ['sessionId', 'title']), run: (a) => pokerApi.addStory(f(a, 'sessionId'), f(a, 'title'), f(a, 'description')) },
    { domain: 'poker', method: 'vote', mutates: true, description: 'Cast a vote on a story.', parameters: obj({ storyId: S, value: S }, ['storyId', 'value']), run: (a) => pokerApi.vote(f(a, 'storyId'), f(a, 'value')) },
    { domain: 'poker', method: 'reveal', mutates: true, description: 'Reveal votes on a story.', parameters: obj({ storyId: S }, ['storyId']), run: (a) => pokerApi.reveal(f(a, 'storyId')) },
    { domain: 'retro', method: 'list', mutates: false, description: 'List retrospectives.', parameters: EMPTY, run: () => retroApi.list() },
    { domain: 'retro', method: 'create', mutates: true, description: 'Create a retrospective.', parameters: obj({ name: S, template: S }, ['name']), run: (a) => retroApi.create(f(a, 'name'), f(a, 'template')) },
    { domain: 'retro', method: 'get', mutates: false, description: 'Get a retrospective (with items).', parameters: obj({ id: S }, ['id']), run: (a) => retroApi.get(f(a, 'id')) },
    { domain: 'retro', method: 'add_item', mutates: true, description: 'Add an item to a retrospective.', parameters: obj({ retroId: S, category: S, content: S }, ['retroId', 'category', 'content']), run: (a) => retroApi.addItem(f(a, 'retroId'), f(a, 'category'), f(a, 'content')) },

    // ---- Prompt library --------------------------------------------------
    { domain: 'prompts', method: 'browse_public', mutates: false, description: 'Browse the public prompt gallery.', parameters: obj({ q: S, category: S, sort: { type: 'string', enum: ['popular', 'recent', 'featured'] } }), run: (a) => promptLibraryApi.browsePublic(a as Parameters<typeof promptLibraryApi.browsePublic>[0]) },
    { domain: 'prompts', method: 'list', mutates: false, description: 'List the workspace’s prompts.', parameters: EMPTY, run: () => promptLibraryApi.list() },
    { domain: 'prompts', method: 'get', mutates: false, description: 'Get a prompt by id.', parameters: obj({ id: S }, ['id']), run: (a) => promptLibraryApi.get(f(a, 'id')) },
    { domain: 'prompts', method: 'create', mutates: true, description: 'Create a prompt template.', parameters: obj({ title: S, body: S, description: S, category: S, visibility: { type: 'string', enum: ['private', 'tenant', 'public'] } }, ['title', 'body']), run: (a) => promptLibraryApi.create(a as unknown as Parameters<typeof promptLibraryApi.create>[0]) },
    updateCap({ domain: 'prompts', method: 'update', description: 'Update a prompt’s metadata.', parameters: obj({ id: S, title: S, description: S, visibility: S }, ['id']) }, (a, patch) => promptLibraryApi.update(f(a, 'id'), patch as Parameters<typeof promptLibraryApi.update>[1])),
    { domain: 'prompts', method: 'add_version', mutates: true, description: 'Add a new version to a prompt.', parameters: obj({ id: S, body: S, notes: S }, ['id', 'body']), run: (a) => promptLibraryApi.addVersion(f(a, 'id'), a as Parameters<typeof promptLibraryApi.addVersion>[1]) },
    { domain: 'prompts', method: 'remove', mutates: true, description: 'Delete a prompt.', parameters: obj({ id: S }, ['id']), run: (a) => promptLibraryApi.remove(f(a, 'id')) },

    // ---- Analytics + architecture analysis -------------------------------
    { domain: 'analytics', method: 'activity_calendar', mutates: false, description: 'Contributor activity calendar (humans + AI agents).', parameters: obj({ from: S, to: S, contributorId: N }), run: (a) => analyticsApi.activityCalendar(a as Parameters<typeof analyticsApi.activityCalendar>[0]) },
    { domain: 'analytics', method: 'sync_agents', mutates: true, description: 'Refresh AI-agent contributor data.', parameters: EMPTY, run: () => analyticsApi.syncAgents() },
    { domain: 'repo_analysis', method: 'start', mutates: true, description: 'Run the Architect: create an architecture-analysis task on a project and start it. The result is written back as a PRD. Requires a repo mapped to the project.', parameters: obj({ projectId: N }, ['projectId']), run: (a) => runArchitectureAnalysis(f(a, 'projectId')) },

    // ---- Brain chats + agent-host chat sessions --------------------------
    { domain: 'brain', method: 'list', mutates: false, description: 'List Brain chats, optionally filtered by project.', parameters: obj({ projectId: S, limit: N }), run: (a) => brain.listChats(a as Parameters<typeof brain.listChats>[0]) },
    { domain: 'brain', method: 'create', mutates: true, description: 'Create a new Brain chat.', parameters: obj({ title: S, projectId: N }), run: (a) => brain.createChat(a as Parameters<typeof brain.createChat>[0]) },
    updateCap({ domain: 'brain', method: 'update', description: 'Rename a Brain chat or move it to a project.', parameters: obj({ id: N, title: S, projectId: N }, ['id']) }, (a, patch) => brain.updateChat(f(a, 'id'), patch as Parameters<typeof brain.updateChat>[1])),
    { domain: 'brain', method: 'delete', mutates: true, description: 'Archive a Brain chat.', parameters: obj({ id: N }, ['id']), run: (a) => brain.deleteChat(f(a, 'id')) },
    { domain: 'brain', method: 'summarize', mutates: true, description: 'Summarize a Brain chat and store the summary.', parameters: obj({ chatId: N }, ['chatId']), run: (a) => brain.summarizeChat(f(a, 'chatId')) },
    { domain: 'chat_sessions', method: 'list', mutates: false, description: 'List chat sessions on an agent host.', parameters: obj({ agentHostId: N }, ['agentHostId']), run: (a) => chatSessionsApi.list(f(a, 'agentHostId')) },
    { domain: 'chat_sessions', method: 'list_all', mutates: false, description: 'Recent chat sessions across the workspace.', parameters: obj({ limit: N }), run: (a) => chatSessionsApi.listAll(f(a, 'limit') ?? 100) },
    { domain: 'chat_sessions', method: 'get_messages', mutates: false, description: 'Messages in a chat session.', parameters: obj({ sessionId: S, limit: N }, ['sessionId']), run: (a) => chatSessionsApi.getMessages(f(a, 'sessionId'), f(a, 'limit') ?? 100) },

    // ---- LLM / usage / provider keys -------------------------------------
    { domain: 'llm', method: 'usage', mutates: false, description: 'Token usage stats for the workspace.', parameters: EMPTY, run: () => llmApi.usage() },
    { domain: 'llm', method: 'health', mutates: false, description: 'Model availability + per-model cooldowns.', parameters: EMPTY, run: () => llmApi.health() },
    { domain: 'llm', method: 'models', mutates: false, description: 'Available models for the workspace plan.', parameters: EMPTY, run: () => llmApi.models() },
    { domain: 'dashboard', method: 'usage', mutates: false, description: 'Token + cost usage split by source (cloud/on-prem/web), and by user/team/repo/project.', parameters: obj({ window: { type: 'string', enum: ['today', 'week', 'month'] } }), run: (a) => dashboardApi.usage(f(a, 'window') ?? 'week') },

    // ---- Saved dashboards (custom widget layouts over whitelisted metrics) ----
    { domain: 'dashboards', method: 'list', mutates: false, description: 'List the workspace’s saved dashboards (with their widgets).', parameters: EMPTY, run: () => dashboardsApi.list() },
    { domain: 'dashboards', method: 'metrics', mutates: false, description: 'List the whitelisted metric keys a dashboard widget can chart.', parameters: EMPTY, run: () => dashboardsApi.metrics() },
    { domain: 'dashboards', method: 'create', mutates: true, description: 'Create a saved dashboard.', parameters: obj({ name: S, isDefault: B }, ['name']), run: (a) => dashboardsApi.create(f(a, 'name'), f(a, 'isDefault') ?? false) },
    { domain: 'dashboards', method: 'update', mutates: true, description: 'Rename a dashboard or set it as the default.', parameters: obj({ id: N, name: S, isDefault: B }, ['id']), run: (a) => dashboardsApi.update(f(a, 'id'), { name: f(a, 'name'), isDefault: f(a, 'isDefault') }) },
    { domain: 'dashboards', method: 'delete', mutates: true, description: 'Delete a saved dashboard (and its widgets).', parameters: obj({ id: N }, ['id']), run: (a) => dashboardsApi.remove(f(a, 'id')) },
    { domain: 'dashboards', method: 'add_widget', mutates: true, description: 'Add a widget charting a whitelisted metric (see dashboards.metrics) to a dashboard. viz: stat|bar|line|gauge.', parameters: obj({ dashboardId: N, metricKey: S, viz: { type: 'string', enum: ['stat', 'bar', 'line', 'gauge'] }, title: S, position: N }, ['dashboardId', 'metricKey']), run: (a) => dashboardsApi.addWidget(f(a, 'dashboardId'), { metricKey: f(a, 'metricKey'), viz: f(a, 'viz'), title: f(a, 'title'), position: f(a, 'position') }) },
    { domain: 'dashboards', method: 'update_widget', mutates: true, description: 'Update a dashboard widget (metric, viz, title or position).', parameters: obj({ dashboardId: N, widgetId: N, metricKey: S, viz: { type: 'string', enum: ['stat', 'bar', 'line', 'gauge'] }, title: S, position: N }, ['dashboardId', 'widgetId']), run: (a) => dashboardsApi.updateWidget(f(a, 'dashboardId'), f(a, 'widgetId'), { metricKey: f(a, 'metricKey'), viz: f(a, 'viz'), title: f(a, 'title'), position: f(a, 'position') }) },
    { domain: 'dashboards', method: 'remove_widget', mutates: true, description: 'Remove a widget from a dashboard.', parameters: obj({ dashboardId: N, widgetId: N }, ['dashboardId', 'widgetId']), run: (a) => dashboardsApi.removeWidget(f(a, 'dashboardId'), f(a, 'widgetId')) },
    { domain: 'dashboards', method: 'data', mutates: false, description: 'Resolve every widget on a dashboard to its current value.', parameters: obj({ dashboardId: N }, ['dashboardId']), run: (a) => dashboardsApi.data(f(a, 'dashboardId')) },
    { domain: 'dashboards', method: 'query', mutates: false, description: 'Ask a natural-language question; it is mapped deterministically to one whitelisted metric and answered.', parameters: obj({ question: S }, ['question']), run: (a) => dashboardsApi.query(f(a, 'question')) },
    { domain: 'provider_keys', method: 'list', mutates: false, description: 'Which LLM providers the workspace has a key configured for.', parameters: EMPTY, run: () => providerKeysApi.list() },
    { domain: 'provider_keys', method: 'remove', mutates: true, description: 'Remove a stored provider key.', parameters: obj({ provider: { type: 'string', enum: ['anthropic'] } }, ['provider']), run: (a) => providerKeysApi.remove(f(a, 'provider')) },

    // ---- Audit + embed ---------------------------------------------------
    { domain: 'audit', method: 'list', mutates: false, description: 'List audit events for the workspace.', parameters: obj({ limit: N, eventType: S, resourceType: S }), run: (a) => auditApi.list(a as Parameters<typeof auditApi.list>[0]) },
    { domain: 'embed', method: 'get_config', mutates: false, description: 'Get the workspace embed configuration.', parameters: EMPTY, run: () => embedApi.getConfig() },
    { domain: 'embed', method: 'set_config', mutates: true, description: 'Enable/disable embed + set capabilities.', parameters: obj({ enabled: B, capabilities: arr({ type: 'string', enum: ['product', 'agile', 'security'] }), consentAcknowledged: B }, ['enabled', 'capabilities']), run: (a) => embedApi.setConfig(a as Parameters<typeof embedApi.setConfig>[0]) },

    // ---- My sessions -----------------------------------------------------
    { domain: 'my_sessions', method: 'list', mutates: false, description: 'List the current user’s active sessions.', parameters: EMPTY, run: () => mySessionsApi.list() },
    { domain: 'my_sessions', method: 'revoke', mutates: true, description: 'Revoke one of my sessions.', parameters: obj({ sessionId: S }, ['sessionId']), run: (a) => mySessionsApi.revoke(f(a, 'sessionId')) },
    { domain: 'my_sessions', method: 'revoke_others', mutates: true, description: 'Revoke all of my other sessions.', parameters: EMPTY, run: () => mySessionsApi.revokeOthers() },

    // ---- Tenant-scoped: security + API keys ------------------------------
    { domain: 'security', method: 'list_users', mutates: false, description: 'List workspace members and their session/token counts.', parameters: EMPTY, run: () => tenant((tid) => securityApi.listUsers(tid)) },
    { domain: 'security', method: 'get_user', mutates: false, description: 'Get a member’s active sessions.', parameters: obj({ userId: S }, ['userId']), run: (a) => tenant((tid) => securityApi.getUser(tid, f(a, 'userId'))) },
    { domain: 'security', method: 'revoke_all_sessions', mutates: true, description: 'Log a member out of all sessions.', parameters: obj({ userId: S }, ['userId']), run: (a) => tenant((tid) => securityApi.revokeAllSessions(tid, f(a, 'userId'))) },
    { domain: 'api_keys', method: 'list', mutates: false, description: 'List the workspace’s gateway API keys (bfk_*).', parameters: EMPTY, run: () => tenant((tid) => tenantApiKeysApi.list(tid)) },
    { domain: 'api_keys', method: 'mint', mutates: true, description: 'Mint a new gateway API key. The raw key is returned once — show it carefully.', parameters: obj({ name: S, allowedOrigins: arr(S) }, ['name']), run: (a) => tenant((tid) => tenantApiKeysApi.mint(tid, a as unknown as Parameters<typeof tenantApiKeysApi.mint>[1])) },
    { domain: 'api_keys', method: 'revoke', mutates: true, description: 'Revoke a gateway API key.', parameters: obj({ keyId: S }, ['keyId']), run: (a) => tenant((tid) => tenantApiKeysApi.revoke(tid, f(a, 'keyId'))) },

    // ---- Alerts (threshold alert rules on platform metrics) --------------
    { domain: 'alerts', method: 'list', mutates: false, description: 'List threshold alert rules defined on platform metrics.', parameters: EMPTY, run: () => alertsApi.list() },
    {
      domain: 'alerts', method: 'create', mutates: true,
      description: 'Create a threshold alert rule. The rule fires when the metric, measured over windowDays, satisfies comparator vs threshold. metric is one of: token_spend_usd, token_spend_pct_of_cap, cost_per_merged_pr_usd, dora_change_failure_rate, dora_lead_time_hours, ai_effectiveness_score, eval_drift. comparator is gt|lt|gte|lte. scopeKind is tenant|project|team. The daily sweep notifies via Slack/email when it trips.',
      parameters: obj({
        name: S,
        metric: { type: 'string', enum: ['token_spend_usd', 'token_spend_pct_of_cap', 'cost_per_merged_pr_usd', 'dora_change_failure_rate', 'dora_lead_time_hours', 'ai_effectiveness_score', 'eval_drift'] },
        comparator: { type: 'string', enum: ['gt', 'lt', 'gte', 'lte'] },
        threshold: N, windowDays: N,
        scopeKind: { type: 'string', enum: ['tenant', 'project', 'team'] },
        notifySlack: B, notifyEmail: B,
      }, ['name', 'metric', 'comparator', 'threshold']),
      run: (a) => alertsApi.create(a as Parameters<typeof alertsApi.create>[0]),
    },
    updateCap({
      domain: 'alerts', method: 'update',
      description: 'Update an alert rule (toggle enabled, change threshold/comparator/metric/window/scope/notify channels).',
      parameters: obj({
        id: S, name: S,
        metric: { type: 'string', enum: ['token_spend_usd', 'token_spend_pct_of_cap', 'cost_per_merged_pr_usd', 'dora_change_failure_rate', 'dora_lead_time_hours', 'ai_effectiveness_score', 'eval_drift'] },
        comparator: { type: 'string', enum: ['gt', 'lt', 'gte', 'lte'] },
        threshold: N, windowDays: N,
        scopeKind: { type: 'string', enum: ['tenant', 'project', 'team'] },
        notifySlack: B, notifyEmail: B, enabled: B, cooldownHours: N,
      }, ['id']),
    }, (a, patch) => alertsApi.update(f(a, 'id'), patch as Parameters<typeof alertsApi.update>[1])),
    { domain: 'alerts', method: 'delete', mutates: true, description: 'Delete an alert rule.', parameters: obj({ id: S }, ['id']), run: (a) => alertsApi.remove(f(a, 'id')) },
    { domain: 'alerts', method: 'events', mutates: false, description: 'List recent alert firings (events), optionally filtered by status (triggered|acknowledged|resolved).', parameters: obj({ limit: N, status: { type: 'string', enum: ['triggered', 'acknowledged', 'resolved'] } }), run: (a) => alertsApi.listEvents({ limit: f(a, 'limit') ?? undefined, status: f(a, 'status') ?? undefined }) },
    { domain: 'alerts', method: 'acknowledge', mutates: true, description: 'Acknowledge an alert firing (event).', parameters: obj({ id: S }, ['id']), run: (a) => alertsApi.ackEvent(f(a, 'id')) },

    // ---- Decks (board / CFO PowerPoint generation) -----------------------
    { domain: 'decks', method: 'list_templates', mutates: false, description: 'List available deck templates: the built-in R&D board deck and CFO/DevFinOps deck, plus any custom .pptx templates this workspace has uploaded. Each has an id, name and whether it is "fillable" (a custom uploaded .pptx that can be filled in place).', parameters: EMPTY, run: () => decksApi.listTemplates() },
    { domain: 'decks', method: 'generate', mutates: true, description: 'Generate a Builderforce-branded board deck (PowerPoint) from this workspace\'s real data and return a download link. Use templateId from decks.list_templates to pick the board deck (default) or the CFO/DevFinOps deck; quarter is e.g. "2026-Q2" (defaults to the current quarter). Returns { deckId, downloadUrl, filename, warnings } — surface the downloadUrl to the user. warnings lists any board fields with no data yet.', parameters: obj({ templateId: S, quarter: S, prompt: S }), run: (a) => decksApi.generate({ mode: 'generative', templateId: f(a, 'templateId') ?? undefined, quarter: f(a, 'quarter') ?? undefined, prompt: f(a, 'prompt') ?? undefined }) },
    { domain: 'decks', method: 'fill_template', mutates: true, description: 'Fill an UPLOADED custom .pptx template (templateId from decks.list_templates where fillable=true) IN PLACE with this workspace\'s data, preserving the original design. Use this when the user uploaded their own board/CFO template and wants it populated. quarter defaults to the current quarter. Returns { deckId, downloadUrl, filename, warnings }.', parameters: obj({ templateId: S, quarter: S }, ['templateId']), run: (a) => decksApi.generate({ mode: 'fill', templateId: f(a, 'templateId'), quarter: f(a, 'quarter') ?? undefined }) },
    { domain: 'decks', method: 'promote_template', mutates: true, description: 'Promote a .pptx the user already uploaded (via the Brain file upload — pass its storage key as sourceKey) into a reusable custom deck template. Returns the new template id and the {{tokens}} found in the file. Author tokens like {{quarter}}, {{uptime}}, {{table:deliverables}} in the .pptx and they fill from workspace data.', parameters: obj({ name: S, description: S, sourceKey: S }, ['name', 'sourceKey']), run: (a) => decksApi.promoteTemplate({ name: f(a, 'name'), description: f(a, 'description') ?? undefined, sourceKey: f(a, 'sourceKey') }) },

    // ---- Board data import (bulk entry for manual board-deck datasets) ----
    { domain: 'board_data', method: 'import_datasets', mutates: false, description: 'List the board-deck datasets that can be BULK-IMPORTED and their column specs (name/type/required). Datasets: headcount-events, positions, rd-financials, rd-revenue, rd-fte, support-tickets, incidents, uptime, ai-tool-adoption, ai-programs. Use this to learn the columns before board_data.import.', parameters: EMPTY, run: () => insightsApi.importDatasets() },
    { domain: 'board_data', method: 'import', mutates: true, description: 'Bulk-import rows into a board-deck dataset (e.g. headcount-events, rd-financials, support-tickets) for the board/CFO deck. `rows` is an array of objects whose keys match the dataset columns (call board_data.import_datasets for the spec). Returns { inserted, skipped, errors }. Use for loading a quarter of headcount, R&D spend, or support data at once when there is no live connector.', parameters: obj({ dataset: S, rows: { type: 'array', items: { type: 'object' }, description: 'Row objects keyed by column name.' } }, ['dataset', 'rows']), run: (a) => insightsApi.importBoardData(f(a, 'dataset'), (f(a, 'rows') as Array<Record<string, unknown>>) ?? []) },
  ];

  // Announce every successful write on the brain-data bus so the page rendering
  // that domain (e.g. the Tasks board) refetches live instead of going stale
  // until a manual reload. Wrapping `run` here covers BOTH the Tier-1 promoted
  // tools and the Tier-2 dispatcher, since both ultimately call `cap.run`.
  //
  // `create` also gets an idempotency guard: the Brain occasionally emits the
  // SAME create tool-call twice in one turn (it "plans" a ticket, then "creates
  // the right ticket"), which spawned duplicate tasks. Collapsing an identical
  // create (same domain + args) within a short window to the first call's
  // promise means a double-fire can't double-write. This is a request-dedupe
  // guard, NOT a data cache — successful results are not retained past the
  // window and errors are dropped immediately so a genuine retry isn't blocked.
  for (const c of caps) {
    if (!c.mutates) continue;
    const inner = c.run;
    const announce = (out: unknown) => {
      if (!isErrorResult(out)) dispatchBrainDataChanged({ domain: c.domain, method: c.method });
    };
    if (c.method === 'create') {
      c.run = (args: Json) => {
        const key = `${ctx.getTenantId() ?? 'none'}:${c.domain}:${stableStringify(args)}`;
        const now = nowMs();
        const prior = recentCreates.get(key);
        if (prior && now - prior.at < CREATE_DEDUPE_MS) return prior.result;
        const result = (async () => {
          const out = await inner(args);
          if (isErrorResult(out)) recentCreates.delete(key); // let a real retry through
          else announce(out);
          return out;
        })();
        recentCreates.set(key, { at: now, result });
        pruneRecentCreates(now);
        return result;
      };
      continue;
    }
    c.run = async (args: Json) => {
      const out = await inner(args);
      announce(out);
      return out;
    };
  }

  return caps;
}

// Short-window dedupe of identical `*.create` calls (see buildPlatformCapabilities).
// Module-scoped so it survives the per-render rebuild of the manifest; keyed by
// tenant so two workspaces never share an entry.
const CREATE_DEDUPE_MS = 8000;
const recentCreates = new Map<string, { at: number; result: Promise<unknown> }>();

function nowMs(): number {
  return typeof Date !== 'undefined' ? Date.now() : 0;
}

/** Drop entries past the dedupe window so the map can't grow unbounded. */
function pruneRecentCreates(now: number): void {
  for (const [k, v] of recentCreates) {
    if (now - v.at >= CREATE_DEDUPE_MS) recentCreates.delete(k);
  }
}

/** Deterministic JSON for the dedupe key (object key order can vary per call). */
function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

// ---------------------------------------------------------------------------
// BrainActions = Tier-1 promoted tools + navigate + dispatcher.
// ---------------------------------------------------------------------------

/** Turn a manifest capability into a first-class BrainAction (carrying `mutates`). */
function toAction(c: PlatformCapability, name: string, descOverride?: string): BrainAction {
  return {
    name,
    description: descOverride ?? c.description,
    parameters: c.parameters,
    mutates: c.mutates,
    run: (args) => c.run(args as Json),
  };
}

/** Wrap a manifest capability as a first-class BrainAction with a flat name. */
function promote(caps: PlatformCapability[], domain: string, method: string, name: string, descOverride?: string): BrainAction {
  const c = caps.find((x) => x.domain === domain && x.method === method);
  if (!c) throw new Error(`platformActions: missing capability ${domain}.${method}`);
  return toAction(c, name, descOverride);
}

/** [domain, method, flat tool name] — the always-on Tier-1 core. */
const STATIC_PROMOTIONS: ReadonlyArray<readonly [string, string, string]> = [
  ['projects', 'create', 'create_project'],
  ['projects', 'update', 'update_project'],
  ['projects', 'delete', 'delete_project'],
  ['projects', 'list', 'list_projects'],
  ['tasks', 'list', 'list_tasks'],
  ['tasks', 'create', 'create_task'],
  ['tasks', 'update', 'update_task'],
  ['tasks', 'assignees', 'list_task_assignees'],
  ['workflows', 'list', 'list_workflows'],
  ['workflows', 'run', 'run_workflow'],
  ['specs', 'list', 'list_specs'],
  ['specs', 'create', 'create_spec'],
  ['agents_published', 'list', 'list_agents'],
  ['agents_published', 'hire', 'hire_agent'],
  ['cloud_agents', 'create', 'create_cloud_agent'],
  ['skills_marketplace', 'list', 'list_skills'],
  ['brain', 'list', 'list_chats'],
  ['approvals', 'list', 'list_approvals'],
  ['approvals', 'decide', 'decide_approval'],
  ['alerts', 'list', 'list_alerts'],
  ['alerts', 'create', 'create_alert'],
  ['decks', 'generate', 'generate_deck'],
  ['decks', 'fill_template', 'fill_deck_template'],
];

/** Methods worth promoting first-class when a domain is in focus for the route. */
const FOCUS_METHODS = ['list', 'get', 'create', 'update', 'run'];

/** Map the current route to the capability domains most relevant there, so their
 *  core tools get promoted first-class. Pure (exported for the bridge + tests). */
export function focusDomainsForPath(pathname: string | null | undefined): string[] {
  const p = pathname ?? '';
  const has = (seg: string) => p === seg || p.startsWith(`${seg}/`) || p.startsWith(`${seg}?`);
  if (has('/projects') || has('/ide') || has('/dashboard')) return ['projects', 'tasks', 'repo_analysis'];
  if (has('/tasks')) return ['tasks'];
  if (has('/workflows')) return ['workflows', 'workflow_runs'];
  if (has('/workforce') || has('/agents')) return ['cloud_agents', 'agents_published', 'approvals'];
  if (has('/marketplace') || has('/skills')) return ['skills_marketplace', 'artifact_assignments'];
  if (has('/prompts')) return ['prompts'];
  if (has('/personas')) return ['artifact_assignments'];
  if (has('/security')) return ['security'];
  if (has('/settings/api-keys')) return ['api_keys'];
  return [];
}

export function buildPlatformActions(ctx: PlatformActionContext): BrainAction[] {
  const caps = buildPlatformCapabilities(ctx);

  // Navigation — open any page in the app.
  const navigate_to: BrainAction = {
    name: 'navigate_to',
    description: 'Navigate the browser to a page in the app. For pages about one project (page="project" or "ide_project") pass the numeric project id as `id`. To show a project\'s tasks (e.g. after creating one) use page="project_tasks" with the project id.',
    parameters: obj(
      {
        page: { type: 'string', enum: ALL_PAGE_KEYS, description: 'Page key to open.' },
        id: { type: ['string', 'number'], description: 'Id for dynamic pages (e.g. project id).' },
        query: { ...S, description: 'Optional querystring without the leading "?".' },
      },
      ['page'],
    ),
    mutates: false,
    run: (args) => {
      const a = args as Json;
      const resolved = resolveRoute(f(a, 'page'), f(a, 'id'), f(a, 'query'));
      if (typeof resolved !== 'string') return resolved; // { error }
      ctx.navigate(resolved);
      return { navigated: resolved };
    },
  };

  // Convenience: open a project straight in the IDE ("launch it").
  const open_project: BrainAction = {
    name: 'open_project',
    description: 'Open a project in the IDE (use this to "launch" a project after creating it).',
    parameters: obj({ id: { ...N, description: 'Project id' }, chatId: { ...N, description: 'Optional Brain chat id to carry into the IDE.' } }, ['id']),
    mutates: false,
    run: (args) => {
      const a = args as Json;
      const id = f(a, 'id');
      if (id == null) return { error: 'A project id is required.' };
      const chatId = f<number | undefined>(a, 'chatId');
      ctx.navigate(`/ide/${id}${chatId != null ? `?chat=${chatId}` : ''}`);
      return { opened: `/ide/${id}` };
    },
  };

  // Tier-2 dispatcher — discovery + call for EVERY capability.
  const list_platform_capabilities: BrainAction = {
    name: 'list_platform_capabilities',
    description: 'Discover every platform capability the Brain can run (optionally filtered by domain). Use this, then call_platform_capability, for anything without a dedicated tool.',
    parameters: obj({ domain: { ...S, description: 'Optional domain filter, e.g. "tasks", "boards", "prompts".' } }),
    mutates: false,
    run: (args) => {
      const domain = f<string | undefined>(args as Json, 'domain');
      const list = (domain ? caps.filter((c) => c.domain === domain) : caps).map((c) => ({
        domain: c.domain,
        method: c.method,
        description: c.description,
        mutates: c.mutates,
        parameters: c.parameters,
      }));
      const domains = [...new Set(caps.map((c) => c.domain))];
      return { domains, count: list.length, capabilities: list };
    },
  };

  const call_platform_capability: BrainAction = {
    name: 'call_platform_capability',
    description: 'Run any platform capability by domain + method (discover them with list_platform_capabilities). `args` must match that capability’s parameters. Confirm with the user before running any capability whose `mutates` is true.',
    parameters: obj(
      {
        domain: { ...S, description: 'Capability domain, e.g. "tasks".' },
        method: { ...S, description: 'Capability method, e.g. "create".' },
        args: { type: 'object', description: 'Arguments matching the capability’s parameters.' },
      },
      ['domain', 'method'],
    ),
    // The dispatcher proxies both reads and writes — gate it iff the targeted
    // capability mutates, so the confirm prompt fires for write calls only.
    mutates: (args) => {
      const a = (args ?? {}) as Json;
      const c = caps.find((x) => x.domain === f<string>(a, 'domain') && x.method === f<string>(a, 'method'));
      return c ? c.mutates : false;
    },
    run: async (args) => {
      const a = args as Json;
      const domain = f<string>(a, 'domain');
      const method = f<string>(a, 'method');
      const c = caps.find((x) => x.domain === domain && x.method === method);
      if (!c) return { error: `Unknown capability "${domain}.${method}". Call list_platform_capabilities to discover valid ones.` };
      return c.run((f<Json>(a, 'args')) ?? {});
    },
  };

  // Tier-1 promoted tools (single source of truth = the manifest).
  const promotedKeys = new Set(STATIC_PROMOTIONS.map(([d, m]) => `${d}.${m}`));
  const promoted = STATIC_PROMOTIONS.map(([d, m, name]) => promote(caps, d, m, name));

  // Context-aware promotion: bring the route's relevant domains' core methods
  // first-class too, deduped against the static core and each other.
  const seen = new Set(promoted.map((a) => a.name));
  const focusActions: BrainAction[] = [];
  for (const domain of ctx.focusDomains ?? []) {
    for (const c of caps.filter((x) => x.domain === domain && FOCUS_METHODS.includes(x.method))) {
      if (promotedKeys.has(`${c.domain}.${c.method}`)) continue;
      const name = `${c.domain}_${c.method}`;
      if (seen.has(name)) continue;
      seen.add(name);
      focusActions.push(toAction(c, name));
    }
  }

  return [navigate_to, open_project, ...promoted, ...focusActions, list_platform_capabilities, call_platform_capability];
}
