import { useEffect, useMemo, useRef, useState } from 'react';
import {
  activeModelKey,
  buildModelItems,
  filterModelItems,
  MODEL_CATEGORIES,
  modelCategoryLabel,
  modelInUse,
  type ChatModelOptions,
  type ChatModelSelection,
  type Effort,
  type ModelCategory,
} from '@seanhogg/builderforce-brain-embedded';
import { promptOptionsLabels, type PromptOptionsLabels } from './types';

/** Model wiring for the `/` menu. Omit it on a surface with no model choice. */
export interface PromptOptionsModel {
  selection: ChatModelSelection;
  options: ChatModelOptions;
  onChange: (selection: ChatModelSelection) => void;
  /**
   * What the host will actually send while the selection is `auto` — a configured
   * default or a `project_evermind:<id>` pin. Shown as the model in use, because
   * "Auto" alone does not answer the question the user opened the menu to ask.
   */
  effective?: string;
  /** False ⇒ the gateway would reject a pin (no paid plan, no connected account):
   *  the list is replaced by the reason, rather than offering a dead control. */
  canChoose?: boolean;
}

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

export interface PromptOptionsMenuProps {
  labels?: Partial<PromptOptionsLabels>;
  disabled?: boolean;
  mode?: PromptOptionsMode;
  memory?: PromptOptionsMemory;
  /** Consolidate / fork this chat. Omit on a surface with no chat behind it. */
  session?: PromptOptionsSession;
  effort?: Effort;
  onEffortChange?: (effort: Effort) => void;
  /** What a level really costs at this host's current state (answer/thinking budgets). */
  describeEffort?: (effort: Effort) => string;
  thinking?: boolean;
  onThinkingChange?: (on: boolean) => void;
  describeThinking?: (on: boolean) => string;
  model?: PromptOptionsModel;
  onAccountSettings?: () => void;
  className?: string;
}

const EFFORT_LEVELS: Effort[] = ['quick', 'balanced', 'thorough'];
const EFFORT_ICON: Record<Effort, string> = { quick: '🏃', balanced: '⚖️', thorough: '🎯' };

/**
 * The composer's `/` control: everything that shapes the NEXT TURN — the mode it
 * runs in, whether it remembers, run shaping (effort, thinking), the model in use
 * and the model picker, plus account settings. One affordance, shared by every
 * BuilderForce prompt surface (web Brain, Creation Canvas, the VS Code webview).
 *
 * Every one of those settings used to be its own pill in the composer's action row
 * — a segmented Chat|Work control, a memory button, a model chip — which on a phone
 * left a row of eight unlabelled circles and no room for the send button. They live
 * here now, and the trigger states the two consequential ones (the armed mode, the
 * model in use) so nothing has to be opened to read what will happen.
 *
 * Self-gating: renders nothing until a host wires at least one section.
 */
export function PromptOptionsMenu({
  labels: labelOverrides,
  disabled = false,
  mode,
  memory,
  session,
  effort,
  onEffortChange,
  describeEffort,
  thinking,
  onThinkingChange,
  describeThinking,
  model,
  onAccountSettings,
  className,
}: PromptOptionsMenuProps) {
  const labels = useMemo(() => promptOptionsLabels(labelOverrides), [labelOverrides]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | ModelCategory>('all');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const items = useMemo(() => (model ? buildModelItems(model.options, labels) : []), [model, labels]);
  const inUse = useMemo(
    () => (model ? modelInUse(model.selection, items, labels, model.effective) : null),
    [model, items, labels],
  );
  const categories = useMemo(
    () => MODEL_CATEGORIES.filter((category) => items.some((item) => item.category === category)),
    [items],
  );
  const visible = useMemo(() => filterModelItems(items, labels, query, filter), [items, labels, query, filter]);

  // Nothing wired ⇒ no control (the component decides its own visibility).
  if (!mode && !memory && !session && !onEffortChange && !onThinkingChange && !model && !onAccountSettings) return null;

  const canChoose = model?.canChoose !== false;
  const activeKey = model ? activeModelKey(model.selection) : '';
  const activeMode = mode?.choices.find((choice) => choice.value === mode.value);
  // The trigger names what is ARMED — the mode first, because it decides whether this
  // turn may dispatch real work, then the model that will run it.
  const title = [
    labels.options,
    activeMode && `${labels.mode}: ${activeMode.label}`,
    inUse && `${labels.modelInUse}: ${inUse.name}`,
  ].filter(Boolean).join(' · ');

  return (
    <div ref={rootRef} className={['bf-pmenu', className].filter(Boolean).join(' ')}>
      <button
        type="button"
        className={`bf-pmenu__trigger${open ? ' is-open' : ''}`}
        disabled={disabled}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="bf-pmenu__slash" aria-hidden="true">/</span>
        {activeMode && <span className="bf-pmenu__mode">
          {activeMode.icon && <span aria-hidden="true">{activeMode.icon}</span>}
          {activeMode.label}
        </span>}
        {inUse && <span className="bf-pmenu__model">{inUse.name}</span>}
      </button>

      {open && (
        <div className="bf-pmenu__pop" role="menu">
          {mode && (
            <>
              <div className="bf-pmenu__group">{labels.mode}</div>
              {mode.choices.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={choice.value === mode.value}
                  className={`bf-pmenu__item${choice.value === mode.value ? ' is-active' : ''}`}
                  onClick={() => { mode.onChange(choice.value); setOpen(false); }}
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
                role="menuitemcheckbox"
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

          {onEffortChange && (
            <>
              {(mode || memory) && <div className="bf-pmenu__sep" />}
              <div className="bf-pmenu__group">{labels.effort}</div>
              {EFFORT_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  role="menuitemradio"
                  aria-checked={effort === level}
                  className={`bf-pmenu__item${effort === level ? ' is-active' : ''}`}
                  onClick={() => onEffortChange(level)}
                >
                  <span className="bf-pmenu__ico" aria-hidden="true">{EFFORT_ICON[level]}</span>
                  <span className="bf-pmenu__lbl">
                    {level === 'quick' ? labels.effortQuick : level === 'balanced' ? labels.effortBalanced : labels.effortThorough}
                    {describeEffort && <span className="bf-pmenu__desc">{describeEffort(level)}</span>}
                  </span>
                  <span className="bf-pmenu__check" aria-hidden="true">{effort === level ? '✓' : ''}</span>
                </button>
              ))}
            </>
          )}

          {onThinkingChange && (
            <>
              {(mode || memory || onEffortChange) && <div className="bf-pmenu__sep" />}
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={!!thinking}
                className={`bf-pmenu__item${thinking ? ' is-active' : ''}`}
                onClick={() => onThinkingChange(!thinking)}
              >
                <span className="bf-pmenu__ico" aria-hidden="true">💭</span>
                <span className="bf-pmenu__lbl">
                  {labels.thinking}
                  {describeThinking && <span className="bf-pmenu__desc">{describeThinking(!!thinking)}</span>}
                </span>
                <span className="bf-pmenu__hint">{thinking ? labels.on : labels.off}</span>
                <span className="bf-pmenu__check" aria-hidden="true">{thinking ? '✓' : ''}</span>
              </button>
            </>
          )}

          {model && inUse && (
            <>
              {(mode || memory || onEffortChange || onThinkingChange) && <div className="bf-pmenu__sep" />}
              <div className="bf-pmenu__group">{labels.model}</div>
              <div className="bf-pmenu__info">
                <span className="bf-pmenu__ico" aria-hidden="true">🧠</span>
                <span className="bf-pmenu__lbl">
                  {inUse.name}
                  <span className="bf-pmenu__desc">{inUse.detail}</span>
                </span>
              </div>
              {canChoose ? (
                <>
                  <input
                    className="bf-pmenu__search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={labels.searchModels}
                    aria-label={labels.searchModels}
                  />
                  <div className="bf-pmenu__filters" aria-label={labels.filterModels}>
                    {(['all', ...categories] as Array<'all' | ModelCategory>).map((category) => (
                      <button
                        key={category}
                        type="button"
                        className={`bf-pmenu__filter${filter === category ? ' is-active' : ''}`}
                        aria-pressed={filter === category}
                        onClick={() => setFilter(category)}
                      >
                        {category === 'all' ? labels.all : modelCategoryLabel(category, labels)}
                      </button>
                    ))}
                  </div>
                  <div className="bf-pmenu__list" role="listbox" aria-label={labels.chooseModel}>
                    {visible.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        role="option"
                        aria-selected={item.key === activeKey}
                        className={`bf-pmenu__option${item.key === activeKey ? ' is-active' : ''}`}
                        onClick={() => { model.onChange(item.selection); setQuery(''); setOpen(false); }}
                      >
                        <span className="bf-pmenu__optName">{item.label}</span>
                        <span className="bf-pmenu__optTag">{modelCategoryLabel(item.category, labels)}</span>
                        <span className="bf-pmenu__optDetail">{item.detail}</span>
                      </button>
                    ))}
                    {!visible.length && <div className="bf-pmenu__empty">{labels.noModels}</div>}
                  </div>
                </>
              ) : (
                <div className="bf-pmenu__info">
                  <span className="bf-pmenu__ico" aria-hidden="true">🔒</span>
                  <span className="bf-pmenu__lbl">
                    <span className="bf-pmenu__desc">{labels.modelLocked}</span>
                  </span>
                </div>
              )}
            </>
          )}

          {/* Actions on the conversation itself, kept last (above settings) because
              they FIRE rather than arm: everything above shapes the next turn, these
              two change the chat you are in. Both state their reason when inert, so a
              short chat explains itself instead of showing two dead pills. */}
          {session && (
            <>
              <div className="bf-pmenu__sep" />
              <div className="bf-pmenu__group">{labels.conversation}</div>
              <button
                type="button"
                role="menuitem"
                className="bf-pmenu__item"
                disabled={!session.canConsolidate || !!session.consolidating || !!session.forking}
                onClick={() => { setOpen(false); session.onConsolidate(); }}
              >
                <span className="bf-pmenu__ico" aria-hidden="true"><IconConsolidate /></span>
                <span className="bf-pmenu__lbl">
                  {session.consolidating ? labels.consolidating : labels.consolidate}
                  <span className="bf-pmenu__desc">{session.canConsolidate ? labels.consolidateHint : labels.sessionUnavailable}</span>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="bf-pmenu__item"
                disabled={!session.canConsolidate || !!session.consolidating || !!session.forking}
                onClick={() => { setOpen(false); session.onFork(); }}
              >
                <span className="bf-pmenu__ico" aria-hidden="true"><IconFork /></span>
                <span className="bf-pmenu__lbl">
                  {session.forking ? labels.forking : labels.fork}
                  <span className="bf-pmenu__desc">{session.canConsolidate ? labels.forkHint : labels.sessionUnavailable}</span>
                </span>
              </button>
            </>
          )}

          {onAccountSettings && (
            <>
              <div className="bf-pmenu__sep" />
              <button
                type="button"
                role="menuitem"
                className="bf-pmenu__item"
                onClick={() => { setOpen(false); onAccountSettings(); }}
              >
                <span className="bf-pmenu__ico" aria-hidden="true">⚙</span>
                <span className="bf-pmenu__lbl">{labels.accountSettings}</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
