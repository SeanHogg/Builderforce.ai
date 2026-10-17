/**
 * The `/` menu's MODE tab — what the next turn is allowed to do: the conversation mode
 * (Chat | Work), persistent memory, auto-approve, and the two actions that act on the
 * conversation itself (consolidate, fork). Presentational; the host wires each section.
 */
import type { PromptOptionsLabels } from './types';

/** One selectable conversation mode. `value` is the host's stable, non-translatable id. */
export interface PromptOptionsModeChoice {
  value: string;
  label: string;
  hint?: string;
  icon?: string;
}

/**
 * Conversation mode for this turn — on BuilderForce, Chat vs Work.
 *
 * It lives in the `/` menu rather than beside it for the same reason the model does:
 * a composer that grows one pill per setting is a composer nobody can use on a phone.
 * The trigger keeps naming the ARMED mode, so "can this turn dispatch real work?" is
 * still answerable without opening anything.
 */
export interface PromptOptionsMode {
  value: string;
  onChange: (value: string) => void;
  choices: PromptOptionsModeChoice[];
}

/** Persistent memory for this conversation, when the host has one to offer. */
export interface PromptOptionsMemory {
  enabled: boolean;
  onChange: (on: boolean) => void;
  /** What being on/off means here — shown under the label. */
  describe?: (on: boolean) => string;
  /** Why it cannot be used right now. Set ⇒ the row is inert and states the reason. */
  unavailableReason?: string;
}

/** Whether tool and canvas actions run without a separate approval prompt. */
export interface PromptOptionsAutoMode {
  enabled: boolean;
  onChange: (on: boolean) => void;
  /** What enabling this setting means on the current host. */
  description?: string;
}

/**
 * The two actions that act on the CONVERSATION rather than on the next turn:
 * consolidate it into a compact summary, or fork that summary into a new chat.
 *
 * They used to be two always-visible pills in the action row on both hosts (the
 * web composer through a `ConsolidateForkControl`, the VS Code webview through a
 * hand-rolled copy of the same two buttons) — four controls that were inert for
 * most of a chat's life and, on a narrow panel, crowded out Send. Here they get
 * room to say what they do, and the host only supplies state + handlers.
 */
export interface PromptOptionsSession {
  /** The chat is long enough / idle enough for a summary to mean anything. */
  canConsolidate: boolean;
  consolidating?: boolean;
  forking?: boolean;
  onConsolidate: () => void;
  onFork: () => void;
}

/* Consolidate = collapse the conversation inward into a compact summary. */
const IconConsolidate = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 5.5 4.5 8 2 10.5M14 5.5 11.5 8 14 10.5M6.5 3v10M9.5 3v10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
/* Fork = branch the conversation into a new one (git-branch glyph). */
const IconFork = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="4" cy="3.5" r="1.5" fill="currentColor" /><circle cx="4" cy="12.5" r="1.5" fill="currentColor" /><circle cx="12" cy="3.5" r="1.5" fill="currentColor" /><path d="M4 5v6M4 8h4.5A3.5 3.5 0 0 0 12 4.5V5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export interface ModePaneProps {
  labels: PromptOptionsLabels;
  mode?: PromptOptionsMode;
  memory?: PromptOptionsMemory;
  autoMode?: PromptOptionsAutoMode;
  session?: PromptOptionsSession;
  /** Close the menu after an action that ends the visit. */
  close: () => void;
}

export function ModePane({ labels, mode, memory, autoMode, session, close }: ModePaneProps) {
  return (
    <>
      {mode && (
        <>
          {mode.choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={choice.value === mode.value}
              className={`bf-pmenu__item${choice.value === mode.value ? ' is-active' : ''}`}
              onClick={() => { mode.onChange(choice.value); close(); }}
            >
              <span className="bf-pmenu__ico" aria-hidden="true">{choice.icon ?? ''}</span>
              <span className="bf-pmenu__lbl">
                {choice.label}
                {choice.hint && <span className="bf-pmenu__desc">{choice.hint}</span>}
              </span>
              <span className="bf-pmenu__check" aria-hidden="true">{choice.value === mode.value ? '✓' : ''}</span>
            </button>
          ))}
        </>
      )}

      {memory && (
        <>
          {mode && <div className="bf-pmenu__sep" />}
          <button
            type="button"
            role="checkbox"
            aria-checked={memory.enabled}
            disabled={!!memory.unavailableReason}
            className={`bf-pmenu__item${memory.enabled && !memory.unavailableReason ? ' is-active' : ''}`}
            title={memory.unavailableReason}
            onClick={() => { if (!memory.unavailableReason) memory.onChange(!memory.enabled); }}
          >
            <span className="bf-pmenu__ico" aria-hidden="true">🧠</span>
            <span className="bf-pmenu__lbl">
              {labels.memory}
              {(memory.unavailableReason ?? memory.describe?.(memory.enabled)) && (
                <span className="bf-pmenu__desc">{memory.unavailableReason ?? memory.describe?.(memory.enabled)}</span>
              )}
            </span>
            {!memory.unavailableReason && <span className="bf-pmenu__hint">{memory.enabled ? labels.on : labels.off}</span>}
            <span className="bf-pmenu__check" aria-hidden="true">{memory.enabled && !memory.unavailableReason ? '✓' : ''}</span>
          </button>
        </>
      )}

      {autoMode && (
        <>
          {(mode || memory) && <div className="bf-pmenu__sep" />}
          <button
            type="button"
            role="checkbox"
            aria-checked={autoMode.enabled}
            className={`bf-pmenu__item${autoMode.enabled ? ' is-active' : ''}`}
            onClick={() => autoMode.onChange(!autoMode.enabled)}
          >
            <span className="bf-pmenu__ico" aria-hidden="true">⚡</span>
            <span className="bf-pmenu__lbl">
              {labels.autoMode}
              <span className="bf-pmenu__desc">{autoMode.description ?? labels.autoModeHint}</span>
            </span>
            <span className="bf-pmenu__hint">{autoMode.enabled ? labels.on : labels.off}</span>
            <span className="bf-pmenu__check" aria-hidden="true">{autoMode.enabled ? '✓' : ''}</span>
          </button>
        </>
      )}

      {session && (
        <>
          {(mode || memory || autoMode) && <div className="bf-pmenu__sep" />}
          <div className="bf-pmenu__group">{labels.conversation}</div>
          <button
            type="button"
            disabled={!session.canConsolidate || session.consolidating}
            className="bf-pmenu__item"
            title={!session.canConsolidate ? labels.sessionUnavailable : undefined}
            onClick={() => { if (session.canConsolidate && !session.consolidating) { session.onConsolidate(); close(); } }}
          >
            <span className="bf-pmenu__ico" aria-hidden="true"><IconConsolidate /></span>
            <span className="bf-pmenu__lbl">
              {session.consolidating ? labels.consolidating : labels.consolidate}
              <span className="bf-pmenu__desc">{labels.consolidateHint}</span>
            </span>
          </button>
          <button
            type="button"
            disabled={!session.canConsolidate || session.forking}
            className="bf-pmenu__item"
            title={!session.canConsolidate ? labels.sessionUnavailable : undefined}
            onClick={() => { if (session.canConsolidate && !session.forking) { session.onFork(); close(); } }}
          >
            <span className="bf-pmenu__ico" aria-hidden="true"><IconFork /></span>
            <span className="bf-pmenu__lbl">
              {session.forking ? labels.forking : labels.fork}
              <span className="bf-pmenu__desc">{labels.forkHint}</span>
            </span>
          </button>
        </>
      )}
    </>
  );
}
