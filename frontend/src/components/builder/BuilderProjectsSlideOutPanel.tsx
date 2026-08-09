'use client';

import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { BuilderProjectsContent } from './BuilderProjectsContent';

/**
 * Builder's hamburger drawer — lists the tenant's builds (not the PM
 * Projects). Opening one focuses its Builder object and workspace on the canvas,
 * then closes the drawer; the currently-open project is ringed. Reuses the canonical
 * SlideOutPanel + the self-contained BuilderProjectsContent so the Canvas switcher
 * and the dashboard list stay one implementation.
 */
export function BuilderProjectsSlideOutPanel({
  open,
  onClose,
  currentStorageProjectId,
}: {
  open: boolean;
  onClose: () => void;
  /** Storage-project id of the build currently open, ringed in the list. */
  currentStorageProjectId?: number;
}) {
  const t = useTranslations('ide');
  return (
    <SlideOutPanel open={open} onClose={onClose} title={t('yourIdeProjects')} width="min(460px, 96vw)">
      <div style={{ padding: 16 }}>
        <BuilderProjectsContent
          highlightStorageProjectId={currentStorageProjectId}
          onNavigate={onClose}
        />
      </div>
    </SlideOutPanel>
  );
}
