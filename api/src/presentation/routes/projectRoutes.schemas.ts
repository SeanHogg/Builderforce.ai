/**
 * Request bodies for `projectRoutes.ts`, kept in their own module because the route
 * file is already past the size where inline schemas stay readable.
 *
 * Every schema mirrors what its handler declared and reads. Two conventions carry
 * over from the handlers unchanged:
 *   - a field the handler answers its own "X is required" message for (`name`,
 *     `prompt`, `codeChanges`) stays optional here, so that message still wins;
 *   - the source-control fields are tri-state — absent = leave alone, `null` =
 *     clear — which is what `resolveSourceControlAssignment` reads, so they are
 *     `.nullish()` and never defaulted.
 */
import { ProjectStatus } from '../../domain/shared/types';
import { z, zNumberLike } from './requestBody';

const sourceControlFields = {
  sourceControlIntegrationId: z.number().nullish(),
  sourceControlRepoFullName: z.string().nullish(),
  sourceControlRepoUrl: z.string().nullish(),
  githubRepoUrl: z.string().nullish(),
};

export const ProjectCodeChangesBody = z.object({
  codeChanges: z.number().nullish(),
  executionId: z.number().nullish(),
});

export const CreateProjectBody = z.object({
  key: z.string().nullish(),
  name: z.string().nullish(),
  description: z.string().nullish(),
  /** IDE: template to seed initial files (e.g. "vanilla"). */
  template: z.string().nullish(),
  rootWorkingDirectory: z.string().nullish(),
  ...sourceControlFields,
  governance: z.string().nullish(),
  /** IDE project type: 'designer' | 'video' | 'evermind' | 'finetune' | 'voice'. Defaults to 'designer'. */
  modality: z.string().nullish(),
  /** Where the project was born — 'ide' tags it for the Designer badge. */
  origin: z.string().nullish(),
  /** The kanban template `provisionProject` seeds the board from. */
  kanbanTemplateId: z.string().nullish(),
});

export const UpsertProjectBody = z.object({
  name: z.string().nullish(),
  description: z.string().nullish(),
  rootWorkingDirectory: z.string().nullish(),
  ...sourceControlFields,
  governance: z.string().nullish(),
});

/**
 * The PATCH body is spread into `ProjectService.updateProject`, so it declares every
 * field `UpdateProjectDto` reads — `governance` included, which the old inline type
 * omitted but the spread always carried. A present `key` / `name` is trimmed, so
 * those must be strings when sent. The two dates go through `nullableDateParam`,
 * which accepts an ISO string or an epoch number, and `null` to clear.
 */
export const PatchProjectBody = z.object({
  key: z.string().optional(),
  name: z.string().optional(),
  description: z.string().nullish(),
  template: z.string().nullish(),
  rootWorkingDirectory: z.string().nullish(),
  status: z.enum(ProjectStatus).optional(),
  ...sourceControlFields,
  governance: z.string().nullish(),
  modality: z.string().nullish(),
  /** Explicit project deadline, or null to clear it. */
  dueDate: zNumberLike.nullish(),
  /** Explicit project start, or null to clear it — what the Gantt writes when a
   *  bar's left edge is dragged. */
  startDate: zNumberLike.nullish(),
});

export const ScaffoldProjectBody = z.object({
  prompt: z.string().nullish(),
  rootWorkingDirectory: z.string().nullish(),
  agentHostId: z.number().nullish(),
});
