// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { BuilderSettingsPanel } from '@/components/BuilderSettingsPanel';
import { MobileDevicePanel } from './MobileDevicePanel';
import type { BuilderWorkspaceState } from './useBuilderWorkspace';

/**
 * The workspace's slide-outs — settings (source control, GitHub, deploy) and the
 * "open it on your phone" hand-off — shared by both layouts. Both belong to a durable
 * project: a workspace held in this browser has no repository and no published build,
 * so it renders nothing rather than two doors that would fail.
 */
export function WorkspaceOverlays({ ws }: { ws: BuilderWorkspaceState }) {
  const { storageProjectId, modalityDef } = ws;
  if (storageProjectId === null) return null;
  return (
    <>
      <BuilderSettingsPanel open={ws.settingsOpen} onClose={() => ws.setSettingsOpen(false)} projectId={storageProjectId} onImported={ws.editor.refreshFiles} />
      {/* Mounted only where the device simulator is, since it hands off that modality's published build. */}
      {(modalityDef.center === 'device' || modalityDef.enableMobilePreview) && (
        <MobileDevicePanel
          open={ws.devicePanelOpen}
          onClose={() => ws.setDevicePanelOpen(false)}
          projectId={storageProjectId}
          onGoToPublish={() => ws.openRail('publish')}
        />
      )}
    </>
  );
}
