/**
 * @seanhogg/builderforce-embedded
 *
 * Re-embed BuilderForce surfaces (Product Management, Agile, Governance) into any
 * React host with one component:
 *
 *   import { BuilderForceEmbed } from '@seanhogg/builderforce-embedded';
 *   <BuilderForceEmbed view="kanban" token={ssoToken} />
 *
 * The component mounts a sandboxed iframe, hands the SSO/tenant JWT to the
 * embedded app over postMessage (never in the URL), auto-resizes to content, and
 * syncs deep links. One DRY rail — hosts never build per-view embeds.
 */

export { BuilderForceEmbed } from './BuilderForceEmbed';
export type { BuilderForceEmbedProps } from './BuilderForceEmbed';

export {
  EMBED_VIEWS,
  EMBED_VIEW_KEYS,
  EMBED_CAPABILITIES,
  isEmbedView,
  pillarToCapability,
  capabilityForView,
} from './views';
export type { EmbedView, EmbedViewMeta, EmbedPillar, EmbedCapability } from './views';

// The cross-origin protocol — exported so the BuilderForce frame side imports
// the SAME contract (single source of truth, no drift).
export {
  BFEMBED_SOURCE,
  isFrameToHostMessage,
  isHostToFrameMessage,
} from './protocol';
export type {
  FrameToHostMessage,
  HostToFrameMessage,
  EmbedTheme,
} from './protocol';

export { handleFrameMessage } from './messageHandler';
export type { FrameMessageHandlers } from './messageHandler';
