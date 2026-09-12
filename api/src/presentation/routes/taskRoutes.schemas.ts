/**
 * Request-body schemas for `taskRoutes.ts` — split out so the 1,200-line route
 * module does not grow by its own contract.
 *
 * Each mirrors the body its handler declared AND what it actually reads. A field
 * the handler answers its own "X is required" sentence for stays OPTIONAL, so that
 * sentence is still what a missing field gets. Bodies the handler hands to
 * `TaskService` as-is (create, patch, decompose) enumerate EVERY field the service
 * DTO accepts — `z.object` strips unknown keys, and a DTO field missing here would
 * silently stop reaching the service.
 */
import { AgentType, TaskPriority, TaskType } from '../../domain/shared/types';
import { z, zNumberLike } from './requestBody';

/** `POST /decomposition-cleanup/apply` — ids that are not candidates are refused per id by the service. */
export const DecompositionCleanupBody = z.object({
  projectId: z.number().nullish(),
  selections: z.array(z.object({
    taskId: z.number(),
    action: z.enum(['archive', 'merge']),
    mergeIntoTaskId: z.number().nullish(),
  })).nullish(),
});

/** `POST /:id/run-now` — `chatId` is type-guarded by the handler, and the body may be absent. */
export const RunNowBody = z.object({ chatId: z.unknown().optional() });

/** `POST /:id/dependencies` — the handler refuses a missing predecessor and an unknown `depType` itself. */
export const AddDependencyBody = z.object({
  predecessorTaskId: zNumberLike.nullish(),
  depType: z.string().optional(),
});

/** One child of `POST /:id/decompose` — every `ChildTaskPlan` field. */
const DecomposeChildBody = z.object({
  title: z.string(),
  description: z.string().nullish(),
  priority: z.enum(TaskPriority).optional(),
  assignedUserId: z.string().nullish(),
  assignedAgentHostId: z.number().nullish(),
  assignedAgentRef: z.string().nullish(),
  roleKey: z.string().nullish(),
  estimateDays: z.number().nullish(),
  dependsOnIndex: z.number().nullish(),
});

/** `POST /:id/decompose` — the handler refuses an empty `children` itself; `replace` is `!!`-coerced. */
export const DecomposeBody = z.object({
  children: z.array(DecomposeChildBody).nullish(),
  replace: z.unknown().optional(),
});

/** `POST /` — every `CreateTaskDto` field a caller may set (the body is spread into it). */
export const CreateTaskBody = z.object({
  projectId: z.number(),
  title: z.string(),
  description: z.string().nullish(),
  priority: z.enum(TaskPriority).optional(),
  assignedAgentType: z.enum(AgentType).nullish(),
  assignedAgentHostId: z.number().nullish(),
  assignedAgentRef: z.string().nullish(),
  assignedUserId: z.string().nullish(),
  taskType: z.enum(TaskType).optional(),
  parentTaskId: z.number().nullish(),
  gapOriginTaskId: z.number().nullish(),
  startDate: z.string().nullish(),
  dueDate: z.string().nullish(),
  persona: z.string().nullish(),
});

/** `PATCH /:id` — every `UpdateTaskDto` field; `null` clears the nullable ones. */
export const UpdateTaskBody = z.object({
  title: z.string().optional(),
  description: z.string().nullish(),
  status: z.string().optional(),
  priority: z.enum(TaskPriority).optional(),
  taskType: z.enum(TaskType).optional(),
  parentTaskId: z.number().nullish(),
  sprintId: z.string().nullish(),
  releaseId: z.string().nullish(),
  storyPoints: z.number().nullish(),
  businessValue: z.number().nullish(),
  businessValueRationale: z.string().nullish(),
  businessValueSource: z.string().nullish(),
  assignedAgentType: z.enum(AgentType).nullish(),
  assignedAgentHostId: z.number().nullish(),
  assignedAgentRef: z.string().nullish(),
  assignedUserId: z.string().nullish(),
  githubPrUrl: z.string().nullish(),
  githubPrNumber: z.number().nullish(),
  startDate: z.string().nullish(),
  dueDate: z.string().nullish(),
  persona: z.string().nullish(),
  archived: z.boolean().optional(),
});

/** `POST /:id/move`. */
export const MoveTaskBody = z.object({ projectId: z.number() });

/** `POST /:id/convert-type` — the handler refuses anything but task|epic|objective with its own sentence. */
export const ConvertTypeBody = z.object({ target: z.string().nullish() });

/** `POST /:id/specs`. */
export const LinkSpecBody = z.object({
  specId: z.string(),
  isPrimary: z.boolean().nullish(),
});
