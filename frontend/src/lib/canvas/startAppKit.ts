import { composeKit, listStarterKits } from '@builderforce/ide-templates/kits';
import { localCreationSnapshotFrom } from '@/domains/canvas/domain/boardSnapshot';
import { APP_KIT_FIELD, LOCAL_APP_KEY_FIELD, newLocalAppKey } from '@/lib/canvasSessionApp';
import { createLocalStarterBoard } from '@/lib/pendingWork';
import { seedLocalWorkspace } from '@/lib/workspace/localFileStore';

export function canvasKitById(id: string | null) {
  return listStarterKits().find((kit) => kit.value === id);
}

export async function startAppKit({ value, label }: NonNullable<ReturnType<typeof canvasKitById>>) {
  const kit = composeKit(value);
  if (kit.issues.length) throw new Error('Invalid starter kit.');
  const workspaceKey = newLocalAppKey();
  const nodeId = crypto.randomUUID();
  await seedLocalWorkspace(workspaceKey, kit.files);
  const sessionId = createLocalStarterBoard(localCreationSnapshotFrom(null, {
    title: label,
    edges: [],
    nodes: [{
      id: nodeId,
      type: 'creation',
      position: { x: 120, y: 140 },
      data: { kind: 'build', title: label, modality: 'designer', [LOCAL_APP_KEY_FIELD]: workspaceKey, [APP_KIT_FIELD]: value },
    }],
  }));
  return { sessionId, nodeId };
}
