/** Public types for the embeddable Builderforce feedback widget. */

/** The kinds of request the widget can file. Mirrors the API's FEEDBACK_KINDS. */
export type FeedbackKind = 'feature' | 'bug' | 'idea' | 'other';

/** The wire shape posted to `${endpoint}/submit`. */
export interface FeedbackPayload {
  kind: FeedbackKind;
  title?: string;
  body: string;
  email?: string;
  name?: string;
  url?: string;
  appVersion?: string;
  context?: Record<string, unknown>;
}

export interface FeedbackWidgetOptions {
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
  onSubmit?: (result: { submissionId: string; deduped: boolean }) => void;
}

export interface FeedbackLabels {
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
