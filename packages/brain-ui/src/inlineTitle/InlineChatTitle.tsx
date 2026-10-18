import { useEffect, useRef, useState, type CSSProperties } from 'react';

/**
 * THE inline chat title — a chat's own name, edited where it is shown.
 *
 * Every AI surface names the open chat in its header, and until now the only way to
 * change that name was a Rename button on a chat-history row: you had to leave the
 * conversation, find the right row, open its actions, and type into a field there.
 * This is the same edit without the detour — click the title, and it becomes a text
 * field in place; Enter saves, Escape puts it back.
 *
 * THE RULES, and why each exists:
 *
 * - it renders as a BUTTON, not a form control, so the header looks exactly as it did
 *   until you ask for the field. A permanent input in a header reads as an unfinished
 *   control on all three surfaces.
 * - click (or Enter/Space on the button — it is a real `<button>`) swaps to an input,
 *   focused with its text SELECTED, so typing replaces the title rather than appending.
 * - Enter commits, Escape reverts, blur commits — but ONLY a non-blank value. A blank
 *   title is never saved: it is how a chat ends up unnamed, and the save path
 *   (`useBrainChats.rename`) guards it too.
 * - the session commits AT MOST ONCE. Enter unmounts the field, and its blur would
 *   otherwise fire and commit the same value a second time; `settled` is the same
 *   guard the shared history row uses (`useChatRowActions`).
 * - a successful commit shows the new title immediately, before the host's chat list
 *   has re-read it, so the header never flickers back to the old name.
 * - with no chat yet there is nothing to rename, and the affordance is not rendered at
 *   all — a "New chat" placeholder must not invite an edit that cannot be saved.
 *
 * The draft lives in local state, so a parent re-render (a streaming turn, a chat list
 * refresh) does not wipe what someone is in the middle of typing.
 */
export interface InlineChatTitleLabels {
  /** The un-edited title's accessible name — "Edit title", plus the current title. */
  edit: string;
  /** The field's accessible name. */
  label: string;
  /** Announced when the edit is committed / reverted (a polite status). */
  save: string;
  /** Announced as the accessible name of the revert affordance. */
  cancel: string;
}

export const DEFAULT_INLINE_CHAT_TITLE_LABELS: InlineChatTitleLabels = {
  edit: 'Edit chat title',
  label: 'Chat title',
  save: 'Save chat title',
  cancel: 'Cancel',
};

export interface InlineChatTitleProps {
  /** The chat's current title, or the host's placeholder when there is no chat yet. */
  title: string;
  /** The chat being named — `null` while there is none, which renders no affordance. */
  chatId?: number | null;
  /** Persist the new title. Called at most once per edit, and never for a blank value. */
  onRename?: (id: number, title: string) => Promise<unknown> | void;
  /** The host's copy — never hardcoded English at a call site. */
  labels?: Partial<InlineChatTitleLabels>;
  /** Extra class on the wrapper (a host's own layout hook). */
  className?: string;
  /** The committed title as the button shows it — a host with longer/wrapping chrome. */
  titleClassName?: string;
}

export function InlineChatTitle({
  title,
  chatId = null,
  onRename,
  labels: overrides,
  className,
  titleClassName,
}: InlineChatTitleProps) {
  const labels = { ...DEFAULT_INLINE_CHAT_TITLE_LABELS, ...overrides };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  /** What the button shows: the prop, or an un-committed-but-committed-locally edit. */
  const [shown, setShown] = useState<string | null>(null);
  /** The edit already committed or reverted — Enter unmounts the field and its blur fires again. */
  const settled = useRef(false);
  /** The title the current edit started from (an unchanged edit is not a write). */
  const from = useRef('');
  const input = useRef<HTMLInputElement | null>(null);

  // A different chat is a different title: drop a stale local one and any open edit.
  useEffect(() => {
    setShown(null);
    if (editing) { setEditing(false); setDraft(''); settled.current = false; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  const start = () => {
    if (chatId == null) return;
    settled.current = false;
    from.current = shown ?? title;
    setDraft(from.current);
    setEditing(true);
  };

  const end = () => { setEditing(false); setDraft(''); };

  const commit = async (value: string) => {
    if (settled.current) return;
    settled.current = true;
    const next = value.trim();
    const previous = from.current.trim();
    end();
    // Blank, or the same name it already had: not a rename. Nothing is written.
    if (!next || next === previous || chatId == null) return;
    setShown(next);
    try { await onRename?.(chatId, next); } catch { /* the host surfaces its own error */ }
  };

  const revert = () => {
    if (settled.current) return;
    settled.current = true;
    end();
  };

  // Focus + select on the frame the field appears, so typing replaces the title.
  useEffect(() => {
    if (!editing) return;
    const el = input.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing]);

  const text = shown ?? title;
  const name = editing ? labels.label : `${labels.edit}: ${text}`;

  if (!editing) {
    // Nothing to rename: no chat yet, so no button and nothing to focus.
    if (chatId == null) return <span className={['bf-inline-title', titleClassName].filter(Boolean).join(' ')}>{text}</span>;
    return (
      <span className={['bf-inline-title', className].filter(Boolean).join(' ')}>
        <button
          type="button"
          className={['bf-inline-title__button', titleClassName].filter(Boolean).join(' ')}
          onClick={start}
          title={text}
          aria-label={name}
          style={TITLE_BUTTON}
        >
          {text}
        </button>
      </span>
    );
  }

  return (
    <span className={['bf-inline-title', className].filter(Boolean).join(' ')}>
      <input
        ref={input}
        className="bf-inline-title__input"
        style={TITLE_INPUT}
        value={draft}
        // `onChange`, not onInput: a host may pass a controlled value with a lag.
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void commit(draft); }
          else if (e.key === 'Escape') { e.preventDefault(); revert(); }
        }}
        onBlur={() => void commit(draft)}
        aria-label={labels.label}
        placeholder={labels.label}
        title={labels.label}
      />
      {/* Keyboard-only users need the two outcomes named; both are also Enter/Escape. */}
      <span className="bf-inline-title__hint" style={TITLE_HINT} aria-hidden>{labels.save} · {labels.cancel}</span>
    </span>
  );
}

/**
 * The presentation, inline rather than in `styles.css`: this component must look right
 * in three hosts whose chrome differs (the editor's one-line header, Rovr's chips, the
 * web panel's roomier row) and whose stylesheets are three separate files. The button
 * inherits its host's font, colour and size so it reads as the title it replaces; the
 * field takes the box that says "type here".
 */
const TITLE_BUTTON: CSSProperties = {
  font: 'inherit',
  color: 'inherit',
  padding: 0,
  margin: 0,
  border: 'none',
  background: 'none',
  textAlign: 'inherit',
  cursor: 'text',
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const TITLE_INPUT: CSSProperties = {
  font: 'inherit',
  color: 'inherit',
  background: 'var(--bf-surface, transparent)',
  border: '1px solid var(--bf-border, currentColor)',
  borderRadius: 4,
  padding: '0 4px',
  margin: 0,
  minWidth: 120,
  maxWidth: '100%',
};

const TITLE_HINT: CSSProperties = { display: 'none' };