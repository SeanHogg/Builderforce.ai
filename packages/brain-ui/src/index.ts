/**
 * @seanhogg/builderforce-brain-ui — the shared React UI for the BuilderForce
 * Brain. The single source of truth for the chat transcript experience, rendered
 * identically on the web app and inside the VS Code webview.
 *
 * Import the stylesheet once per host: `@seanhogg/builderforce-brain-ui/styles.css`
 * and map the `--bf-*` theme variables to your host's tokens.
 */

export { BrainTimeline, DEFAULT_TIMELINE_LABELS } from './BrainTimeline';
export type { BrainTimelineProps, BrainTimelineLabels } from './BrainTimeline';

export { Markdown } from './Markdown';
export type { MarkdownProps, MarkdownLabels } from './Markdown';

export {
  buildTimeline,
  attachmentsOf,
  formatDuration,
  formatPayload,
} from './timelineModel';
export type { TimelineNode, TimelineImage, BuildTimelineInput } from './timelineModel';
