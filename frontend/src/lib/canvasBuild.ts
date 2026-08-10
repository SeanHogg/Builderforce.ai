/**
 * Builder objects on the Creation Canvas — the legacy build-record binding.
 *
 * A `build` Canvas object owns the existing build record (historically named
 * `IdeProject` in the API), seeded server-side with the starter template
 * its modality selects (`api/src/application/project/projectTemplate.ts`). The
 * canvas stores only the binding; every capability — file tree, editor, dev
 * server, checks, terminal, publish, train, state — comes from mounting the one
 * `<BuilderWorkspace>` against the bound storage project, so there is no second
 * implementation to keep in step.
 *
 * This module is the single source for that binding: how a build is created,
 * how an IdeProject maps onto node data, and how node data resolves back to a
 * project. Canvas, the inspector, the node tile, and Brain's canvas tools all
 * read it rather than re-deriving `resourceId` string shapes.
 */
import { createIdeProject } from '@/lib/api';
import { DEFAULT_MODALITY, getModality, type ProjectModality } from '@/lib/modality';
import type { IdeProject } from '@/lib/types';
import type { CreationNodeData } from '@/components/creation-canvas/types';

/** Legacy `resourceId` prefix for a Canvas Builder binding. */
export const BUILD_RESOURCE_PREFIX = 'ideProject:';

/** The binding a bound Builder object carries. */
export interface CanvasBuildBinding {
  ideProjectId: number;
  /** The backing storage project — what `<BuilderWorkspace>` and the file APIs address. */
  storageProjectId: number;
  /** Public storage-project id for the `/create/build/:publicId` deep link. */
  storageProjectPublicId: string;
  modality: ProjectModality;
}

function positiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Resolve a Builder object's binding, or null when it has not been created yet.
 * Tolerates a node whose `resourceId` survived but whose numeric mirrors were
 * dropped by a snapshot round-trip (and vice versa).
 */
export function canvasBuildBinding(data: CreationNodeData): CanvasBuildBinding | null {
  const fromRef = typeof data.resourceId === 'string' && data.resourceId.startsWith(BUILD_RESOURCE_PREFIX)
    ? positiveInt(data.resourceId.slice(BUILD_RESOURCE_PREFIX.length))
    : null;
  const ideProjectId = fromRef ?? positiveInt(data.ideProjectId);
  const storageProjectId = positiveInt(data.storageProjectId);
  if (ideProjectId == null || storageProjectId == null) return null;
  return {
    ideProjectId,
    storageProjectId,
    storageProjectPublicId: typeof data.storageProjectPublicId === 'string' && data.storageProjectPublicId
      ? data.storageProjectPublicId
      : String(storageProjectId),
    modality: getModality(typeof data.modality === 'string' ? data.modality : null).id,
  };
}

/** Bind a created legacy build record onto its Canvas object. */
export function canvasBuildPatch(ide: IdeProject): Partial<CreationNodeData> {
  return {
    title: ide.name,
    resourceId: `${BUILD_RESOURCE_PREFIX}${ide.id}`,
    ideProjectId: ide.id,
    storageProjectId: ide.storageProjectId,
    storageProjectPublicId: ide.storageProjectPublicId,
    containerProjectId: ide.containerProjectId,
    modality: getModality(ide.modality).id,
    status: 'Workspace ready',
  };
}

/**
 * The modality a Builder object should be created with. `build` carries its own
 * choice; a Website object always builds a website, which is what the Designer
 * modality is — so an authored site can grow into a real codebase in place.
 */
export function canvasBuildModality(data: CreationNodeData): ProjectModality {
  if (data.kind === 'website' || data.kind === 'prototype') return 'designer';
  return getModality(typeof data.modality === 'string' ? data.modality : DEFAULT_MODALITY).id;
}

/**
 * Create the legacy build record backing a Builder object. The API seeds the starter
 * template for the chosen modality, so the workspace opens runnable rather than
 * empty. The historical API/type names remain until the persistence migration.
 */
export async function createCanvasBuild(input: {
  title: string;
  modality: ProjectModality;
  containerProjectId?: number | null;
}): Promise<IdeProject> {
  return createIdeProject({
    name: input.title.trim().slice(0, 120) || 'New build',
    modality: input.modality,
    containerProjectId: input.containerProjectId ?? null,
  });
}
