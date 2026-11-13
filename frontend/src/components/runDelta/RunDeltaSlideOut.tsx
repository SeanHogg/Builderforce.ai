/**
 * The Run Delta panel on the web (PRD 41 §C11.2): the shared `RunDeltaPanel`, docked in the app's `SlideOutPanel`
 * (never a modal). ONE mount for every web surface that opens a delta — a run's card and a project's history row.
 * There is no editor on the web, so finding locations read as text (no Open code).
 */

import { useCallback, type ReactNode } from 'react';
import { RunDeltaPanel, type KnowledgePanelRenderProps, type RunDeltaLabels } from '@builderforce/knowledge-graph-view';
import type { RunDelta } from '@builderforce/run-delta';
import { SlideOutPanel } from '@/components/SlideOutPanel';

export interface RunDeltaSlideOutProps {
  /** The open delta, or null when the panel is closed. */
  delta: RunDelta | null;
  labels: RunDeltaLabels;
  onClose(): void;
  /** Seeds the host's composer with the resolve directive (PRD 41 §C11 "Fix with agent"). Only pre-fills; never auto-dispatches. */
  onResolve?: (() => void) | undefined;
  /** Copies the full delta results as a diagnostic (host owns the clipboard + feedback). */
  onCopyDiagnostics?: (() => void) | undefined;
}

export function RunDeltaSlideOut({ delta, labels, onClose, onResolve, onCopyDiagnostics }: RunDeltaSlideOutProps) {
  const renderPanel = useCallback(({ open, title, onClose: close, children }: KnowledgePanelRenderProps): ReactNode => (
    <SlideOutPanel open={open} onClose={close} title={title}>{children}</SlideOutPanel>
  ), []);
  if (!delta) return null;
  return (
    <RunDeltaPanel
      open
      delta={delta}
      labels={labels}
      onClose={onClose}
      compact={false}
      renderPanel={renderPanel}
      onResolve={onResolve}
      onCopyDiagnostics={onCopyDiagnostics}
    />
  );
}
