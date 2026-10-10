// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { PromptUseCaseCatalog } from '@/components/PromptUseCasePicker';
import { Icon } from '@/components/ui/Icon';
import { useDismissOnOutsidePress } from '@/lib/useDismissable';
import type { ComposerAddMenuItem, ComposerStarters } from './types';

/**
 * THE starting points, the same on every prompt: a `+` row that opens the catalogue
 * INSIDE the box, above the text.
 *
 * It used to be three different things — a half-bordered "Choose a starting point" tab
 * hanging under the landing hero's prompt, a trigger button in the canvas composer's top
 * row, and nothing at all on the Studio home. One control now, reached from the `+` that
 * every composer already has; the host only says what picking an entry does.
 */
export function useComposerStarters(starters: ComposerStarters | undefined): {
  menuItem: ComposerAddMenuItem | null;
  catalog: ReactNode;
  open: boolean;
} {
  const t = useTranslations('chatInput');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const catalogId = useId();
  useDismissOnOutsidePress(rootRef, open, () => setOpen(false));

  const label = starters?.label ?? t('startingPoints');
  const menuItem = useMemo<ComposerAddMenuItem | null>(() => (starters
    ? { id: 'starting-points', icon: <Icon name="template" size={15} />, label, onSelect: () => setOpen(true) }
    : null), [starters, label]);
  // A lead row closes the list as it seeds the box, the same as a catalogue entry.
  const lead = useMemo(() => (starters?.lead
    ? { heading: starters.lead.heading, items: starters.lead.items.map((item) => ({ ...item, onSelect: () => { setOpen(false); item.onSelect(); } })) }
    : undefined), [starters?.lead]);

  if (!starters || !open) return { menuItem, catalog: null, open: false };
  return {
    menuItem,
    open,
    catalog: (
      <div ref={rootRef} data-testid="composer-starters">
        <PromptUseCaseCatalog
          open
          id={catalogId}
          onSelect={(entry) => { setOpen(false); starters.onSelect(entry); }}
          {...(lead ? { lead } : {})}
          {...(starters.preferCategory ? { preferCategory: starters.preferCategory } : {})}
        />
      </div>
    ),
  };
}
