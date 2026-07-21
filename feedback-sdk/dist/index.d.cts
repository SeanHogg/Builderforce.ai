/** Public types for the embeddable Builderforce feedback widget. */
/** The kinds of request the widget can file. Mirrors the API's FEEDBACK_KINDS. */
type FeedbackKind = 'feature' | 'bug' | 'idea' | 'other';
/** The wire shape posted to `${endpoint}/submit`. */
interface FeedbackPayload {
    kind: FeedbackKind;
    title?: string;
    body: string;
    email?: string;
    name?: string;
    url?: string;
    appVersion?: string;
    context?: Record<string, unknown>;
}
interface FeedbackWidgetOptions {
    /** The project's ingest key (bff_…). */
    key: string;
    /** Ingest base, e.g. https://api.builderforce.ai/api/feedback-ingest (no trailing /submit). */
    endpoint?: string;
    /** Which edge the launcher tab docks to. Default 'right'. */
    side?: 'left' | 'right';
    /** Accent colour for the tab and submit button. */
    accent?: string;
    /** Force a palette instead of following the host page's prefers-color-scheme. */
    theme?: 'light' | 'dark' | 'auto';
    /** Kinds offered in the picker. Default: all four. */
    kinds?: FeedbackKind[];
    /** Ask for an email so the team can follow up. Default true. */
    collectEmail?: boolean;
    /** Release identifier recorded against each request. */
    appVersion?: string;
    /** Extra structured context attached to every submission (plan, role, …). */
    context?: Record<string, unknown>;
    /** Override the visible copy (the widget ships English defaults). */
    labels?: Partial<FeedbackLabels>;
    /** Mount the launcher tab. Set false to drive the panel yourself via open(). */
    showTab?: boolean;
    /** Fired after a request is accepted by the API. */
    onSubmit?: (result: {
        submissionId: string;
        deduped: boolean;
    }) => void;
}
interface FeedbackLabels {
    tab: string;
    title: string;
    intro: string;
    kindFeature: string;
    kindBug: string;
    kindIdea: string;
    kindOther: string;
    titleField: string;
    titlePlaceholder: string;
    bodyField: string;
    bodyPlaceholder: string;
    emailField: string;
    emailPlaceholder: string;
    submit: string;
    submitting: string;
    close: string;
    successTitle: string;
    successBody: string;
    another: string;
    errorRequired: string;
    errorGeneric: string;
    errorRateLimited: string;
}

/**
 * Widget core — the DOM-free half, so payload building, endpoint resolution and
 * transport are unit-testable without a browser.
 */

declare const DEFAULT_ENDPOINT = "https://api.builderforce.ai/api/feedback-ingest";
declare const ALL_KINDS: FeedbackKind[];
declare const DEFAULT_LABELS: FeedbackLabels;
/** Trim a trailing slash (and a mistakenly-included /submit) off the endpoint. */
declare function normalizeEndpoint(endpoint: string | undefined): string;
/** The kinds to offer: the caller's list filtered to known values, else all. */
declare function resolveKinds(kinds: FeedbackKind[] | undefined): FeedbackKind[];
interface DraftInput {
    kind: FeedbackKind;
    title: string;
    body: string;
    email: string;
}
/**
 * Build the wire payload from the form state plus ambient page context. Only the
 * body is required — the API derives a title from it when one is not supplied,
 * so a single-textarea embed is a valid client.
 */
declare function buildPayload(draft: DraftInput, opts: Pick<FeedbackWidgetOptions, 'appVersion' | 'context'>, page?: {
    url?: string;
}): FeedbackPayload | {
    error: 'empty';
};
interface SubmitOutcome {
    ok: boolean;
    submissionId?: string;
    deduped?: boolean;
    /** Distinguishes the "come back tomorrow" message from a generic failure. */
    rateLimited?: boolean;
}
/** POST one request to the collector. Never throws — the widget renders the outcome. */
declare function postFeedback(endpoint: string, key: string, payload: FeedbackPayload, fetchFn?: typeof fetch): Promise<SubmitOutcome>;
/** Merge caller label overrides onto the shipped English defaults. */
declare function resolveLabels(overrides: Partial<FeedbackLabels> | undefined): FeedbackLabels;
/** The label for a kind, from the resolved label set. */
declare function kindLabel(kind: FeedbackKind, labels: FeedbackLabels): string;

/**
 * BuilderforceFeedback — the embeddable product-feedback widget.
 *
 * Drops a small tab onto the edge of any page; clicking it slides out a panel
 * that files a feature request, bug report or idea against the project behind
 * the ingest key. Requests land in that project's backlog as EXTERNAL REQUESTS
 * which no agent may execute until a human approves them.
 *
 *   <script src="https://unpkg.com/@seanhogg/builderforce-feedback"></script>
 *   <script>BuilderforceFeedback.init({ key: 'bff_…' });</script>
 *
 * Everything renders inside a shadow root with its own reset, so the widget can
 * neither inherit nor leak page styles. No dependencies, no framework.
 */

declare class FeedbackWidget {
    private readonly opts;
    private readonly labels;
    private readonly kinds;
    private readonly endpoint;
    private root;
    private host;
    private open;
    private sending;
    private done;
    private error;
    private draft;
    constructor(opts: FeedbackWidgetOptions);
    /** Create the shadow host and paint the launcher tab. Idempotent. */
    mount(): void;
    /** Remove the widget entirely and release its listeners. */
    destroy(): void;
    openPanel(): void;
    closePanel(): void;
    private onKeydown;
    private focusFirstField;
    private submit;
    private render;
    private formMarkup;
    private doneMarkup;
    private bind;
}
/** Mount the widget. Calling init again replaces the previous instance. */
declare function init(opts: FeedbackWidgetOptions): FeedbackWidget;
/** Open the panel programmatically (e.g. from your own "Feedback" menu item). */
declare function open(): void;
/** Close the panel programmatically. */
declare function close(): void;
/** Remove the widget from the page. */
declare function destroy(): void;

export { ALL_KINDS, DEFAULT_ENDPOINT, DEFAULT_LABELS, type FeedbackKind, type FeedbackLabels, type FeedbackPayload, FeedbackWidget, type FeedbackWidgetOptions, buildPayload, close, destroy, init, kindLabel, normalizeEndpoint, open, postFeedback, resolveKinds, resolveLabels };
