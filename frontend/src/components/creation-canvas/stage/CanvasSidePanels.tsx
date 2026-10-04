import type { Dispatch, SetStateAction } from 'react';
import type { Edge } from '@xyflow/react';
import type { CanvasHostCapture } from '@/lib/canvasHost';
import { CanvasFilesPanel } from '../CanvasFilesPanel';
import { CanvasTalktrackPanel } from '../CanvasTalktrackPanel';
import { CanvasMiroPanel } from '../CanvasMiroPanel';
import { CanvasSocialPanel } from '../CanvasSocialPanel';
import { CanvasAdsPanel } from '../CanvasAdsPanel';
import { CanvasOutlinePanel } from '../CanvasOutlinePanel';
import type { CanvasDockPanel } from '../CanvasBoardMenuBody';
import { CanvasGamePanel, CanvasPublishPanel, CanvasReleasesPanel } from '../canvasLazyPanels';
import type { CreationFlowNode } from '../CreationNode';
import { useCanvasSessionFacts } from '../chrome/canvasSessionContext';
import type { useCanvasFiles } from '../hooks/useCanvasFiles';
import type { useCanvasConnectedSources } from '../hooks/useCanvasConnectedSources';
import type { useCanvasPublishing } from '../hooks/useCanvasPublishing';
import type { useCanvasFileIntake } from '../hooks/useCanvasFileIntake';
import type { useCanvasNodePanels } from '../hooks/useCanvasNodePanels';

export interface CanvasSidePanelsProps {
  /** The ONE left-dock panel that is up — exclusivity is the data model. */
  dockPanel: CanvasDockPanel | null;
  closeDockPanel: () => void;
  files: Pick<ReturnType<typeof useCanvasFiles>, 'sessionFiles' | 'downloadCanvasFile' | 'revealObject'>;
  addFilesToCanvas: ReturnType<typeof useCanvasFileIntake>['addFilesToCanvas'];
  connectedAccountGate: (source: string) => boolean;
  sources: Pick<ReturnType<typeof useCanvasConnectedSources>, 'importMiroBoard' | 'addSocialFeedToBoard' | 'addSocialCampaignToBoard' | 'boardMedia'>;
  gameShipFocus: string | null;
  setGameShipFocus: Dispatch<SetStateAction<string | null>>;
  gamePanelTarget: ReturnType<typeof useCanvasPublishing>['gamePanelTarget'];
  talktrackOpen: boolean;
  setTalktrackOpen: Dispatch<SetStateAction<boolean>>;
  title: string;
  selectedNode: CreationFlowNode | null;
  /** The role or the object lock forbids a capture. */
  captureDisabled: boolean;
  onCapture: (capture: CanvasHostCapture) => void;
  publishFocus: string | null;
  setPublishFocus: Dispatch<SetStateAction<string | null>>;
  releaseFocus: string | null;
  setReleaseFocus: Dispatch<SetStateAction<string | null>>;
  nodes: CreationFlowNode[];
  edges: Edge[];
  /** Select an outline row's object and open its panel beside it. */
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  openNodePanel: ReturnType<typeof useCanvasNodePanels>['openNodePanel'];
  setOutlineHighlightIds: Dispatch<SetStateAction<ReadonlySet<string> | null>>;
}

/** The panels that open beside the board — the left dock's one panel, and the ship,
 *  record, publish and release panels — in the order they have always been mounted. */
export function CanvasSidePanels({
  dockPanel, closeDockPanel, files, addFilesToCanvas, connectedAccountGate, sources, gameShipFocus, setGameShipFocus, gamePanelTarget,
  talktrackOpen, setTalktrackOpen, title, selectedNode, captureDisabled, onCapture, publishFocus, setPublishFocus, releaseFocus,
  setReleaseFocus, nodes, edges, setSelectedId, setSelectedIds, openNodePanel, setOutlineHighlightIds,
}: CanvasSidePanelsProps) {
  const { sessionId, notify } = useCanvasSessionFacts();
  return <>
        {dockPanel === 'files' && <CanvasFilesPanel
          files={files.sessionFiles}
          onOpen={files.revealObject}
          onDownload={files.downloadCanvasFile}
          onClose={closeDockPanel}
          onImportFile={(file) => addFilesToCanvas([file], undefined, 'drive_import')}
          returnTo={`/create/${sessionId}`}
          onRequireAccount={connectedAccountGate}
        />}
        {gameShipFocus && gamePanelTarget && <CanvasGamePanel
          open
          onClose={() => setGameShipFocus(null)}
          projectId={gamePanelTarget.projectId}
          game={gamePanelTarget.game}
          onNotice={notify}
        />}
        {/* Always mounted: a walkthrough survives its own panel being closed. */}
        <CanvasTalktrackPanel
          open={talktrackOpen}
          onClose={() => setTalktrackOpen(false)}
          boardTitle={title}
          focus={selectedNode ? { id: selectedNode.id, title: selectedNode.data.title } : null}
          disabled={captureDisabled}
          onCapture={onCapture}
          onNotice={notify}
        />
        {publishFocus !== null && sessionId && <CanvasPublishPanel
          open
          onClose={() => setPublishFocus(null)}
          sessionId={sessionId}
          focusObjectId={publishFocus || null}
          onNotice={notify}
        />}
        {releaseFocus !== null && sessionId && <CanvasReleasesPanel
          open
          onClose={() => setReleaseFocus(null)}
          sessionId={sessionId}
          objectId={releaseFocus || null}
          onNotice={notify}
        />}
        {dockPanel === 'miro' && <CanvasMiroPanel
          onImport={sources.importMiroBoard}
          onClose={closeDockPanel}
          // `/settings/integrations`, not `/settings/connectors` — the latter does not
          // exist, and a "Connect Miro" button that 404s is worse than no button.
          // `ConnectorsGallery` lives on this page under the connectors category, which
          // is where a `miro` connection is actually created. No deep-link query here:
          // the page keeps its category and search in local state and reads no params,
          // so `?category=connectors` would be a promise the destination does not keep.
          connectHref="/settings/integrations"
        />}
        {dockPanel === 'social' && <CanvasSocialPanel
          onAddFeed={sources.addSocialFeedToBoard}
          onAddCampaign={sources.addSocialCampaignToBoard}
          boardMedia={sources.boardMedia}
          onClose={closeDockPanel}
        />}
        {dockPanel === 'ads' && <CanvasAdsPanel onClose={closeDockPanel} />}
        {dockPanel === 'outline' && <CanvasOutlinePanel
          nodes={nodes}
          edges={edges}
          onFocus={(nodeId, rect) => { setSelectedId(nodeId); setSelectedIds([nodeId]); openNodePanel(nodeId, 'config', rect); }}
          onClose={closeDockPanel}
          onVisibleChange={setOutlineHighlightIds}
        />}
  </>;
}
