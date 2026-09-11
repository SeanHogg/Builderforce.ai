import { creativeMeshGeometry, creativePreviewImageUrl } from '@/lib/creationDeliverables';
import { isRoomCreationKind, type RoomCreation } from '@/lib/canvas/roomCreations';
import { creationObjectSurface } from './creationObjectSurfaces';
import type { CreationNodeData } from './types';

/**
 * The board's 3D creations, as the room reads them.
 *
 * Beside `creationObjectSurfaces.ts` because it is the same kind of join: which KIND
 * stands in the room (`roomCreations.ts`), what it opens into (the surface registry),
 * and what picture or mesh it carries (`creationDeliverables.ts`). The room itself
 * knows none of those three registries — it is handed the result.
 */
export function roomCreationsOf(nodes: readonly { id: string; data: CreationNodeData }[]): RoomCreation[] {
  return nodes
    .filter((node) => isRoomCreationKind(node.data.kind))
    .map((node) => ({
      id: node.id,
      kind: node.data.kind,
      title: typeof node.data.title === 'string' ? node.data.title.trim() : '',
      preview: creativePreviewImageUrl(node.data) ?? undefined,
      geometry: creativeMeshGeometry(node.data) ?? undefined,
      accent: typeof node.data.accent === 'string' ? node.data.accent : undefined,
      surface: creationObjectSurface(node.data.kind),
    }));
}
