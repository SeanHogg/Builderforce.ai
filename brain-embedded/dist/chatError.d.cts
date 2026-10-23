type PlatformCapability = 'synchronize' | 'gateway-inference' | 'connected-feature' | 'authenticate' | 'model-download' | 'direct-provider' | 'external-mcp' | 'git-remote';
interface PlatformPolicySnapshot {
    synchronize: boolean;
    gatewayInference: boolean;
    connectedFeatures: boolean;
    authenticate: boolean;
    modelDownloads: boolean;
    directProviders: boolean;
    externalMcp: boolean;
    gitRemotes: boolean;
}

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

/** What the user can do about a failed turn. `null` ⇒ nothing but dismiss. */
type ChatErrorActionKind = 
/** Session expired/invalid — re-exchange the token in place. */
'auth'
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
type PlatformRefusedCapability = PlatformCapability | 'send';
/**
 * The ONE sentinel a transport throws when no model can serve a turn: signed out and
 * nothing runs on this device. Hosts never match it themselves — {@link chatErrorAction}
 * turns it into the `sign_in` verdict the shared banner acts on.
 */
declare const NOT_SIGNED_IN = "not_signed_in";
/**
 * The sentinel a transport throws when nothing ON THIS DEVICE can serve a turn and the
 * gateway is not an option for a reason sign-in would not fix: the person runs Local
 * only, or is signed in and the cloud route is unavailable. {@link chatErrorAction}
 * turns it into the `no_local_model` verdict.
 */
declare const NO_LOCAL_MODEL = "no_local_model";
/**
 * The sentinel a transport throws when the person runs Specific model with no model
 * picked (`createHostModelStream`). {@link chatErrorAction} turns it into the
 * `no_specific_model` verdict.
 */
declare const NO_SPECIFIC_MODEL = "no_specific_model";
/**
 * The page-engine failure codes the banner names (brain-embedded `pageEngines/`): the
 * engine crashed (a wasm trap — it restarts on the next send), the engine serving the
 * model went away or went silent mid-answer, and the circuit breaker refusing a model
 * that trapped twice within ten minutes on this device.
 */
declare const LOCAL_ENGINE_FAILURE_CODES: readonly ["bfi_engine_crashed", "page_engine_detached", "model_keeps_crashing"];
type LocalEngineFailureCode = (typeof LOCAL_ENGINE_FAILURE_CODES)[number];
interface ChatErrorAction {
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
declare class BrainRequestError extends Error {
    readonly status: number;
    readonly code?: string;
    readonly reason?: string;
    readonly unlock?: string;
    readonly requiredPlan?: string;
    readonly feature?: string;
    constructor(message: string, init: {
        status: number;
        code?: string;
        reason?: string;
        unlock?: string;
        requiredPlan?: string;
        feature?: string;
    });
}
/**
 * Build a {@link BrainRequestError} from a gateway error body, keeping every
 * entitlement field the server sent.
 */
declare function brainRequestError(status: number, body: unknown, statusText?: string): BrainRequestError;
/**
 * Classify any thrown value into the action the user can take. Structured fields
 * win; prose is only consulted when the server gave us nothing to go on.
 */
declare function chatErrorAction(err: unknown): ChatErrorAction | null;

export { BrainRequestError, type ChatErrorAction, type ChatErrorActionKind, LOCAL_ENGINE_FAILURE_CODES, type LocalEngineFailureCode, NOT_SIGNED_IN, NO_LOCAL_MODEL, NO_SPECIFIC_MODEL, type PlatformRefusedCapability, brainRequestError, chatErrorAction };
