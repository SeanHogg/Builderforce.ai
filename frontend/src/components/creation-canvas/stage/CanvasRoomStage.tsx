import type { Canvas3DViewProps } from '@/components/canvas/Canvas3DView';
import type { CanvasRoomSurfaceProps } from '../CanvasRoomSurface';
import type { CreationFlowNode } from '../CreationNode';
import { BrainSurfaceProvider } from '../brainSurfaceContext';
import { canvasNodeDimensions } from '../creationCanvasLayout';
import { Canvas3DView, CanvasRoomSurface } from '../canvasLazyPanels';
import { useCanvasSessionFacts } from '../chrome/canvasSessionContext';
import type { useCanvasBrainSurface } from '../hooks/useCanvasBrainSurface';

type RoomProps = CanvasRoomSurfaceProps<CreationFlowNode>;
type SceneProps = Canvas3DViewProps<CreationFlowNode>;

export interface CanvasRoomStageProps extends Pick<RoomProps, 'members' | 'speech' | 'onSelectSpeech' | 'currentUserId' | 'live' | 'onPresence' | 'sceneInput' | 'creations' | 'onOpenCreation' | 'onExit'> {
  title: string;
  /** The Brain surface the board's own cards read — the session brings it with it. */
  brainSurface: ReturnType<typeof useCanvasBrainSurface>['brainSurface'];
  threeDNodes: SceneProps['nodes'];
  edges: SceneProps['edges'];
  describe: SceneProps['describe'];
  renderCard: SceneProps['renderCard'];
  selectedIds: SceneProps['selectedIds'];
  onSelect: SceneProps['onSelect'];
  onMove: NonNullable<SceneProps['onMove']>;
  /** A designed room goes on sale through the same publish panel as any card. */
  onPublishRoom: (roomObjectId: string) => void;
  /** Two or more models are being compared, so the session opens at full size. */
  sessionInitiallyOpen: boolean;
}

/**
 * THE ROOM, with the session in it — board-scoped like `app` and `insights`.
 * It is handed the roster and live presence the host already holds (no second
 * answer to "who is here") and the projection's input, drawn small on the table
 * and full size through `renderSession`, whose (X) and Escape minimise it. Its
 * stations read the board through `CanvasBoardBridgeProvider`, not props.
 */
export function CanvasRoomStage({
  title, members, speech, onSelectSpeech, currentUserId, live, onPresence, sceneInput, creations, onOpenCreation, onExit,
  brainSurface, threeDNodes, edges, describe, renderCard, selectedIds, onSelect, onMove, onPublishRoom, sessionInitiallyOpen,
}: CanvasRoomStageProps) {
  const { sessionId, canEdit } = useCanvasSessionFacts();
  return <CanvasRoomSurface
              sessionId={sessionId}
              sessionTitle={title}
              members={members}
              speech={speech}
              onSelectSpeech={onSelectSpeech}
              currentUserId={currentUserId}
              live={live}
              onPresence={onPresence}
              sceneInput={sceneInput}
              // The faces are the board's own cards, and some of them read the Brain
              // surface — whose provider wraps the board, not the surfaces — so the
              // session brings the same one with it.
              renderSession={({ onMinimize, exitLabel }) => <BrainSurfaceProvider value={brainSurface}><Canvas3DView
                nodes={threeDNodes}
                edges={edges}
                describe={describe}
                renderCard={renderCard}
                measure={canvasNodeDimensions}
                selectedIds={selectedIds}
                onSelect={onSelect}
                onMove={canEdit ? onMove : undefined}
                onExit={onMinimize}
                exitLabel={exitLabel}
                initialDepthMode={sceneInput.depthMode}
              /></BrainSurfaceProvider>}
              creations={creations}
              onOpenCreation={onOpenCreation}
              // A designed room goes on sale through the same publish panel as any card.
              {...(canEdit ? { onPublishRoom } : {})}
              sessionInitiallyOpen={sessionInitiallyOpen}
              onExit={onExit}
            />;
}
