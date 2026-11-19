/**
 * The project's uploaded knowledge packs (PRD 40): its knowledge scopes of `kind: 'pack'`,
 * through THE knowledge client (`createWebKnowledgeClient`) — the pack registry of the browser.
 *
 * No `'use client'` of its own: only ever imported by client components.
 */

import { useEffect, useMemo, useState } from 'react';
import { browserPackRegistry } from '@builderforce/knowledge-browser';
import type { KnowledgePackEntry } from '@builderforce/agent-tools/knowledge-index';
import { createWebKnowledgeClient } from './webKnowledgeClient';

export interface ProjectKnowledgePacks {
  packs: readonly KnowledgePackEntry[];
  loading: boolean;
  failed: boolean;
}

const NO_PROJECT: ProjectKnowledgePacks = { packs: [], loading: false, failed: false };

export function useProjectKnowledgePacks(projectId: number | null): ProjectKnowledgePacks {
  // The answer is held WITH the project it was read for, so `loading` is derived (no
  // answer for THIS project yet) rather than set synchronously when the project changes.
  const [loaded, setLoaded] = useState<{ projectId: number; packs: readonly KnowledgePackEntry[]; failed: boolean } | null>(null);
  useEffect(() => {
    if (projectId == null) return undefined;
    let live = true;
    browserPackRegistry(createWebKnowledgeClient(projectId)).list().then(
      (packs) => { if (live) setLoaded({ projectId, packs, failed: false }); },
      () => { if (live) setLoaded({ projectId, packs: [], failed: true }); },
    );
    return () => { live = false; };
  }, [projectId]);
  return useMemo<ProjectKnowledgePacks>(() => {
    if (projectId == null) return NO_PROJECT;
    if (loaded?.projectId === projectId) return { packs: loaded.packs, loading: false, failed: loaded.failed };
    // Still reading this project: the last list stays on screen until the answer lands.
    return { packs: loaded?.packs ?? [], loading: true, failed: false };
  }, [projectId, loaded]);
}
