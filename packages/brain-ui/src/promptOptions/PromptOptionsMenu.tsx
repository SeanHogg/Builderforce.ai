import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  buildModelItems,
  DEFAULT_MODEL_IDENTITY,
  modelInUse,
  type Effort,
} from '@seanhogg/builderforce-brain-embedded';
import { promptOptionsLabels, type PromptOptionsLabels } from './types';
import { usePopover } from '../popover/usePopover';
import {
  ModePane,
  type PromptOptionsAutoMode,
  type PromptOptionsMemory,
  type PromptOptionsMode,
  type PromptOptionsSession,
} from './ModePane';
import { ModelPane, type PromptOptionsModel } from './ModelPane';
import { InferenceModeControl, type PromptOptionsInferenceMode } from '../inferenceMode/InferenceModeControl';

export type {
  PromptOptionsAutoMode,
  PromptOptionsMemory,
  PromptOptionsMode,
  PromptOptionsModeChoice,
  PromptOptionsSession,
} from './ModePane';
export type { PromptOptionsModel } from './ModelPane';
export type { PromptOptionsInferenceMode } from '../inferenceMode/InferenceModeControl';

export interface PromptOptionsMenuProps {
  labels?: Partial<PromptOptionsLabels>;
  disabled?: boolean;
  mode?: PromptOptionsMode;
  memory?: PromptOptionsMemory;
  autoMode?: PromptOptionsAutoMode;
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
  /** Where models run (Hybrid · Local only · Specific) — the top of the Model tab. */
  inferenceMode?: PromptOptionsInferenceMode;
  /**
   * A host's request to OPEN the menu on a tab (e.g. a "Download a local model" remedy
   * sending the person to the Model tab). Each new `token` opens it once; the same token
   * again does nothing, so a re-render never re-opens a menu the person closed.
   */
  openOn?: PromptOptionsOpenRequest;
  /**
   * Host-owned account / usage / Evermind details for the Status tab. The menu
   * never fetches billing itself — each host already has its own plan snapshot.
   * Omit on a surface with nothing to show besides `onAccountSettings`.
   */
  status?: ReactNode;
  /** The Spend tab: its name and body (the composer wires `WorkSpendPanel`). Absent ⇒ no tab. */
  spend?: { label: string; content: ReactNode };
  onAccountSettings?: () => void;
  className?: string;
}

const EFFORT_LEVELS: Effort[] = ['quick', 'balanced', 'thorough'];
const EFFORT_ICON: Record<Effort, string> = { quick: '🏃', balanced: '⚖️', thorough: '🎯' };
const EFFORT_LABEL: Record<Effort, 'effortQuick' | 'effortBalanced' | 'effortThorough'> = {
  quick: 'effortQuick',
  balanced: 'effortBalanced',
  thorough: 'effortThorough',
};

export type PromptOptionsTab = 'mode' | 'effort' | 'model' | 'status' | 'spend';

/** Open the `/` menu on `tab`; bump `token` for each new request. */
export interface PromptOptionsOpenRequest {
  tab: PromptOptionsTab;
  token: number;
}

/**
 * The composer's `/` control: everything that shapes the NEXT TURN — the mode it
 * runs in, whether it remembers, whether actions auto-apply, run shaping (effort,
 * thinking), the model in use and the model picker, plus account status. One
 * affordance, shared by every BuilderForce prompt surface (web Brain, Creation
 * Canvas, the VS Code webview).
 *
 * The popover is tabbed (Mode, Effort, Model, Status, Spent) so the user is not scrolling
 * a single mixed list to find the setting they opened the menu for. The trigger
 * still states the two consequential ones (the armed mode, the model in use) so
 * nothing has to be opened to read what will happen.
 *
 * Self-gating: renders nothing until a host wires at least one section.
 */
export function PromptOptionsMenu({
  labels: labelOverrides,
  disabled = false,
  mode,
  memory,
  autoMode,
  session,
  effort,
  onEffortChange,
  describeEffort,
  thinking,
  onThinkingChange,
  describeThinking,
  model,
  inferenceMode,
  openOn,
  status,
  spend,
  onAccountSettings,
  className,
}: PromptOptionsMenuProps) {
  const labels = useMemo(() => promptOptionsLabels(labelOverrides), [labelOverrides]);
  const { open, toggle, close, show, rootRef } = usePopover<HTMLDivElement>();
  const [tab, setTab] = useState<PromptOptionsTab>('mode');
  const openTab = openOn?.tab;
  const openToken = openOn?.token;
  // The token this menu mounted with was answered before it existed — only NEWER ones open it.
  const handledToken = useRef(openToken);
  useEffect(() => {
    if (openToken === undefined || !openTab || openToken === handledToken.current) return;
    handledToken.current = openToken;
    setTab(openTab);
    show();
  }, [openToken, openTab, show]);

  const identity = model?.identity ?? DEFAULT_MODEL_IDENTITY;
  const items = useMemo(() => (model ? buildModelItems(model.options, labels, identity) : []), [model, labels, identity]);
  const inUse = useMemo(
    () => (model ? modelInUse(model.selection, items, labels, model.effective, identity) : null),
    [model, items, labels, identity],
  );

  const hasModeTab = !!(mode || memory || autoMode || session);
  const hasEffortTab = !!(onEffortChange || onThinkingChange);
  const hasModelTab = !!(model || inferenceMode);
  const hasStatusTab = !!(status || onAccountSettings);
  const hasSpendTab = !!spend;

  // Nothing wired ⇒ no control (the component decides its own visibility).
  if (!hasModeTab && !hasEffortTab && !hasModelTab && !hasStatusTab && !hasSpendTab) return null;

  const activeMode = mode?.choices.find((choice) => choice.value === mode.value);
  // The trigger names what is ARMED — the mode first, because it decides whether this
  // turn may dispatch real work, then the model that will run it.
  const title = [
    labels.options,
    activeMode && `${labels.mode}: ${activeMode.label}`,
    inUse && `${labels.modelInUse}: ${inUse.name}`,
  ].filter(Boolean).join(' · ');

  const tabs: { id: PromptOptionsTab; label: string }[] = [];
  if (hasModeTab) tabs.push({ id: 'mode', label: labels.mode });
  if (hasEffortTab) tabs.push({ id: 'effort', label: labels.effort });
  if (hasModelTab) tabs.push({ id: 'model', label: labels.model });
  if (hasStatusTab) tabs.push({ id: 'status', label: labels.status ?? 'Status' });
  if (spend) tabs.push({ id: 'spend', label: spend.label });
  const activeTab = tabs.some((entry) => entry.id === tab) ? tab : tabs[0]!.id;

  return (
    <div ref={rootRef} className={['bf-pmenu', className].filter(Boolean).join(' ')}>
      <button
        type="button"
        className={`bf-pmenu__trigger${open ? ' is-open' : ''}`}
        disabled={disabled}
        title={title}
        aria-label={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="bf-pmenu__slash" aria-hidden="true">/</span>
        {activeMode && <span className="bf-pmenu__mode">
          {activeMode.icon && <span aria-hidden="true">{activeMode.icon}</span>}
          {activeMode.label}
        </span>}
        {inUse && <span className="bf-pmenu__model">{inUse.name}</span>}
      </button>

      {open && (
        <div className="bf-pmenu__pop bf-pmenu__pop--tabs" role="dialog" aria-label={labels.options}>
          <div className="bf-pmenu__tabs" role="tablist" aria-label={labels.options}>
            {tabs.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                id={`bf-pmenu-tab-${entry.id}`}
                aria-selected={entry.id === activeTab}
                aria-controls={`bf-pmenu-pane-${entry.id}`}
                className={`bf-pmenu__tab${entry.id === activeTab ? ' is-active' : ''}`}
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <div
            className="bf-pmenu__pane"
            role="tabpanel"
            id={`bf-pmenu-pane-${activeTab}`}
            aria-labelledby={`bf-pmenu-tab-${activeTab}`}
          >
            {activeTab === 'mode' && (
              <ModePane labels={labels} mode={mode} memory={memory} autoMode={autoMode} session={session} close={close} />
            )}

            {activeTab === 'effort' && (
              <>
                {onEffortChange && EFFORT_LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={effort === level}
                    className={`bf-pmenu__item${effort === level ? ' is-active' : ''}`}
                    onClick={() => onEffortChange(level)}
                  >
                    <span className="bf-pmenu__ico" aria-hidden="true">{EFFORT_ICON[level]}</span>
                    <span className="bf-pmenu__lbl">
                      {labels[EFFORT_LABEL[level]]}
                      {describeEffort && <span className="bf-pmenu__desc">{describeEffort(level)}</span>}
                    </span>
                    <span className="bf-pmenu__check" aria-hidden="true">{effort === level ? '✓' : ''}</span>
                  </button>
                ))}

                {onThinkingChange && (
                  <>
                    {onEffortChange && <div className="bf-pmenu__sep" />}
                    <button
                      type="button"
                      role="checkbox"
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
              </>
            )}

            {activeTab === 'model' && (
              <>
                <InferenceModeControl inferenceMode={inferenceMode} labels={labels} onPicked={close} />
                {inferenceMode && model && <div className="bf-pmenu__sep" />}
                {model && <ModelPane model={model} labels={labels} identity={identity} inUse={inUse} onPicked={close} />}
              </>
            )}

            {activeTab === 'status' && (
              <div className="bf-pmenu__status">
                {status}
                {onAccountSettings && (
                  <button
                    type="button"
                    className="bf-pmenu__item"
                    onClick={() => { close(); onAccountSettings(); }}
                  >
                    <span className="bf-pmenu__ico" aria-hidden="true">⚙️</span>
                    <span className="bf-pmenu__lbl">{labels.accountSettings}</span>
                  </button>
                )}
              </div>
            )}

            {activeTab === 'spend' && spend && <div className="bf-pmenu__status">{spend.content}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
