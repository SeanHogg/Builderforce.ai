import type { ReactNode } from 'react';
import { BrainDock } from '../BrainDock';
import { brainDockWidth, type BrainDockMode, type BrainDockPreferences } from '../brainDockPreferences';
import type { BrainConversationProps } from './useBrainConversation';

export interface CanvasBrainDockHostProps {
  /** The dock is the placement in force and the surface is not the conversation itself. */
  drawn: boolean;
  conversation: BrainConversationProps;
  /** The prompt, when the reader has docked it into this panel. */
  composer: ReactNode;
  promptInPanel: boolean;
  /** Move the prompt back out onto the board. */
  onUndockPrompt: () => void;
  mode: BrainDockMode;
  preferences: BrainDockPreferences;
  updateBrainDock: (patch: Partial<BrainDockPreferences>, persist?: boolean) => void;
}

/**
 * Docked ONLY. An inline Brain renders inside its Object on the graph, and a
 * surface that IS the conversation renders it full-bleed, so rendering the edge
 * panel alongside either would put the same live conversation on screen twice —
 * the duplicate this placement model exists to prevent.
 */
export function CanvasBrainDockHost({ drawn, conversation, composer, promptInPanel, onUndockPrompt, mode, preferences, updateBrainDock }: CanvasBrainDockHostProps) {
  if (!drawn) return null;
  return <BrainDock
          // The prompt, when the reader has docked it — rendered as the panel's last row
          // rather than as a card parked under it. See `BrainDock`'s header.
          {...(promptInPanel ? { composer, onUndockPrompt } : {})}
          mode={mode}
          side={preferences.side}
          size={preferences.size}
          width={brainDockWidth(preferences)}
          onModeChange={(next) => updateBrainDock({ mode: next })}
          onSideChange={(side) => updateBrainDock({ side })}
          // Switching preset clears a stale drag width, so "expand" always expands.
          onSizeChange={(size) => updateBrainDock({ size, width: null })}
          onWidthChange={(width, commit) => updateBrainDock({ width }, commit)}
          onClose={() => updateBrainDock({ open: false })}
          {...conversation}
        />;
}
