import { reportCaughtError } from '../observability/caughtErrorReporter';
import { ensureProjectTemplate } from './projectTemplate';
import { invalidateProjectsList } from './projectsListCache';
import { KanbanTemplateService } from '../kanban/kanbanTemplateService';
import { DEFAULT_TEMPLATE_ID } from '../kanban/templateCatalog';
import { provisionDefaultProjectEvermind } from '../llm/projectEvermind';
import type { Project } from '../../domain/project/Project';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/**
 * The ONE "a project row exists — now make it usable" use case.
 *
 * Creating the row is only half of it: a project is not usable until it has its
 * starter files, a kanban board whose lanes carry role ownership, and a default
 * Evermind. Every create path (REST POST /api/projects, /upsert, /scaffold, and
 * zero-setup starter-workspace provisioning) runs THIS, so a project can never
 * be born half-provisioned depending on which door it came through — /upsert and
 * /scaffold previously skipped the board entirely.
 *
 * Every step is best-effort: a template/board/Evermind failure must never undo a
 * project the caller has already been told about. Failures are reported, not
 * swallowed silently.
 */
export async function provisionProject(
  env: Env,
  db: Db,
  tenantId: number,
  project: Project,
  opts: { kanbanTemplateId?: string | null } = {},
): Promise<void> {
  const plain = project.toPlain();

  await ensureProjectTemplate(env.UPLOADS, project).catch((error) => {
    reportCaughtError(error, { source: 'application/project/provisionProject.ts', operation: 'ensureProjectTemplate' });
  });

  // Board from a kanban template so its lanes carry role ownership + per-lane
  // requirements from day one (the onboarding "recommended roster" reads this).
  await new KanbanTemplateService(db)
    .applyToProject(env, tenantId, plain.id, opts.kanbanTemplateId?.trim() || DEFAULT_TEMPLATE_ID, plain.name)
    .catch((error) => {
      reportCaughtError(error, { source: 'application/project/provisionProject.ts', operation: 'applyKanbanTemplate' });
    });

  // A DEFAULT Evermind so the project always has a self-learning model to
  // run/learn/edit — even when the manager never seeds one from a Studio model.
  // Inference stays OFF until opted in.
  await provisionDefaultProjectEvermind(env, db, tenantId, plain.id, plain.name).catch((error) => {
    reportCaughtError(error, { source: 'application/project/provisionProject.ts', operation: 'provisionDefaultProjectEvermind' });
  });

  await invalidateProjectsList(env, tenantId).catch((error) => {
    reportCaughtError(error, { source: 'application/project/provisionProject.ts', operation: 'invalidateProjectsList' });
  });
}
