import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

export interface PromptPanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Text entry for the prompt. Always occupies the first, full-width row. */
  input: ReactNode;
  /** The tools: `+` and the `/` options menu. They wrap. */
  actions: ReactNode;
  /**
   * WHO is answering and WHAT you are addressing — "Acting as", the capability,
   * "To", a canvas scope. Each of these self-hides until it has something to say, and
   * rides in the tool row after the tools: the box keeps ONE row of controls under the
   * text, on a phone and in a 300px editor sidebar alike.
   */
  context?: ReactNode;
  /**
   * The ONE trailing control — the mic, Send or Stop (see `promptTrailingAction`).
   *
   * It lives in its own trailing region rather than at the end of `actions` because
   * "the thing that sends the message sits at the far right edge" is a property of the
   * composer, not of each host. It never wraps onto a second line.
   */
  primaryAction?: ReactNode;
  /** Chips, queued turns, or other state shown above the text entry. */
  status?: ReactNode;
  /** Popovers such as the shared @-mention picker. */
  overlay?: ReactNode;
  active?: boolean;
  dragging?: boolean;
}

/**
 * The single structural shell for every BuilderForce prompt surface — the web Brain,
 * the canvas and Studio dock, the editor panel — and the model the desktop apps' boxes
 * copy: one filled box, the text on top, one row of controls under it.
 *
 * Hosts own behavior and individual controls, but input/status/action placement,
 * focus treatment, spacing, and panel shape live here so no surface can grow a
 * different composer again. The `/` trigger's quiet "Work ▾" face is this package's
 * stylesheet, scoped to `.bf-prompt-panel`.
 */
export function PromptPanel({
  input,
  context,
  actions,
  primaryAction,
  status,
  overlay,
  active = false,
  dragging = false,
  className,
  style,
  ...rest
}: PromptPanelProps) {
  const actionGap = 'var(--prompt-panel-action-gap, var(--chat-ctl-gap, 6px))';
  const panelStyle: CSSProperties = {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--prompt-panel-gap, var(--chat-ctl-gap, 6px))',
    width: '100%',
    boxSizing: 'border-box',
    padding: 'var(--prompt-panel-pad-y, var(--chat-ctl-pad-y, 10px)) var(--prompt-panel-pad-x, var(--chat-ctl-pad-x, 12px))',
    borderRadius: 'var(--prompt-panel-radius, 18px)',
    border: `1px solid ${active ? 'var(--prompt-panel-active-border, var(--chat-input-active-border, #3b82f6))' : 'var(--prompt-panel-border, var(--chat-input-border, rgba(148,163,184,.35)))'}`,
    background: 'var(--prompt-panel-bg, var(--chat-input-bg, rgba(15,23,42,.96)))',
    boxShadow: active
      ? 'var(--prompt-panel-active-ring, var(--chat-input-active-ring, 0 0 0 1px #3b82f6))'
      : 'var(--prompt-panel-shadow, none)',
    transition: 'border-color 120ms ease, box-shadow 120ms ease, background 120ms ease',
    ...(dragging ? { borderStyle: 'dashed', background: 'var(--prompt-panel-drag-bg, var(--surface-interactive, rgba(59,130,246,.1)))' } : null),
    ...style,
  };

  return (
    <div
      {...rest}
      className={['bf-prompt-panel', active && 'bf-prompt-panel--active', dragging && 'bf-prompt-panel--drag', className].filter(Boolean).join(' ')}
      style={panelStyle}
    >
      {overlay}
      {status ? <div className="bf-prompt-panel__status">{status}</div> : null}
      <div className="bf-prompt-panel__input" style={{ display: 'flex', width: '100%', minWidth: 0 }}>{input}</div>
      <div
        className="bf-prompt-panel__actions"
        style={{ display: 'flex', alignItems: 'center', gap: actionGap, minWidth: 0 }}
      >
        {/* The chips. They wrap; the primary action below never does, so a narrow
            panel grows taller instead of pushing Send off the edge. */}
        <div
          className="bf-prompt-panel__actions-lead"
          style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: actionGap, minWidth: 0, flex: '1 1 auto' }}
        >
          {actions}
          {context}
        </div>
        {primaryAction ? (
          <div
            className="bf-prompt-panel__actions-primary"
            style={{ display: 'flex', alignItems: 'center', gap: actionGap, flex: '0 0 auto', marginLeft: 'auto' }}
          >
            {primaryAction}
          </div>
        ) : null}
      </div>
    </div>
  );
}
