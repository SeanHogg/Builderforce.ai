import dynamic from 'next/dynamic';
import { canvasViewport } from '@builderforce/creation-canvas-contract';
import { WebsiteFrame } from '../WebsiteCanvas';
import { CanvasWebPage } from '../CanvasWebPage';
import { CanvasVideoEditor } from '../CanvasVideoEditor';
import { CanvasResumeEditor } from '../CanvasResumeEditor';
import { FrameBody } from '../FrameBody';
import { CanvasClockBody } from '../CanvasClockBody';
import { CanvasComponentBody } from '../CanvasComponentBody';
import { CalendarObjectBody } from '../CalendarObjectBody';
import { CanvasLegalDocumentUpload } from '../CanvasLegalDocumentUpload';
import type { CreationBodyProps } from './types';
import { useCreationNodeActions } from './nodeActions';
import { useCalendarBoardObjects, useFrameMemberCount } from './boardSubscriptions';
import { DiagnosticsBody } from './DiagnosticsBody';

/*
 * ADAPTERS — components that live outside `bodies/` (they are also mounted by full-size
 * surfaces and inspectors) bound to the one body contract. Each reads the card's actions
 * and hands its component exactly the props it already took, so none of those
 * components learns about the registry.
 */

/**
 * The REAL document, framed — not the board's own approximation of it. See
 * `WebsiteFrame`: a card drawn as React inherited the app's tokens and theme, so
 * a landing page turned dark when the operator toggled the canvas. `light` is
 * pinned here because a thumbnail has no room for a mode control; the `site`
 * surface is where the author checks the other one.
 */
export function WebsiteBody({ data }: CreationBodyProps) {
  const { edit } = useCreationNodeActions();
  return <WebsiteFrame
    data={data}
    viewport={canvasViewport(data.viewport)}
    colorScheme="light"
    {...(edit ? { onEdit: edit } : {})}
  />;
}

export function WebPageBody({ data }: CreationBodyProps) {
  const { edit } = useCreationNodeActions();
  return <CanvasWebPage data={data} {...(edit ? { onEdit: edit } : {})} />;
}

export function VideoBody({ data }: CreationBodyProps) {
  const { edit } = useCreationNodeActions();
  return <CanvasVideoEditor data={data} {...(edit ? { onEdit: edit } : {})} />;
}

/**
 * variant="card": the document only. Version, privacy, template, page setup and
 * the AI tools all moved to the inspector's résumé section (opened by clicking
 * this card — see `onNodeClick` and `ResumeInspectorSection` in
 * CreationCanvas.tsx), so this no longer needs the tailor/detach/share
 * callbacks that section uses instead.
 */
export function ResumeBody({ data }: CreationBodyProps) {
  const { edit } = useCreationNodeActions();
  return <CanvasResumeEditor variant="card" data={data} {...(edit ? { onEdit: edit } : {})} />;
}

/** A frame, and the count of what it holds — subscribed HERE, so only frames pay for it. */
export function FrameObjectBody({ id, data }: CreationBodyProps) {
  const { edit, openFrame } = useCreationNodeActions();
  const memberCount = useFrameMemberCount(id, true);
  return <FrameBody
    data={data}
    memberCount={memberCount}
    {...(edit ? { onToggleCollapsed: () => edit({ frameCollapsed: data.frameCollapsed !== true }) } : {})}
    {...(openFrame ? { onOpen: openFrame } : {})}
  />;
}

/**
 * The two clocks, from ONE component: a countdown and a count-up are the same
 * machine read from opposite ends. The `timer` kind shipped as a card with the
 * string "05:00" in its status and no way to start it; this is the running
 * clock the knowledge board had, on the canvas that is the front door.
 */
export function ClockBody({ data }: CreationBodyProps) {
  const { edit } = useCreationNodeActions();
  return <CanvasClockBody data={data} {...(edit ? { onEdit: edit } : {})} />;
}

export function ComponentBody({ data }: CreationBodyProps) {
  const { edit } = useCreationNodeActions();
  return <CanvasComponentBody data={data} {...(edit ? { onEdit: edit } : {})} />;
}

/**
 * The month, at card size — the SAME component the full-screen surface mounts,
 * with a different `variant`. There is no second calendar in this codebase to
 * keep in step, which is the whole reason the rail modality became an object.
 */
export function CalendarBody({ data }: CreationBodyProps) {
  const { edit, editObject, revealObject } = useCreationNodeActions();
  const board = useCalendarBoardObjects(data.source === 'board');
  return <CalendarObjectBody
    data={data}
    board={board}
    {...(edit && editObject ? { onEdit: edit, onEditObject: editObject } : {})}
    {...(revealObject ? { onOpenObject: revealObject } : {})}
  />;
}

/**
 * The one real UI control `legalDocument` needs beyond the stat rows
 * SpecObjectBody already draws for it — see the component's own header
 * for why this is a direct upload and not a BrainAction.
 */
export function LegalDocumentBody({ id, data }: CreationBodyProps) {
  const { edit } = useCreationNodeActions();
  return <CanvasLegalDocumentUpload objectId={id} data={data} {...(edit ? { onEdit: edit } : {})} />;
}

/** The tool runner is a whole product surface of its own; a board only pays for it
 *  once a diagnostic that carries a `toolId` is actually drawn. */
const CanvasToolBody = dynamic(() => import('./CanvasToolBody').then((module) => module.CanvasToolBody), { ssr: false });

/** A diagnostic is either a runnable tool or a recorded set of findings. */
export function DiagnosticsObjectBody(props: CreationBodyProps) {
  return typeof props.data.toolId === 'string' ? <CanvasToolBody {...props} /> : <DiagnosticsBody {...props} />;
}
