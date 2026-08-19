import { scaffoldForProject } from '../../../api/src/application/project/projectTemplate';

/**
 * ── THE PROJECT CRUD THAT USED TO LIVE HERE IS GONE ─────────────────────────
 *
 * This router held a second, independent implementation of project list / read /
 * create / update / delete, reached only when `NEXT_PUBLIC_WORKER_URL` was set.
 * It was a copy of the API's, and it had drifted the way a copy does:
 *
 *   · `GET /` was `SELECT * FROM projects` with NO tenant predicate — every
 *     authenticated caller could read every workspace's projects — and `GET/PUT/
 *     DELETE /:id` matched on id alone, with no ownership check either.
 *   · `PUT /:id` silently dropped `dueDate`, so saving a due date through a
 *     worker-routed deployment did nothing and reported success.
 *   · it returned no per-project health breakdown, so the dashboard's health
 *     visuals were blank on exactly those deployments.
 *
 * Two of those are on the roadmap as "add the FILTER aggregate" / "PUT ignores
 * dueDate"; the roadmap's own alternative — retire the worker path — is the right
 * one, because the third is a cross-tenant read and the fix for all three is one
 * already-correct, already-tested implementation in `api/src/presentation/routes/
 * projectRoutes.ts`. Rebuilding tenant scoping, health aggregates and field
 * coverage a second time here would only re-create the drift.
 *
 * What REMAINS in this file is the scaffold helper the files router uses. The
 * frontend now sends every project call to the API (`getProjectsBaseUrl`), so
 * nothing reaches the removed endpoints.
 */


export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Starter templates come from the API's `projectTemplate` module — the single
 * source the auth API and the lazy self-heal already seed from. This route used
 * to keep its own `VANILLA_TEMPLATE` copy AND ignore its `template` argument, so
 * a `mobile` / `webmobile` project created through this legacy worker was seeded
 * with the Vite scaffold and opened unrunnable. Re-exported for the tests that
 * assert the scaffold's shape.
 */
export { VANILLA_TEMPLATE, MOBILE_TEMPLATE } from '../../../api/src/application/project/projectTemplate';

/** Seed a new project's workspace with the scaffold its template/modality selects. */
export async function createTemplateFiles(
  storage: R2Bucket,
  projectId: string,
  template: string | null,
  modality = 'designer',
): Promise<void> {
  const files = scaffoldForProject({ id: 0, template, modality, sourceControlRepoFullName: null, githubRepoUrl: null });
  if (!files) return;
  await Promise.all(
    Object.entries(files).map(([path, content]) =>
      storage.put(`${projectId}/${path}`, content)
    )
  );
}
