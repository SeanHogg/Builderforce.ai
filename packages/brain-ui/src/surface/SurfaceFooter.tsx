import type { ReactNode } from 'react';

/**
 * <SurfaceFooter> — the pinned bottom of every AI surface, extracted from the web
 * panel's `BrainComposerArea`: the tool approval, the open ask-user question, the
 * composer, then a one-line status (uploading…) and a footnote (the AI disclosure).
 *
 * Pinned in BOTH states of a surface (empty and in-thread), so the input never jumps
 * when the first message turns the empty state into a conversation.
 */
export interface SurfaceFooterProps {
  /** A pending tool approval (`ToolConfirmBar`). */
  confirm?: ReactNode;
  /** The open ask-user question (`PendingQuestionBanner`). */
  question?: ReactNode;
  /** Live sub-agents and similar strips that belong with the run, above the box. */
  above?: ReactNode;
  /** The composer (`BrainComposer` through the host's adapter). */
  composer: ReactNode;
  /** A transient one-liner under the box (uploading…). */
  status?: ReactNode;
  /** A quiet note under everything (the AI disclosure). */
  footnote?: ReactNode;
  className?: string;
  /** Extra attributes a host keys on (session-replay masking, test ids). */
  dataAttrs?: Record<`data-${string}`, string>;
}

export function SurfaceFooter({ confirm, question, above, composer, status, footnote, className, dataAttrs }: SurfaceFooterProps) {
  return (
    <div className={['bf-surface__footer', className].filter(Boolean).join(' ')} {...dataAttrs}>
      {above}
      {confirm}
      {question}
      {composer}
      {status != null && status !== false && <div className="bf-surface__status" role="status">{status}</div>}
      {footnote}
    </div>
  );
}
