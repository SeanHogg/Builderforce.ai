/**
 * The project's uploaded knowledge packs (PRD 40): its knowledge scopes of `kind: 'pack'`,
 * through THE knowledge client (`createWebKnowledgeClient`) — the pack registry of the browser.
 *
 * No `'use client'` of its own: only ever imported by client components.
 */

import { useEffect, useState } from 'react';
import { browserPackRegistry } from '@builderforce/knowledge-browser';
import type { KnowledgePackEntry } from '@builderforce/agent-tools/knowledge-index';
import { createWebKnowledgeClient } from './webKnowledgeClient';

export interface ProjectKnowledgePacks {
  packs: readonly KnowledgePackEntry[];
  loading: boolean;
  failed: boolean;
}

export function useProjectKnowledgePacks(projectId: number | null): ProjectKnowledgePacks {
  const [state, setState] = useState<ProjectKnowledgePacks>({ packs: [], loading: projectId != null, failed: false });
  useEffect(() => {
    if (projectId == null) { setState({ packs: [], loading: false, failed: false }); return undefined; }
    let live = true;
    setState((s) => ({ ...s, loading: true, failed: false }));
    browserPackRegistry(createWebKnowledgeClient(projectId)).list().then(
      (packs) => { if (live) setState({ packs, loading: false, failed: false }); },
      () => { if (live) setState({ packs: [], loading: false, failed: true }); },
    );
    return () => { live = false; };
  }, [projectId]);
  return state;
}
