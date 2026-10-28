/**
 * Where the web can review from (PRD 38 §4.7): this workspace's in-browser runtime (only
 * when it is already running — it is never booted just to look), a folder on this
 * device, and each connected Cloud Drive (its root, walked within bounds).
 */

import { peekSharedPreviewRuntime } from '@/lib/browserRuntime/previewRuntime';
import { driveApi } from '@/lib/driveApi';
import { uploadDirectoryProvider, type DirectoryProvider } from '@builderforce/knowledge-browser';
import { createVfsDirectorySource } from './vfsDirectorySource';
import { createDriveDirectorySource } from './cloudDriveDirectorySource';
import { WEB_HOST, reportKnowledgeDegraded, webRootId } from './webHost';

export interface WebDirectoryProviderOptions {
  projectId: number;
  /** The scope title for the workspace's files, in the reader's language. */
  workspaceTitle: string;
}

export async function webDirectoryProviders({ projectId, workspaceTitle }: WebDirectoryProviderOptions): Promise<DirectoryProvider[]> {
  const out: DirectoryProvider[] = [];

  const running = peekSharedPreviewRuntime();
  const runtime = running
    ? await running.catch((error: unknown) => { reportKnowledgeDegraded('workspace runtime', error); return null; })
    : null;
  if (runtime && runtime.fs.list().length > 0) {
    const rootId = webRootId('vfs', projectId);
    const open = async () => createVfsDirectorySource({ fs: runtime.fs, rootId, title: workspaceTitle });
    out.push({ id: 'workspace', kind: 'workspace', open, reopen: async (id) => (id === rootId ? open() : null) });
  }

  out.push(uploadDirectoryProvider(WEB_HOST));

  const drives = await driveApi.providers().then((r) => r.connections, (error: unknown) => {
    reportKnowledgeDegraded('drive connections', error);
    return [];
  });
  for (const connection of drives.filter((c) => c.status === 'connected')) {
    const source = () => createDriveDirectorySource(connection);
    const rootId = source().rootId;
    out.push({
      id: `drive:${connection.id}`,
      kind: 'drive',
      title: connection.displayName || connection.accountEmail,
      open: async () => source(),
      reopen: async (id) => (id === rootId ? source() : null),
    });
  }
  return out;
}
