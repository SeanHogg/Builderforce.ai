'use client';

/**
 * The reader's own panel-width choice — extracted out of SlideOutPanel so the
 * two hand-rolled drawers (AgentHostSlideOutPanel, CloudAgentSlideOutPanel)
 * that predate SlideOutPanel and still paint their own overlay/drawer markup
 * can offer the identical three-way control instead of a second copy of this
 * logic. `SlideOutPanel` itself is built on this same module.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMediaQuery } from '@/lib/useMediaQuery';

/**
 * The three widths, and only three (PRD 21 §2.4 / §3.4).
 *
 *   sheet (25%) — settings, profile, ⌘K, short forms
 *   wide  (60%) — index + detail, e.g. Workforce's fourteen sub-views
 *   full  (84vw) — dashboards that need the room; the board is one Esc away
 */
export type PanelWidth = 'sheet' | 'wide' | 'full';

export const PANEL_WIDTH_TOKEN: Record<PanelWidth, string> = {
  sheet: 'var(--panel-width-sheet)',
  wide: 'var(--panel-width-wide)',
  full: 'var(--panel-width-full)',
};

const WIDTH_ORDER: PanelWidth[] = ['sheet', 'wide', 'full'];

export const isNamedPanelWidth = (width: PanelWidth | string): width is PanelWidth =>
  width in PANEL_WIDTH_TOKEN;

export const resolvePanelWidth = (width: PanelWidth | string): string =>
  (isNamedPanelWidth(width) ? PANEL_WIDTH_TOKEN[width] : width);

/**
 * The width control is a choice between three widths — so it only exists where
 * there ARE three. At or below 900px `--panel-width-sheet/wide/full` all resolve
 * to the same 96vw and the drawer is forced full-bleed (globals.css), so on a
 * phone the three buttons are three ways to change nothing; they read as broken
 * chrome crowding a header that has no room for them either. Asked as
 * `min-width` rather than `max-width` deliberately: `useMediaQuery` reports
 * `false` until it has mounted, so the control stays HIDDEN for the first frame
 * and appears on a desktop, instead of flashing onto every phone.
 *
 * One rule, one place — the hook and the control below both ask it, so a caller
 * never has to know the breakpoint (or that there is one).
 */
const MULTI_WIDTH_MIN = 901;

function useWidthChoiceExists(): boolean {
  return useMediaQuery(`(min-width: ${MULTI_WIDTH_MIN}px)`);
}

const widthKey = (storageKey: string) => `bf-panel-width:${storageKey}`;

function readStoredWidth(storageKey: string | undefined): PanelWidth | null {
  if (!storageKey || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(widthKey(storageKey));
    return raw && isNamedPanelWidth(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Seeded from the caller's default, overridden by the reader, remembered per
 * destination (PRD 21 §11.4.4). Read in an effect rather than the initialiser
 * so the server and the first hydrated frame agree.
 */
export function usePanelWidth(storageKey: string | undefined, defaultWidth: PanelWidth | string) {
  const [chosenWidth, setChosenWidth] = useState<PanelWidth | null>(null);
  const choiceExists = useWidthChoiceExists();
  useEffect(() => {
    setChosenWidth(readStoredWidth(storageKey));
  }, [storageKey]);

  const chooseWidth = (next: PanelWidth) => {
    setChosenWidth(next);
    if (!storageKey) return;
    try {
      window.localStorage.setItem(widthKey(storageKey), next);
    } catch {
      /* private mode */
    }
  };

  const effectiveWidth = chosenWidth ?? defaultWidth;
  const showControl = choiceExists && Boolean(storageKey) && isNamedPanelWidth(effectiveWidth);
  return { effectiveWidth, showControl, chooseWidth };
}

/** The reader's escape hatch — the thing a full-screen page used to be. */
export function PanelWidthControl({
  value,
  onChange,
}: {
  value: PanelWidth;
  onChange: (next: PanelWidth) => void;
}) {
  const tCommon = useTranslations('common');
  // Decides its own visibility rather than making four call sites ask.
  const choiceExists = useWidthChoiceExists();
  if (!choiceExists) return null;
  return (
    <div className="ui-panel-width" role="group" aria-label={tCommon('panelWidth.label')}>
      {WIDTH_ORDER.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          aria-label={tCommon(`panelWidth.${option}`)}
          title={tCommon(`panelWidth.${option}`)}
        >
          <span aria-hidden="true" data-w={option} />
        </button>
      ))}
    </div>
  );
}
