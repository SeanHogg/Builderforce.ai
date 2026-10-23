/**
 * Chat request errors, and the ONE classifier that decides what a user can DO
 * about one.
 *
 * The gateway already answers a blocked request with a fully structured body —
 * `{ error, code, reason, unlock, requiredPlan, feature }` (see the API's
 * `premiumModelGateBody`). That structure used to be thrown away at the fetch
 * boundary, leaving the UI with a bare sentence like "…require a validated card
 * on file. Add and validate a card in Settings ▸ Billing to unlock." — prose
 * telling the user to go somewhere the surface never offered to take them.
 *
 * {@link BrainRequestError} preserves the fields, and {@link chatErrorAction} is
 * the single place that turns any thrown error into an actionable verdict. Both
 * the run store (which records the verdict on the run cell) and the banner UI
 * (which renders the button) read it, so the message and its call-to-action can
 * never disagree — and no consumer re-implements a regex over error prose.
 */

import type { PlatformCapability, PlatformPolicySnapshot } from '@builderforce/local-first';

/** What the user can do about a failed turn. `null` ⇒ nothing but dismiss. */
export type ChatErrorActionKind =
  /** Session expired/invalid — re-exchange the token in place. */
  | 'auth'
  /** Plan doesn't include the capability — send them to pricing. */
  | 'upgrade'
  /** Plan is fine, but billing needs a validated card — send them to billing. */
  | 'validate_card'
  /** No model can serve the turn: signed out and nothing local fits — sign in or start one. */
  | 'sign_in'
  /**
   * The person may not (or chose not to) reach the gateway — Local only, or signed in
   * with the cloud route unavailable — and nothing on this device can take the turn.
   * Never a sign-in prompt: offer "Switch to Hybrid" / "Download a local model".
   */
  | 'no_local_model'
  /**
   * The person runs Specific model and picked none — Specific promises the pick and
   * nothing else, so the turn is refused rather than quietly run as Hybrid. Offer
   * "Pick a model" (the composer's Model tab).
   */
  | 'no_specific_model'
  /**
   * This device's engine failed the turn — it crashed, went away mid-answer, or keeps
   * crashing on this model ({@link ChatErrorAction.engineCode} says which). Never a
   * sign-in or upgrade prompt: the banner names the failure in the person's language and,
   * for a model that keeps crashing, offers "Pick a model" and "Manage on-device models".
   */
  | 'local_engine_failed'
  /**
   * The person's own platform policy refused a request the turn needed — a
   * `PlatformAccessDenied` (`platform_<capability>_disabled`) or a durable outbox's
   * `platform_send_disabled`. {@link ChatErrorAction.capability} names what was refused
   * and {@link ChatErrorAction.setting} the switch that governs it, so the banner names
   * the mode / switch and how to change it — never the raw code.
   */
  | 'platform_refused';

/** What a `platform_refused` verdict names: a policy capability, or `send` (an outbox's
 *  administrative gate — the mode does not reach the platform). */
export type PlatformRefusedCapability = PlatformCapability | 'send';

/**
 * The ONE sentinel a transport throws when no model can serve a turn: signed out and
 * nothing runs on this device. Hosts never match it themselves — {@link chatErrorAction}
 * turns it into the `sign_in` verdict the shared banner acts on.
 */
export const NOT_SIGNED_IN = 'not_signed_in';

/**
 * The sentinel a transport throws when nothing ON THIS DEVICE can serve a turn and the
 * gateway is not an option for a reason sign-in would not fix: the person runs Local
 * only, or is signed in and the cloud route is unavailable. {@link chatErrorAction}
 * turns it into the `no_local_model` verdict.
 */
export const NO_LOCAL_MODEL = 'no_local_model';

/**
 * The sentinel a transport throws when the person runs Specific model with no model
 * picked (`createHostModelStream`). {@link chatErrorAction} turns it into the
 * `no_specific_model` verdict.
 */
export const NO_SPECIFIC_MODEL = 'no_specific_model';

/**
 * The page-engine failure codes the banner names (brain-embedded `pageEngines/`): the
 * engine crashed (a wasm trap — it restarts on the next send), the engine serving the
 * model went away or went silent mid-answer, and the circuit breaker refusing a model
 * that trapped twice within ten minutes on this device.
 */
export const LOCAL_ENGINE_FAILURE_CODES = ['bfi_engine_crashed', 'page_engine_detached', 'model_keeps_crashing'] as const;
export type LocalEngineFailureCode = (typeof LOCAL_ENGINE_FAILURE_CODES)[number];

const LOCAL_ENGINE_CODE_RE = new RegExp(`\\b(${LOCAL_ENGINE_FAILURE_CODES.join('|')})\\b`);

/** The page-engine failure `code` names, or the one a message carries as a word. */
function localEngineCode(code: string | undefined, message: string): LocalEngineFailureCode | undefined {
  if (code && (LOCAL_ENGINE_FAILURE_CODES as readonly string[]).includes(code)) return code as LocalEngineFailureCode;
  return LOCAL_ENGINE_CODE_RE.exec(message)?.[1] as LocalEngineFailureCode | undefined;
}

export interface ChatErrorAction {
  kind: ChatErrorActionKind;
  /** For `local_engine_failed`: which engine failure it was. */
  engineCode?: LocalEngineFailureCode;
  /** For `platform_refused`: what the policy refused. */
  capability?: PlatformRefusedCapability;
  /**
   * For `platform_refused`: the policy switch that governs it (`builderforce.platform.<setting>`
   * in the editor, the same field on the web and in Rovr), or `inferenceMode` when only
   * leaving Local only opens it (the gateway, connected features, or `send`).
   */
  setting?: keyof PlatformPolicySnapshot | 'inferenceMode';
  /** Plan that WOULD satisfy the request ('pro'), when the server named one. */
  requiredPlan?: string;
  /** Entitlement key that was refused ('premiumModels'), when the server named one. */
  feature?: string;
}

/**
 * An HTTP failure from the gateway, carrying whatever structured entitlement
 * fields the body supplied. `message` stays the human sentence, so anything that
 * only renders text is unaffected.
 */
export class BrainRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly reason?: string;
  readonly unlock?: string;
  readonly requiredPlan?: string;
  readonly feature?: string;

  constructor(
    message: string,
    init: {
      status: number;
      code?: string;
      reason?: string;
      unlock?: string;
      requiredPlan?: string;
      feature?: string;
    },
  ) {
    super(message);
    this.name = 'BrainRequestError';
    this.status = init.status;
    this.code = init.code;
    this.reason = init.reason;
    this.unlock = init.unlock;
    this.requiredPlan = init.requiredPlan;
    this.feature = init.feature;
  }
}

/** Read a field only when the body actually carried it as a string. */
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Build a {@link BrainRequestError} from a gateway error body, keeping every
 * entitlement field the server sent.
 */
export function brainRequestError(status: number, body: unknown, statusText?: string): BrainRequestError {
  const b = (body ?? {}) as Record<string, unknown>;
  // The OpenAI-shaped body (`{ error: { code, message } }`) — what a page engine's
  // refusal and most upstreams send — as well as the gateway's flat one.
  const nested = b.error && typeof b.error === 'object' ? (b.error as Record<string, unknown>) : undefined;
  const message =
    str(b.error) || str(nested?.message) || str(b.message) || statusText || `Request failed (${status})`;
  return new BrainRequestError(message, {
    status,
    code: str(b.code) ?? str(nested?.code),
    reason: str(b.reason),
    unlock: str(b.unlock),
    requiredPlan: str(b.requiredPlan),
    feature: str(b.feature),
  });
}

const PLATFORM_CODE_RE = /\bplatform_(synchronize|gateway_inference|connected_feature|authenticate|model_download|direct_provider|external_mcp|git_remote|send)_disabled\b/;

/** The snapshot field each capability's switch is — `inferenceMode` where the mode decides. */
const PLATFORM_SETTING: Readonly<Record<PlatformRefusedCapability, keyof PlatformPolicySnapshot | 'inferenceMode'>> = {
  synchronize: 'synchronize',
  'gateway-inference': 'inferenceMode',
  'connected-feature': 'inferenceMode',
  authenticate: 'inferenceMode',
  'model-download': 'modelDownloads',
  'direct-provider': 'directProviders',
  'external-mcp': 'externalMcp',
  'git-remote': 'gitRemotes',
  send: 'inferenceMode',
};

/** The refused capability a policy refusal carries (its `capability` field, else its code). */
function platformRefusal(err: unknown, message: string): PlatformRefusedCapability | null {
  const fields = err && typeof err === 'object' ? (err as { capability?: unknown; code?: unknown }) : {};
  if (typeof fields.capability === 'string' && fields.capability in PLATFORM_SETTING && fields.code === 'PLATFORM_ACCESS_DENIED') {
    return fields.capability as PlatformRefusedCapability;
  }
  if (fields.code === 'PLATFORM_SEND_DISABLED') return 'send';
  const match = PLATFORM_CODE_RE.exec(message)?.[1];
  return match ? (match.replaceAll('_', '-') as PlatformRefusedCapability) : null;
}

/**
 * Prose fallbacks, for an older gateway (or a non-JSON edge/proxy error) that
 * carries no structured fields. Deliberately narrow: a wrong guess here would
 * offer an upgrade button for an unrelated failure.
 */
const AUTH_PROSE = /invalid or expired token|unauthor/i;
const CARD_PROSE = /validated card|add a card|card on file/i;
const UPGRADE_PROSE = /requires? a paid plan|upgrade to (pro|teams)|plan (token )?limit|not included in your plan/i;

/**
 * Classify any thrown value into the action the user can take. Structured fields
 * win; prose is only consulted when the server gave us nothing to go on.
 */
export function chatErrorAction(err: unknown): ChatErrorAction | null {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';

  if (err instanceof BrainRequestError) {
    const base = { requiredPlan: err.requiredPlan, feature: err.feature };
    if (err.status === 401) return { kind: 'auth', ...base };
    if (err.unlock === 'validate_card' || err.reason === 'card_required') {
      return { kind: 'validate_card', ...base };
    }
    if (err.unlock === 'upgrade' || err.reason === 'plan_required' || err.status === 402) {
      return { kind: 'upgrade', ...base };
    }
    // 429s the gateway raises for a plan allowance (not provider rate limits).
    if (err.status === 429 && /plan_.*limit/.test(err.code ?? '')) {
      return { kind: 'upgrade', ...base };
    }
  }

  if (!message) return null;
  if (message === NOT_SIGNED_IN) return { kind: 'sign_in' };
  if (message === NO_LOCAL_MODEL) return { kind: 'no_local_model' };
  if (message === NO_SPECIFIC_MODEL) return { kind: 'no_specific_model' };
  const engineCode = localEngineCode(err instanceof BrainRequestError ? err.code : undefined, message);
  if (engineCode) return { kind: 'local_engine_failed', engineCode };
  const refused = platformRefusal(err, message);
  if (refused) return { kind: 'platform_refused', capability: refused, setting: PLATFORM_SETTING[refused] };
  if (AUTH_PROSE.test(message)) return { kind: 'auth' };
  if (CARD_PROSE.test(message)) return { kind: 'validate_card' };
  if (UPGRADE_PROSE.test(message)) return { kind: 'upgrade' };
  return null;
}
