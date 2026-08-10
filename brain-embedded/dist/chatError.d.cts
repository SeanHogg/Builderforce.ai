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
 | 'validate_card';
interface ChatErrorAction {
    kind: ChatErrorActionKind;
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

export { BrainRequestError, type ChatErrorAction, type ChatErrorActionKind, brainRequestError, chatErrorAction };
