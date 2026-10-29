/*
 * No `'use client'` here on purpose. Imported only by `CanvasSurfaceStage`, which already
 * sits behind the canvas client boundary, so a directive would mark a second entry point
 * that does not exist.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { KnowledgeGraphView, type KnowledgePanelRenderProps } from '@builderforce/knowledge-graph-view';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { useConfirm } from '@/components/ConfirmProvider';
import { createKnowledgeSource } from '@builderforce/knowledge-browser';
import { createWebKnowledgeClient } from '@/lib/knowledge/webKnowledgeClient';
import { webDirectoryProviders } from '@/lib/knowledge/webDirectoryProviders';
import { reportKnowledgeDegraded } from '@/lib/knowledge/webHost';
import { knowledgeIntentFromQuery } from '@builderforce/agent-tools/prefetch';
import { useKnowledgeGraphLabels } from '@/lib/knowledge/labels';
import styles from './styles/surfaces.module.css';

/**
 * THE KNOWLEDGE SURFACE (PRD 38) — point it at a folder and see what it knows.
 *
 * Board-scoped: a knowledge graph is about the session's PROJECT, not one card, so there
 * is no card to enter it from. The view is the ONE `KnowledgeGraphView`; this host
 * supplies only ports — the shared browser source (`@builderforce/knowledge-browser`: API
 * client, Web Worker review) over the web's VFS/upload/Drive directories, the catalog
 * labels, `SlideOutPanel` for its side panels, `useConfirm` for the one destructive act (deleting a fact), and the canvas's ONE composer for
 * *Fix with agent* (`composeDraft` seeds it; the person presses send).
 *
 * Every host that mounts `CreationCanvas` gets it — the VS Code editor tab included —
 * because it is a key in `CanvasSurfaceStage`'s map, not a branch in a host.
 */
export interface CanvasKnowledgeSurfaceProps {
  /** The project this board belongs to; knowledge is stored per project. Null ⇒ explained empty state. */
  projectId: number | null;
  onExit: () => void;
  composeDraft?: (text: string) => void;
}

export function CanvasKnowledgeSurface({ projectId, onExit, composeDraft }: CanvasKnowledgeSurfaceProps) {
  const t = useTranslations('creationCanvas.surface.knowledge');
  const labels = useKnowledgeGraphLabels();
  const confirm = useConfirm();
  const workspaceTitle = t('workspaceTitle');
  // What a chat's knowledge chip opened the board on (focused refs, or the review
  // launcher) — read once: the view takes it as its initial state.
  const [intent] = useState(() => knowledgeIntentFromQuery(typeof window === 'undefined' ? '' : window.location.search));

  const source = useMemo(() => {
    if (projectId === null) return null;
    const client = createWebKnowledgeClient(projectId);
    return createKnowledgeSource({
      projectId,
      client,
      callPrice: () => client.judgeEstimate(),
      directorySources: () => webDirectoryProviders({ projectId, workspaceTitle }),
      onDegraded: reportKnowledgeDegraded,
    });
  }, [projectId, workspaceTitle]);

  const renderPanel = useCallback(({ open, title, onClose, children }: KnowledgePanelRenderProps): ReactNode => (
    <SlideOutPanel open={open} onClose={onClose} title={title}>{children}</SlideOutPanel>
  ), []);
  const confirmDelete = useCallback(
    (message: string) => confirm({ message, confirmLabel: labels.deleteFact, destructive: true }),
    [confirm, labels.deleteFact],
  );

  return (
    <section
      className={styles.placeSurface}
      data-testid="canvas-knowledge-surface"
      aria-label={t('regionLabel')}
      onKeyDown={(event) => { if (event.key === 'Escape' && event.target === event.currentTarget) { event.stopPropagation(); onExit(); } }}
    >
      {source ? (
        <KnowledgeGraphView
          source={source}
          labels={labels}
          renderPanel={renderPanel}
          confirm={confirmDelete}
          {...(intent.focus.length > 0 ? { initialFocus: intent.focus } : {})}
          openReview={intent.review}
          {...(composeDraft ? { onCompose: composeDraft } : {})}
        />
      ) : (
        <div className={styles.placeSurfaceBody} role="status">
          <strong>{t('noProjectTitle')}</strong>
          <p>{t('noProjectBody')}</p>
        </div>
      )}
    </section>
  );
}
