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

export interface PromptOptionsMenuProps {
  labels?: Partial<PromptOptionsLabels>;
  disabled?: boolean;
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
 * The composer's `/` control: run shaping (effort, thinking), the model in use,
 * the model picker, and account settings — one affordance, shared by every
 * BuilderForce prompt surface (web Brain, Creation Canvas, the VS Code webview).
 *
 * The trigger states the active model next to the slash, so "what is running this
 * turn" is readable without opening anything; opening it is how you change it.
 * Self-gating: renders nothing until a host wires at least one section.
 */
export function PromptOptionsMenu({
  labels: labelOverrides,
  disabled = false,
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
  if (!onEffortChange && !onThinkingChange && !model && !onAccountSettings) return null;

  const canChoose = model?.canChoose !== false;
  const activeKey = model ? activeModelKey(model.selection) : '';
  const title = inUse ? `${labels.options} · ${labels.modelInUse}: ${inUse.name}` : labels.options;

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
        {inUse && <span className="bf-pmenu__model">{inUse.name}</span>}
      </button>

      {open && (
        <div className="bf-pmenu__pop" role="menu">
          {onEffortChange && (
            <>
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
              {onEffortChange && <div className="bf-pmenu__sep" />}
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
              {(onEffortChange || onThinkingChange) && <div className="bf-pmenu__sep" />}
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
