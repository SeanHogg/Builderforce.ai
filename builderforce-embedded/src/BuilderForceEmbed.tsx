import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { BFEMBED_SOURCE, type EmbedTheme, type HostToFrameMessage } from './protocol';
import { handleFrameMessage } from './messageHandler';
import { EMBED_VIEWS, isEmbedView, type EmbedView } from './views';

const DEFAULT_BASE_URL = 'https://app.builderforce.ai';
const DEFAULT_MIN_HEIGHT = 480;

export interface BuilderForceEmbedProps {
  /** Which BuilderForce surface to mount (see EMBED_VIEWS). */
  view: EmbedView;
  /**
   * The SSO / tenant JWT. A string, or a (possibly async) getter so the host can
   * mint/refresh a token lazily — it is resolved when the frame announces ready
   * and handed over via postMessage (never placed in the iframe URL).
   */
  token: string | (() => string | Promise<string>);
  /** BuilderForce embed origin. Defaults to https://app.builderforce.ai. */
  baseUrl?: string;
  /** Federated segment coordinates for a 'segmented' tenant (account, company). */
  accountId?: string;
  companyId?: string;
  /** Initial deep-link path within the view (e.g. a board id). */
  path?: string;
  theme?: EmbedTheme;
  className?: string;
  style?: CSSProperties;
  /** Floor height until the frame reports its own content height. */
  minHeight?: number;
  /** Fired when the embedded surface navigates — mirror into the host URL. */
  onNavigate?: (path: string) => void;
  onError?: (message: string) => void;
  onReady?: () => void;
}

/**
 * The single, DRY embed rail for re-embedding BuilderForce into a host app.
 * One component parameterized by `view` — it owns the iframe mount, the secure
 * JWT handoff, auto-resize, and deep-link sync. Hosts never build bespoke
 * per-view embeds; they render <BuilderForceEmbed view="…" />.
 */
export function BuilderForceEmbed({
  view,
  token,
  baseUrl = DEFAULT_BASE_URL,
  accountId,
  companyId,
  path,
  theme,
  className,
  style,
  minHeight = DEFAULT_MIN_HEIGHT,
  onNavigate,
  onError,
  onReady,
}: BuilderForceEmbedProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(minHeight);
  const [ready, setReady] = useState(false);

  const embedOrigin = useMemo(() => {
    try {
      return new URL(baseUrl).origin;
    } catch {
      return DEFAULT_BASE_URL;
    }
  }, [baseUrl]);

  const src = useMemo(() => {
    const base = `${embedOrigin}/embed/${view}`;
    return path ? `${base}#${encodeURIComponent(path)}` : base;
    // `path` is the INITIAL deep link; later changes are pushed via postMessage
    // so the iframe doesn't full-reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedOrigin, view]);

  const postToFrame = useCallback(
    (message: HostToFrameMessage) => {
      iframeRef.current?.contentWindow?.postMessage(message, embedOrigin);
    },
    [embedOrigin],
  );

  // Resolve the token (string or getter) and hand it to the frame.
  const sendAuth = useCallback(async () => {
    const resolved = typeof token === 'function' ? await token() : token;
    postToFrame({
      source: BFEMBED_SOURCE,
      type: 'auth',
      token: resolved,
      accountId,
      companyId,
      theme,
    });
  }, [token, accountId, companyId, theme, postToFrame]);

  // Inbound frame → host messages.
  useEffect(() => {
    const listener = (event: MessageEvent) =>
      handleFrameMessage(event, {
        embedOrigin,
        onReady: () => {
          setReady(true);
          void sendAuth();
          onReady?.();
        },
        onResize: (h) => setHeight(Math.max(h, minHeight)),
        onNavigate: (p) => onNavigate?.(p),
        onError: (m) => onError?.(m),
      });
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [embedOrigin, sendAuth, minHeight, onNavigate, onError, onReady]);

  // Host URL → frame deep-link sync (after the frame is ready).
  useEffect(() => {
    if (ready && path != null) {
      postToFrame({ source: BFEMBED_SOURCE, type: 'navigate', path });
    }
  }, [ready, path, postToFrame]);

  const label = EMBED_VIEWS[view]?.label ?? view;
  if (!isEmbedView(view)) {
    // Defensive: a bad `view` should fail visibly, not silently load a 404 frame.
    return (
      <div className={className} style={style} role="alert">
        Unknown BuilderForce view: {String(view)}
      </div>
    );
  }

  return (
    <div className={className} style={{ position: 'relative', width: '100%', ...style }}>
      {!ready && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#64748b',
            font: '14px system-ui, sans-serif',
          }}
        >
          Loading {label}…
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={src}
        title={`BuilderForce — ${label}`}
        style={{ width: '100%', height, border: 'none', display: 'block' }}
        sandbox="allow-scripts allow-forms allow-popups allow-same-origin allow-downloads"
        referrerPolicy="strict-origin-when-cross-origin"
        loading="lazy"
      />
    </div>
  );
}
