/**
 * The `/` menu's Model section from a host's catalogue — the ONE place every host turns
 * "the models I could read, the user's choice, and where on-device models live" into
 * `ComposerOptions.model`.
 *
 * Fetching stays the host's own (the web's `useChatModelOptions`, brain-embedded's
 * `loadGatewayModelOptions` for the editor webview and Rovr); what each did again on top —
 * falling back to the ONE empty catalogue, merging this machine's models in, deciding
 * whether entitlement is still unknown, and reconstructing the choice from a pin — is
 * here, once.
 */
import {
  EMPTY_GATEWAY_MODEL_OPTIONS,
  type ChatModelOptions,
  type ChatModelSelection,
  type ModelIdentityContext,
} from '@seanhogg/builderforce-brain-embedded';
import type { PromptOptionsModel } from '../promptOptions/ModelPane';

/** What a host read: the menu's grouped models and who is reading. `surface` etc. ride along. */
export interface ComposerModelCatalog {
  options: ChatModelOptions;
  identity?: ModelIdentityContext;
}

/**
 * True once a REAL catalogue is in hand. Not yet read, or a failed read (which resolves
 * to brain-embedded's `EMPTY_GATEWAY_MODEL_OPTIONS`), both leave entitlement UNKNOWN —
 * the menu must not claim the plan forbids choosing.
 */
export function composerCatalogLoaded(catalog: ComposerModelCatalog | null | undefined): boolean {
  return catalog != null && catalog !== EMPTY_GATEWAY_MODEL_OPTIONS;
}

/**
 * The catalogue the menu lists: what the host read (or the ONE empty shape while there
 * is none) plus models a runtime on this machine serves. A merge, not another fetch —
 * the gateway cannot know them, and they matter most exactly when it is unreadable.
 */
export function withLocalModels<C extends ComposerModelCatalog>(
  catalog: C | null | undefined,
  local: ChatModelOptions['local'] | null | undefined,
): C {
  const base = (catalog ?? EMPTY_GATEWAY_MODEL_OPTIONS) as C;
  if (!local || local.length === 0) return base;
  return { ...base, options: { ...base.options, local } };
}

/** The user's choice from what the host holds: a strict pin, the BYO pool, else auto. */
export function modelSelectionFrom(pin: { model?: string | null; strict?: boolean; routingMode?: string | null }): ChatModelSelection {
  if (pin.model && pin.strict !== false) return { mode: 'model', model: pin.model };
  return pin.routingMode === 'byo_pool' ? { mode: 'byo_pool' } : { mode: 'auto' };
}

export interface ComposerModelInput {
  catalog: ComposerModelCatalog | null | undefined;
  selection: ChatModelSelection;
  onChange: (selection: ChatModelSelection) => void;
  /** This machine's runtime-served models, merged into the catalogue. */
  local?: ChatModelOptions['local'] | null;
  /** What auto will actually send. */
  effective?: string;
  /** Who is reading while no catalogue is in hand (e.g. the plan from the consumption snapshot). */
  fallbackIdentity?: ModelIdentityContext;
  localStore?: PromptOptionsModel['localStore'];
  /** Whether entitlement is still unknown; defaults to "no real catalogue yet". */
  identityPending?: boolean;
  /** `false` on a host that cannot carry the BYO pool route (`ChatModelOptions.byoPool`). */
  byoPool?: boolean;
}

/** `ComposerOptions.model` for one host. Pure — memoize on its inputs. */
export function composerModel(input: ComposerModelInput): PromptOptionsModel {
  const listed = withLocalModels(input.catalog, input.local);
  return {
    selection: input.selection,
    options: input.byoPool === false ? { ...listed.options, byoPool: false } : listed.options,
    onChange: input.onChange,
    effective: input.effective,
    identity: (input.catalog ? input.catalog.identity : undefined) ?? input.fallbackIdentity,
    localStore: input.localStore,
    identityPending: input.identityPending ?? !composerCatalogLoaded(input.catalog),
  };
}
