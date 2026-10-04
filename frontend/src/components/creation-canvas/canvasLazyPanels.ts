import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import type { Canvas3DViewProps } from '@/components/canvas/Canvas3DView';
import type { CreationFlowNode } from './CreationNode';
import type { CanvasRoomSurfaceProps } from './CanvasRoomSurface';

export const Canvas3DView = dynamic(
  () => import('@/components/canvas/Canvas3DView')
    .then((module) => module.Canvas3DView as ComponentType<Canvas3DViewProps<CreationFlowNode>>),
  { ssr: false },
);

// Real WebGL (three.js + react-three-fiber + Rapier's WASM physics) — the
// heaviest dependency this canvas pulls in, and the first one. Dynamic +
// `ssr: false` for the same reason Canvas3DView is: no server-side render,
// and it must not sit in the main chunk for people who never open a `world`.
export const CanvasWorldView = dynamic(
  () => import('./CanvasWorldView').then((module) => module.CanvasWorldView),
  { ssr: false },
);

// The room — and, placed inside it, the session: the depth projection above opens at
// full size from the diorama on the table. Same WebGL stack as the world and split for
// the same reason — a person who only ever opens the board must not pay for three.js
// to have a room they have not pressed.
export const CanvasRoomSurface = dynamic(
  () => import('./CanvasRoomSurface')
    .then((module) => module.CanvasRoomSurface as ComponentType<CanvasRoomSurfaceProps<CreationFlowNode>>),
  { ssr: false },
);

// The `scene3d` surface — a `scene` object's generation panel. Dynamic for the same
// reason: it lazily reaches for the studio engine (WebGPU diffusion) only once a
// `scene` object is actually opened, never in the main chunk otherwise.
export const CanvasSceneGeneratorPanel = dynamic(
  () => import('./CanvasSceneGeneratorPanel').then((module) => module.CanvasSceneGeneratorPanel),
  { ssr: false },
);

export const VoiceConfigPanel = dynamic(
  () => import('@/components/builder/VoiceConfigPanel').then((module) => module.VoiceConfigPanel),
  { ssr: false },
);

export const AITrainingPanel = dynamic(
  () => import('@/components/AITrainingPanel').then((module) => module.AITrainingPanel),
  { ssr: false },
);

export const CanvasGamePanel = dynamic(
  () => import('./CanvasGamePanel').then((module) => module.CanvasGamePanel),
  { ssr: false },
);

export const CanvasPublishPanel = dynamic(
  () => import('./CanvasPublishPanel').then((module) => module.CanvasPublishPanel),
  { ssr: false },
);

export const CanvasReleasesPanel = dynamic(
  () => import('./CanvasReleasesPanel').then((module) => module.CanvasReleasesPanel),
  { ssr: false },
);
