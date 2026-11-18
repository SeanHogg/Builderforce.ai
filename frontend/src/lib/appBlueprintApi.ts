/**
 * The project's detected `AppBlueprint` (PRD 31 §W2) — what the run loop reads to
 * choose where the app runs. `GET /api/projects/:id/blueprint` answers the latest
 * detection, or `null` when none has run yet (a canvas app, a repo never detected).
 * A failed read REJECTS: "could not read it" is not "there is none", and the caller
 * says which.
 */
import type { AppBlueprint } from '@builderforce/creation-canvas-contract';
import { apiRequest } from './apiClient';

export async function fetchProjectBlueprint(projectId: number | string): Promise<AppBlueprint | null> {
  if (projectId === '' || projectId == null) return null;
  const res = await apiRequest<{ blueprint: AppBlueprint | null }>(`/api/projects/${encodeURIComponent(String(projectId))}/blueprint`, { expectedErrors: [404] });
  return res?.blueprint ?? null;
}
