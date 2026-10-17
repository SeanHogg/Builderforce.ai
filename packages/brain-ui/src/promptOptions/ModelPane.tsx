/**
 * The `/` menu's MODEL tab — what is running this turn, and every route that could:
 * the search box, the funding filter chips (All · Auto · On this device · BYO · Free ·
 * Paid · Configured) and the list.
 *
 * The on-device chip carries two kinds of row. Models a runtime on this machine already
 * serves (Ollama, Synapse…) are ordinary rows. Models a PAGE engine can run (WebGPU
 * `bfi`, WebLLM) come from the host's local model store with a state each — download,
 * progress, ready, unsupported — and a downloaded one joins the ordinary rows too, so
 * it is listed under All and named as the model in use once pinned. Picking either kind
 * calls the SAME `onChange` a cloud model does: a pin is a pin, whoever serves it.
 *
 * An on-device model spends nothing and needs no plan, so the store's list is offered
 * even to a viewer the plan does not let pin a catalog model — and once such a viewer
 * has pinned one, the Auto row is offered beside it, so the pin is never a one-way door.
 */
import { useMemo, useState } from 'react';
import {
  activeModelKey,
  buildModelItems,
  filterModelItems,
  MODEL_CATEGORIES,
  modelCategoryLabel,
  withReadyPageModels,
  type ChatModelOptions,
  type ChatModelSelection,
  type LocalModelStore,
  type ModelCategory,
  type ModelIdentityContext,
  type ModelItem,
} from '@seanhogg/builderforce-brain-embedded';
import { LocalModelList } from '../localModels/LocalModelList';
import { useLocalModels } from '../localModels/useLocalModels';
import type { PromptOptionsLabels } from './types';

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
  /**
   * Who is reading: which routing product funds their turns, and whether the gateway
   * would accept a pin from them at all. ONE object rather than a `canChoose` boolean
   * beside it, because the two answers are the same fact — a viewer who may not pin is
   * on the product, and must be told so by name instead of being shown an upstream id
   * next to a list they cannot use. Omitted ⇒ free + no choice (fail closed).
   */
  identity?: ModelIdentityContext;
  /**
   * The host's on-device model store (brain-embedded `createPageEngineSet().store`) —
   * the port through which the menu lists, downloads and removes page-engine models.
   * The menu never learns which host it is in; omit it where no page engine runs.
   */
  localStore?: LocalModelStore;
  /**
   * The viewer's entitlement is not known yet (the host's catalog has not loaded, or
   * could not be read). The menu then offers what needs no entitlement — on-device
   * models — and does NOT claim the plan forbids choosing: that sentence is shown only
   * once `identity.canChoose` is known to be false.
   */
  identityPending?: boolean;
}

export interface ModelPaneProps {
  model: PromptOptionsModel;
  labels: PromptOptionsLabels;
  identity: ModelIdentityContext;
  inUse: { name: string; detail: string } | null;
  /** Close the menu after a pick. */
  onPicked: () => void;
}

type Filter = 'all' | ModelCategory;

export function ModelPane({ model, labels, identity, inUse, onPicked }: ModelPaneProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const local = useLocalModels(model.localStore);
  const hasStore = !!model.localStore;

  const items = useMemo(
    () => buildModelItems(withReadyPageModels(model.options, local.rows), labels, identity),
    [model.options, local.rows, labels, identity],
  );
  // The store's rows render as their own list under the on-device chip, so they are
  // not repeated as ordinary rows there.
  const storeKeys = useMemo(() => new Set((local.rows ?? []).map((row) => `model:${row.ref}`)), [local.rows]);
  const categories = useMemo(
    () => MODEL_CATEGORIES.filter((category) => items.some((item) => item.category === category) || (category === 'local' && hasStore)),
    [items, hasStore],
  );
  const activeKey = activeModelKey(model.selection);
  const activeRef = model.selection.mode === 'model' ? model.selection.model : undefined;

  const pick = (selection: ChatModelSelection) => {
    model.onChange(selection);
    setQuery('');
    onPicked();
  };
  const pickLocal = (ref: string) => pick({ mode: 'model', model: ref });

  const renderItems = (rows: ModelItem[]) =>
    rows.map((item) => (
      <button
        key={item.key}
        type="button"
        role="option"
        aria-selected={item.key === activeKey}
        className={`bf-pmenu__option${item.key === activeKey ? ' is-active' : ''}`}
        onClick={() => pick(item.selection)}
      >
        <span className="bf-pmenu__optName">{item.label}</span>
        <span className="bf-pmenu__optTag">{modelCategoryLabel(item.category, labels)}</span>
        {item.detail ? <span className="bf-pmenu__optDetail">{item.detail}</span> : null}
      </button>
    ));

  const localSection = (
    <LocalModelList state={local} labels={labels} {...(activeRef ? { activeRef } : {})} onSelect={pickLocal} />
  );

  const visible = filterModelItems(items, labels, query, filter);
  const listed = filter === 'local' ? visible.filter((item) => !storeKeys.has(item.key)) : visible;
  // A locked viewer may still pin an on-device model, so while one is pinned the Auto
  // row stays offered — the way back to automatic routing needs no entitlement either.
  const lockedLocal = items.filter((item) =>
    item.category === 'auto' ? model.selection.mode !== 'auto' : item.category === 'local' && !storeKeys.has(item.key));

  return (
    <>
      {inUse && (
        <div className="bf-pmenu__info">
          <span className="bf-pmenu__lbl">
            {labels.modelInUse}
            <span className="bf-pmenu__desc">{inUse.name}</span>
          </span>
        </div>
      )}
      {identity.canChoose ? (
        <>
          <input
            className="bf-pmenu__search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={labels.searchModels}
            aria-label={labels.searchModels}
          />
          <div className="bf-pmenu__filters" aria-label={labels.filterModels}>
            {(['all', ...categories] as Filter[]).map((category) => (
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
            {renderItems(listed)}
            {!listed.length && filter !== 'local' && <div className="bf-pmenu__empty">{labels.noModels}</div>}
          </div>
          {filter === 'local' && localSection}
        </>
      ) : (
        <>
          {!model.identityPending && (
            <div className="bf-pmenu__info">
              <span className="bf-pmenu__desc">{labels.modelLocked}</span>
            </div>
          )}
          {lockedLocal.length > 0 && (
            <div className="bf-pmenu__list" role="listbox" aria-label={labels.chooseModel}>
              {renderItems(lockedLocal)}
            </div>
          )}
          {localSection}
        </>
      )}
    </>
  );
}
