'use client';

import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { IdeProjectsContent } from './IdeProjectsContent';

/**
 * The IDE's hamburger drawer — lists the tenant's IDE projects (not the PM
 * Projects). Opening one navigates to its backing storage project's IDE and
 * closes the drawer; the currently-open project is ringed. Reuses the canonical
 * SlideOutPanel + the self-contained IdeProjectsContent so the in-IDE switcher
 * and the dashboard list stay one implementation.
 */
export function IdeProjectsSlideOutPanel({
  open,
  onClose,
  currentStorageProjectId,
}: {
  open: boolean;
  onClose: () => void;
  /** Storage-project id of the IDE project currently open, ringed in the list. */
  currentStorageProjectId?: number;
}) {
  const t = useTranslations('ide');
  return (
    <SlideOutPanel open={open} onClose={onClose} title={t('yourIdeProjects')} width="min(460px, 96vw)">
      <div style={{ padding: 16 }}>
        <IdeProjectsContent
          highlightStorageProjectId={currentStorageProjectId}
          onNavigate={onClose}
        />
      </div>
    </SlideOutPanel>
  );
}
