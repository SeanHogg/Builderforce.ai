'use client';

/**
 * "Take me to the fix" — the routing behind an inspection recommendation.
 *
 * A recommendation names a problem; `RECOMMENDATION_TARGET` names where it is
 * fixed. Acting on one is three things happening in order, and getting any of
 * them wrong is what made the Fix button feel broken:
 *
 *  1. switch to the tab where the fix is made;
 *  2. if the fix is a details FIELD, open the edit form (the field only exists in
 *     edit mode) and remember which field, because it does not exist to focus yet;
 *  3. if the fix is a PRD, remember which DOCUMENT — the architecture fix used to
 *     drop the user on a list of every PRD and leave them to find the right one.
 *
 * The remembered field and document are PENDING rather than permanent: each is
 * consumed once, by the surface that can act on it, so re-rendering the panel does
 * not re-open a drawer the user just closed. Re-opening the panel re-arms them.
 */
import { useCallback, useEffect, useState } from 'react';
import type { InspectionRecommendation } from '@/lib/projectInspection';
import {
  RECOMMENDATION_TARGET,
  type DetailsFocusTarget,
  type ProjectPanelTab,
} from './projectPanelTabs';

export interface RecommendationRouting {
  /** The PRDs tab reports back through `consumeSpec` once it has opened these. */
  pendingSpecKind: string | null;
  pendingSpecId: string | null;
  consumeSpec(): void;
  /** Act on a recommendation: switch tab, open the form, queue the focus. */
  target(rec: InspectionRecommendation): void;
}

export function useRecommendationRouting({
  open,
  activeTab,
  initialSpecKind,
  initialSpecId,
  onOpenTab,
  onOpenEditForm,
  editing,
}: {
  open: boolean;
  activeTab: ProjectPanelTab;
  initialSpecKind: string | null;
  initialSpecId: string | null;
  onOpenTab: (tab: ProjectPanelTab) => void;
  onOpenEditForm: () => void;
  /** Re-runs the focus attempt once the edit-only field has actually mounted. */
  editing: boolean;
}): RecommendationRouting {
  const [pendingFocus, setPendingFocus] = useState<DetailsFocusTarget | null>(null);
  const [pendingSpecKind, setPendingSpecKind] = useState<string | null>(initialSpecKind);
  const [pendingSpecId, setPendingSpecId] = useState<string | null>(initialSpecId);

  // Re-arm the requested document each time the panel is opened, so re-opening
  // from the same affordance lands on it again after the first visit consumed it.
  useEffect(() => { if (open) setPendingSpecKind(initialSpecKind); }, [open, initialSpecKind]);
  useEffect(() => { if (open) setPendingSpecId(initialSpecId); }, [open, initialSpecId]);

  // Once a "Fix" has switched to the details tab (and opened the edit form when
  // needed), scroll the target field into view and focus it.
  useEffect(() => {
    if (!pendingFocus || activeTab !== 'details') return;
    const timer = setTimeout(() => {
      const el = document.getElementById(pendingFocus);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.focus();
      }
      setPendingFocus(null);
    }, 60);
    return () => clearTimeout(timer);
  }, [pendingFocus, activeTab, editing]);

  const target = useCallback((rec: InspectionRecommendation) => {
    const dest = RECOMMENDATION_TARGET[rec.key];
    if (!dest) return;
    onOpenTab(dest.tab);
    // Set before the details-only early return: a PRDs fix names the document it
    // is about, and the tab it lands on is only half of "take me to the fix".
    if (dest.specKind) setPendingSpecKind(dest.specKind);
    if (dest.tab !== 'details') return;
    if (dest.edit) onOpenEditForm();
    if (dest.focus) setPendingFocus(dest.focus);
  }, [onOpenTab, onOpenEditForm]);

  const consumeSpec = useCallback(() => {
    setPendingSpecKind(null);
    setPendingSpecId(null);
  }, []);

  return { pendingSpecKind, pendingSpecId, consumeSpec, target };
}
