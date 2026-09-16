import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

export interface PromptPanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Text entry for the prompt. Always occupies the first, full-width row. */
  input: ReactNode;
  /** Context, mode, model and voice controls for the second row. They wrap. */
  actions: ReactNode;
  /**
   * The ONE primary control for the composer — Send, Stop, or Queue.
   *
   * It lives in its own trailing region rather than at the end of `actions`
   * because "the thing that sends the message sits at the far right edge" is a
   * property of the composer, not of each host: the web composer pinned it with
   * an ad-hoc `marginLeft: 'auto'` on an unrelated chip, and the editor composer
   * — which has no such chip — left Send/Stop floating in the middle of the row
   * behind whatever chips happened to be rendered. Given here, neither host can
   * place it differently again, and it never wraps onto a second line.
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
 * The single structural shell for every BuilderForce prompt surface.
 *
 * Hosts own behavior and individual controls, but input/status/action placement,
 * focus treatment, spacing, and panel shape live here so web, Canvas, marketing,
 * and editor integrations cannot grow different composer markup again.
 */
export function PromptPanel({
  input,
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
    padding: 'var(--prompt-panel-pad-y, var(--chat-ctl-pad-y, 8px)) var(--prompt-panel-pad-x, var(--chat-ctl-pad-x, 10px))',
    borderRadius: 'var(--prompt-panel-radius, 18px)',
    border: `1px solid ${active ? 'var(--prompt-panel-active-border, var(--chat-input-active-border, #3b82f6))' : 'var(--prompt-panel-border, var(--chat-input-border, rgba(148,163,184,.35)))'}`,
    background: 'var(--prompt-panel-bg, var(--chat-input-bg, rgba(15,23,42,.96)))',
    boxShadow: active
      ? 'var(--prompt-panel-active-ring, var(--chat-input-active-ring, 0 0 0 1px #3b82f6)), var(--prompt-panel-shadow, var(--chat-input-shadow, 0 8px 24px rgba(0,0,0,.16)))'
      : 'var(--prompt-panel-shadow, var(--chat-input-shadow, 0 8px 24px rgba(0,0,0,.16)))',
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
