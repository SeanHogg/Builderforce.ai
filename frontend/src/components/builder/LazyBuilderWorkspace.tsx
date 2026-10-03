'use client';

import dynamic from 'next/dynamic';

/**
 * `<BuilderWorkspace>`, loaded on demand: the editor, preview runtime and WebGPU
 * bundles ship only when a surface actually opens the IDE (a canvas Builder
 * object, a Studio project). Every surface that mounts the IDE uses this one.
 */
export const LazyBuilderWorkspace = dynamic(
  () => import('@/components/BuilderWorkspace').then((m) => m.BuilderWorkspace),
  { ssr: false },
);
