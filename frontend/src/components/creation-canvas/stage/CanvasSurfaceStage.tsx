import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import { CanvasSurfaceRouter, type CanvasSurfaceNodes } from '../CanvasSurfaceRouter';
import { CanvasChatSurface, type CanvasChatSurfaceMember } from '../CanvasChatSurface';
import { CanvasAppSurface } from '../CanvasAppSurface';
import { CanvasInsightsSurface } from '../CanvasInsightsSurface';
import { CanvasIdeasSurface } from '../CanvasIdeasSurface';
import { CanvasPageSurface } from '../CanvasPageSurface';
import { CanvasPlaySurface } from '../CanvasPlaySurface';
import { CanvasSiteSurface } from '../CanvasSiteSurface';
import { CanvasTimelineSurface } from '../CanvasTimelineSurface';
import { CanvasFacilitateSurface } from '../CanvasFacilitateSurface';
import { CanvasFormSurface } from '../CanvasFormSurface';
import { CanvasCalendarSurface } from '../CanvasCalendarSurface';
import { CanvasSceneGeneratorPanel, CanvasWorldView } from '../canvasLazyPanels';
import type { CreationFlowNode } from '../CreationNode';
import type { CreationNodeData, CreationObjectKind } from '../types';
import type { useCanvasResumeShares } from '../hooks/useCanvasResumeShares';
import type { CanvasSessionAppActions } from '../hooks/useCanvasSessionApp';
import { useCanvasSessionFacts } from '../chrome/canvasSessionContext';
import type { BrainConversationProps } from './useBrainConversation';
import type { SceneMovieDraft } from '@/hooks/useCloudScene';

export interface CanvasSurfaceStageProps {
  surface: CanvasSurfaceId;
  hostSurfaces?: CanvasSurfaceNodes;
  /** The object the active surface is about, or null. */
  surfaceNode: CreationFlowNode | null;
  exitSurface: () => void;
  setSurface: (surface: CanvasSurfaceId) => void;
  /** The SITE the reader arrived by opening, so the App modality shows that object. */
  sessionApp: CanvasSessionAppActions;
  sessionTitle: string;
  nodes: CreationFlowNode[];
  /** Direct edits made on a surface can land — role and lock both allow it. */
  editable: boolean;
  updateNodeData: (nodeId: string, patch: Partial<CreationNodeData>) => void;
  appendAtCenter: (kind: CreationObjectKind, data?: Partial<CreationNodeData>) => unknown;
  revealObject: (nodeId: string) => void;
  conversation: BrainConversationProps;
  roster: readonly CanvasChatSurfaceMember[];
  /** The room surface, built by the host — it carries the 3D projection with it. */
  room: ReactNode;
  resume: Pick<ReturnType<typeof useCanvasResumeShares>, 'tailorResumeFromNode' | 'detachResumeFromNode' | 'createResumeShare' | 'listResumeShares' | 'revokeResumeShare'>;
  openGamePanel: (gameId: string) => void;
  setShareOpen: Dispatch<SetStateAction<boolean>>;
}

/**
 * The runtime that takes the centre. The board itself is not in the map — it is
 * the React Flow tree above, rendered unconditionally so the viewport, the
 * selection and every node's state survive a trip through another surface and
 * back. Adding a runtime is a key here plus an entry in `canvasSurfaces.ts`.
 */
export function CanvasSurfaceStage({
  surface, hostSurfaces, surfaceNode, exitSurface, setSurface, sessionApp, sessionTitle, nodes, editable, updateNodeData, appendAtCenter,
  revealObject, conversation, roster, room, resume, openGamePanel, setShareOpen,
}: CanvasSurfaceStageProps) {
  const { persistence } = useCanvasSessionFacts();
  const exitToBoard = () => setSurface('graph');
  /** The object-scoped runtimes' one write, offered only where the edit can land. */
  const editSurfaceNode: { onEdit?: (patch: Partial<CreationNodeData>) => void } = surfaceNode && editable
    ? { onEdit: (patch: Partial<CreationNodeData>) => updateNodeData(surfaceNode.id, patch) }
    : {};
  return <CanvasSurfaceRouter
          surface={surface}
          hostSurfaces={hostSurfaces}
          surfaces={{
            // The AI scene: a `scene` object's generation panel, entered from its card.
            // Object-scoped like the runtimes below, so `surfaceNode` going null is what
            // the effect above turns back into the board.
            scene3d: surfaceNode && surfaceNode.data.kind === 'scene' ? <CanvasSceneGeneratorPanel
              objectId={surfaceNode.id}
              data={surfaceNode.data}
              onExit={exitSurface}
              {...editSurfaceNode}
              // The scene's movie lands on the board as an ordinary `video` object —
              // the real timeline editor, where music and narration are added.
              {...(editable ? { onCreateMovie: (draft: SceneMovieDraft) => { appendAtCenter('video', { title: draft.title, status: 'Draft', videoTimeline: draft.videoTimeline, videoSources: draft.videoSources }); } } : {})}
            /> : null,
            // The zero-object case of this canvas: the same transcript, the same
            // composer, no board. Objects Brain creates during the conversation land on
            // the board behind it, which is what the footer's live count offers.
            chat: <CanvasChatSurface
              {...conversation}
              onOpenBoard={exitToBoard}
              objectCount={nodes.length}
              participants={roster}
            />,
            // The session read as ONE application. Board-scoped, so unlike the four
            // below it takes the nodes rather than a single object: `backend/server.js`,
            // `frontend/index.html` and the page they render are three cards and one
            // artifact, and there is no card to enter it from.
            app: <CanvasAppSurface nodes={nodes} session={sessionApp} persistence={persistence} sessionTitle={sessionTitle} onExit={exitToBoard} />,
            // What the session is worth, read back. Board-scoped for the same reason
            // `app` is — the metrics are about the whole session, not one card.
            insights: <CanvasInsightsSurface onExit={exitToBoard} />,
            // The idea scratchpad — board-scoped like `insights`. It reads the `idea` cards
            // straight off `nodes` and writes back through the SAME two board mutations every
            // other surface uses, so a captured line is a card on this board and nowhere else.
            // A viewer who cannot edit gets the list with capture disabled, not a missing input.
            ideas: <CanvasIdeasSurface
              nodes={nodes}
              onOpenObject={revealObject}
              onExit={exitToBoard}
              {...(editable ? {
                onCreate: (kind: 'idea' | 'customerInterview' | 'form', data: Partial<CreationNodeData>) => { appendAtCenter(kind, data); },
                onUpdate: updateNodeData,
              } : {})}
            />,
            room,
            // The five medium runtimes. Each takes the object the surface is ABOUT, so
            // each is rendered only when one resolves — `surfaceNode` going null is what
            // the effect above turns back into the board.
            page: surfaceNode ? <CanvasPageSurface
              data={surfaceNode.data}
              onExit={exitSurface}
              {...editSurfaceNode}
              onTailor={(prompt: string) => resume.tailorResumeFromNode(surfaceNode.id, prompt)}
              onDetach={(patch: Partial<CreationNodeData>) => resume.detachResumeFromNode(surfaceNode.id, patch)}
              shareActions={{
                create: (kind: 'view' | 'embed') => resume.createResumeShare(surfaceNode.id, kind),
                list: () => resume.listResumeShares(surfaceNode.id),
                revoke: (shareId: string) => resume.revokeResumeShare(surfaceNode.id, shareId),
              }}
            /> : null,
            play: surfaceNode ? <CanvasPlaySurface
              data={surfaceNode.data}
              onExit={exitSurface}
              // Shipping opens OVER the surfacerather than replacing it: distribution is
              // a panel about a build you are still looking at.
              onShip={() => openGamePanel(surfaceNode.id)}
              // Who is on this canvas, and the canvas's OWN invite door — not a second
              // sharing model for games. Playing is when a person wants both.
              players={roster}
              onInvite={() => setShareOpen(true)}
              objectId={surfaceNode.id}
            /> : null,
            site: surfaceNode ? <CanvasSiteSurface
              data={surfaceNode.data}
              onExit={exitSurface}
              {...editSurfaceNode}
            /> : null,
            timeline: surfaceNode ? <CanvasTimelineSurface
              data={surfaceNode.data}
              onExit={exitSurface}
              {...editSurfaceNode}
            /> : null,
            world: surfaceNode ? <CanvasWorldView
              data={surfaceNode.data}
              onExit={exitSurface}
              {...editSurfaceNode}
            /> : null,
            // THE ROOM. Same object-scoped shape as the four above, and the same reason
            // for it: a poll's own axis is the people answering it, which is not a thing
            // a ~340px card can be. `objectId` goes down so the published question set
            // points back at the card it came from.
            facilitate: surfaceNode ? <CanvasFacilitateSurface
              data={surfaceNode.data}
              objectId={surfaceNode.id}
              onExit={exitSurface}
              {...editSurfaceNode}
            /> : null,
            // THE FORM. Twin of facilitate: the card is the draft, this is the room
            // the form is RUN from. Publish/collect/close go through CardActs so Brain
            // and a person cannot disagree about what the card's `questions` mean.
            form: surfaceNode ? <CanvasFormSurface
              data={surfaceNode.data}
              objectId={surfaceNode.id}
              onExit={exitSurface}
              {...editSurfaceNode}
            /> : null,
            // THE MONTH. It used to be a BOARD surface in the rail — one grid welded to
            // one reading of one board. A calendar is a thing a person can have several
            // of (releases, sends, leave, on-call) and a rail entry is a mode you can
            // only be in one of, so the reading became a value on a `calendar` object and
            // this became the surface that object opens at full size.
            //
            // Note how little the host assembles: the calendar resolves its own source,
            // reads its own window and routes its own writes. That is deliberate — this
            // file is the standing god class, and "know how the calendar fetches" is the
            // kind of knowledge that made it one.
            calendar: surfaceNode ? <CanvasCalendarSurface
              data={surfaceNode.data}
              nodes={nodes}
              onExit={exitSurface}
              onOpenObject={revealObject}
              {...(editable ? {
                ...editSurfaceNode,
                onEditObject: updateNodeData,
              } : {})}
            /> : null,
          }}
        />;
}
