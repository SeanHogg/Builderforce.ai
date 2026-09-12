/**
 * Request-body schemas for `agentHostRoutes.ts` — split out so the 2,400-line
 * route module does not grow by its own contract.
 *
 * Most of these bodies are posted by the agent host itself (the CLI / VSIX
 * runtime), and older builds of it are in the wild. So every schema here is
 * TOLERANT by construction:
 *   - an extra key is never refused (`z.object` strips what the handler does not
 *     read; a part the handler stores or relays whole is `z.unknown()`);
 *   - no field is tightened past the TS type its handler declared;
 *   - a field the handler answers its own "X is required" sentence for stays
 *     optional here, so that sentence is still what a missing field gets;
 *   - `null` is admitted wherever the handler already read it as absent (`??`).
 *
 * The schema's job is the SHAPE: a `name: 5` or `files: "x"` is a 400 naming the
 * field, instead of a TypeError answered as a 500.
 */
import type { CreateChannelInput, UpdateChannelInput } from '../../application/agentHost/agentHostChannels';
import type { OpenTaskPrInput } from '../../application/repos/openTaskPullRequest';
import { RequestValidationError } from '../../domain/shared/errors';
import { z, zJsonObject, zNumberLike } from './requestBody';

/** Text the handler hands on as `string | undefined`: `null` reads as absent; never trimmed. */
const zOptionalText = z.string().nullish().transform((value) => value ?? undefined);

/** A timestamp the handler `new Date(...)`s — an ISO string or epoch ms both construct one. */
const zTimestamp = zNumberLike.nullish();

/** A row id the handler passes straight on; `null` means "none". */
const zNullableId = z.number().nullish();

/**
 * True for the root-level issue `parseBody` raises when there is no usable JSON
 * object at all — an absent or malformed body, or a non-object root. Endpoints
 * whose body is optional or that answer their own "a JSON body is required"
 * sentence map exactly this case; a wrong-typed FIELD still throws to the global
 * 400 with its path.
 */
export function isRootBodyIssue(error: unknown): error is RequestValidationError {
  return error instanceof RequestValidationError && error.issues[0]?.path === '';
}

/** `.catch(nullWhenNoJsonObject)` — `null` for {@link isRootBodyIssue}, rethrow anything else. */
export function nullWhenNoJsonObject(error: unknown): null {
  if (isRootBodyIssue(error)) return null;
  throw error;
}

// ── Registration / lifecycle ────────────────────────────────────────────────

/** `machineProfile` is read by `normalizeMachineProfile`, which type-guards every field itself. */
const zMachineProfile = z.unknown().optional();

/** `POST /` — register a host. The handler refuses a blank name itself. */
export const RegisterAgentHostBody = z.object({
  name: z.string().nullish(),
  machineProfile: zMachineProfile,
});

/** `PATCH /:id/status` — a missing status gets the handler's own sentence. */
export const AgentHostStatusBody = z.object({
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
});

/** `PATCH /:id/limits` — `null` removes the per-host cap; the handler checks the integer rule. */
export const AgentHostLimitsBody = z.object({
  tokenDailyLimit: z.number().nullish(),
});

/** `PATCH /:id/capabilities` — the handler refuses a non-array and drops non-strings itself. */
export const DeclaredCapabilitiesBody = z.object({
  declaredCapabilities: z.unknown().optional(),
});

/** `PATCH /:id/heartbeat` — an optional body; both fields are type-guarded by the handler. */
export const HeartbeatBody = z.object({
  capabilities: z.unknown().optional(),
  machineProfile: zMachineProfile,
});

// ── Directory sync ──────────────────────────────────────────────────────────

/** A manifest entry. One without a `relPath` is skipped by the handler, not refused. */
const DirectorySyncFile = z.object({
  relPath: z.string().nullish(),
  contentHash: z.string().nullish(),
  sizeBytes: z.number().nullish(),
  content: z.string().nullish(),
});

/** `PUT /:id/directories/sync` — the handler refuses a blank `absPath` itself. */
export const DirectorySyncBody = z.object({
  projectId: zNullableId,
  absPath: z.string().nullish(),
  status: z.enum(['pending', 'synced', 'error']).nullish(),
  /** Stored whole as JSON. */
  metadata: zJsonObject.nullish(),
  errorMessage: z.string().nullish(),
  files: z.array(DirectorySyncFile).nullish(),
});

// ── Cron ────────────────────────────────────────────────────────────────────

/** `POST /:id/cron` — the handler refuses a blank name/schedule itself. */
export const CreateCronJobBody = z.object({
  id: z.string().nullish(),
  name: z.string().nullish(),
  schedule: z.string().nullish(),
  taskId: zNullableId,
  projectId: zNullableId,
  projectAgentId: zNullableId,
  enabled: z.boolean().nullish(),
});

/** `PATCH /:id/cron/:jobId` — also the host poller's own lastRunAt/lastStatus callback. */
export const UpdateCronJobBody = z.object({
  name: z.string().nullish(),
  schedule: z.string().nullish(),
  taskId: zNullableId,
  projectId: zNullableId,
  projectAgentId: zNullableId,
  enabled: z.boolean().optional(),
  lastRunAt: zTimestamp,
  nextRunAt: zTimestamp,
  lastStatus: z.string().nullish(),
});

// ── Channels ────────────────────────────────────────────────────────────────

/**
 * `POST /:id/channels`. `platform` and `name` default to `''` so the application
 * port's own "Unsupported channel platform" / "A channel name is required"
 * sentences stay the answer to a missing one.
 */
export const CreateChannelBody = z.object({
  platform: z.string().default(''),
  name: z.string().default(''),
  config: z.string().nullish(),
  connectionId: z.string().nullish(),
  enabled: z.boolean().optional(),
}) satisfies z.ZodType<CreateChannelInput>;

/** `PATCH /:id/channels/:channelId`. */
export const UpdateChannelBody = z.object({
  name: z.string().optional(),
  config: z.string().nullish(),
  connectionId: z.string().nullish(),
  enabled: z.boolean().optional(),
}) satisfies z.ZodType<UpdateChannelInput>;

/** `POST /:id/channel-status` — the handler refuses a missing platform/name/status itself. */
export const ChannelStatusBody = z.object({
  platform: z.string().nullish(),
  name: z.unknown().optional(),
  status: z.string().nullish(),
  error: z.string().nullish(),
});

// ── Dispatch / relay / PR ───────────────────────────────────────────────────

/** `POST /:id/relay-result` — a `remote.result` frame, relayed verbatim to the source host. */
export const RelayResultPayload = z.unknown();

/**
 * A dispatch's terminal report — shared with the browser door
 * (`agentRuntimeRoutes.ts` `POST /:dispatchId/result`), since both feed the same
 * `SwimlaneCoordinator.reportDispatchResult`.
 */
export const DispatchResultReport = z.object({
  status: z.enum(['completed', 'failed', 'cancelled']),
  output: z.string().nullish(),
  error: z.string().nullish(),
});

/** `POST /:id/dispatch-result` — the handler refuses a missing dispatchId itself. */
export const HostDispatchResultBody = DispatchResultReport.extend({
  dispatchId: z.string().nullish(),
});

/**
 * Every PR-open door (`/:id/dispatch/:dispatchId/pull-request`,
 * `/:id/tasks/:taskId/pull-request`, and the browser's
 * `agentRuntimeRoutes` `/:dispatchId/pull-request`). `branch` defaults to `''` so
 * `openTaskPullRequest`'s own "branch is required" stays the answer to a missing one.
 */
export const PullRequestBody = z.object({
  branch: z.string().default(''),
  base: zOptionalText,
  title: zOptionalText,
  body: zOptionalText,
}) satisfies z.ZodType<OpenTaskPrInput>;

// ── Workspace / traceability ────────────────────────────────────────────────

/**
 * `POST /:id/workspace/:projectId/files` — an optional body. `taskId` is
 * `Number()`d by the handler; path/content rules are the workspace store's.
 */
export const WorkspaceChangeBody = z.object({
  taskId: zNumberLike.nullish(),
  agent: z.string().nullish(),
  writes: z.array(z.object({ path: z.string(), content: z.string() })).nullish(),
  deletes: z.array(z.string()).nullish(),
});

/** `POST /:id/file-change` — ids are `Number()`d and path/agent type-guarded by the handler. */
export const FileChangeBody = z.object({
  taskId: zNumberLike.nullish(),
  executionId: zNumberLike.nullish(),
  path: z.unknown().optional(),
  change: z.string().nullish(),
  agent: z.unknown().optional(),
});

// ── Telemetry ───────────────────────────────────────────────────────────────

/** `POST /:id/usage-snapshot` — every counter defaults to 0 when absent. */
export const UsageSnapshotBody = z.object({
  sessionKey: z.string().nullish(),
  inputTokens: z.number().nullish(),
  outputTokens: z.number().nullish(),
  contextTokens: z.number().nullish(),
  contextWindowMax: z.number().nullish(),
  compactionCount: z.number().nullish(),
  ts: zTimestamp,
});

/** `POST /:id/tool-audit` — the handler refuses a missing toolName itself. */
export const ToolAuditBody = z.object({
  runId: z.string().nullish(),
  /** `Number()`d by the handler. */
  executionId: zNumberLike.nullish(),
  sessionKey: z.string().nullish(),
  toolCallId: z.string().nullish(),
  toolName: z.string().nullish(),
  category: z.string().nullish(),
  /** Stored whole as JSON. */
  args: z.unknown().optional(),
  result: z.string().nullish(),
  durationMs: z.number().nullish(),
  ts: zTimestamp,
});

/** `POST /:id/approval-request` — the handler refuses a missing actionType/description itself. */
export const ApprovalRequestBody = z.object({
  /** `normalizeRequestKind` owns the vocabulary. */
  kind: z.unknown().optional(),
  actionType: z.string().nullish(),
  description: z.string().nullish(),
  /** Stored whole as JSON. */
  metadata: z.unknown().optional(),
  expiresAt: zTimestamp,
  requestedBy: z.string().nullish(),
});

/** `PATCH /:id/executions/:eid/state`. */
export const ExecutionStateBody = z.object({
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  result: z.string().nullish(),
  errorMessage: z.string().nullish(),
});

// ── Project context ─────────────────────────────────────────────────────────

/** `PATCH /:id/project-context` — no projectId falls back to the host's primary project. */
export const ProjectContextBody = z.object({
  projectId: zNullableId,
  governance: z.string().nullish(),
});

/** `PUT /:id/personas` — stored whole; the handler refuses a non-array itself. */
export const PersonasBody = z.object({
  personas: z.unknown().optional(),
});
