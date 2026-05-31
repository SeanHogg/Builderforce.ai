/**
 * The cross-origin postMessage contract between a host page (e.g. BurnRateOS,
 * via <BuilderForceEmbed>) and the embedded BuilderForce surface running inside
 * the iframe. This is the SINGLE source of truth for the wire protocol — both
 * the host component (this package) and the BuilderForce frame route import it,
 * so the two sides can never drift.
 *
 * Security model: the host NEVER puts the JWT in the iframe URL. The frame
 * announces `ready`; the host replies with `auth` carrying the token. Every
 * message is tagged with `source` and validated against the expected origin on
 * both ends before it is trusted.
 */

export const BFEMBED_SOURCE = 'builderforce-embed/v1' as const;

export type EmbedTheme = 'light' | 'dark';

// ── Frame → Host ─────────────────────────────────────────────────────────────

export type FrameToHostMessage =
  /** Frame mounted and is ready to receive auth. */
  | { source: typeof BFEMBED_SOURCE; type: 'ready' }
  /** Frame's content height changed; host should resize the iframe. */
  | { source: typeof BFEMBED_SOURCE; type: 'resize'; height: number }
  /** Frame navigated internally; host may mirror this into its own URL. */
  | { source: typeof BFEMBED_SOURCE; type: 'navigate'; path: string }
  /** Frame hit an error worth surfacing to the host. */
  | { source: typeof BFEMBED_SOURCE; type: 'error'; message: string };

// ── Host → Frame ─────────────────────────────────────────────────────────────

export type HostToFrameMessage =
  /** Hand the frame the SSO/tenant JWT + optional federated segment coordinates. */
  | {
      source: typeof BFEMBED_SOURCE;
      type: 'auth';
      token: string;
      accountId?: string;
      companyId?: string;
      theme?: EmbedTheme;
    }
  /** Push a deep-link the frame should navigate to (host URL → frame sync). */
  | { source: typeof BFEMBED_SOURCE; type: 'navigate'; path: string };

// ── Guards ───────────────────────────────────────────────────────────────────

function isTagged(data: unknown): data is { source: typeof BFEMBED_SOURCE; type: string } {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === BFEMBED_SOURCE &&
    typeof (data as { type?: unknown }).type === 'string'
  );
}

export function isFrameToHostMessage(data: unknown): data is FrameToHostMessage {
  if (!isTagged(data)) return false;
  switch (data.type) {
    case 'ready':
      return true;
    case 'resize':
      return typeof (data as { height?: unknown }).height === 'number';
    case 'navigate':
      return typeof (data as { path?: unknown }).path === 'string';
    case 'error':
      return typeof (data as { message?: unknown }).message === 'string';
    default:
      return false;
  }
}

export function isHostToFrameMessage(data: unknown): data is HostToFrameMessage {
  if (!isTagged(data)) return false;
  switch (data.type) {
    case 'auth':
      return typeof (data as { token?: unknown }).token === 'string';
    case 'navigate':
      return typeof (data as { path?: unknown }).path === 'string';
    default:
      return false;
  }
}
