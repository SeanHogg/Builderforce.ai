import { useCallback, useEffect, useMemo, useRef, useState, type HTMLAttributeReferrerPolicy } from 'react';
import {
  CANVAS_WIDGET_ALLOW,
  CANVAS_WIDGET_REFERRER_POLICY,
  CANVAS_WIDGET_SANDBOX,
  WIDGET_REPLY_TARGET_ORIGIN,
  effectiveWidgetOrigin,
  parseWidgetMessage,
  widgetAcceptsOrigin,
  type HostToWidgetMessage,
} from '@builderforce/canvas-widget-protocol';
import type { CanvasWidgetRecord } from '@/lib/canvasWidgetApi';
import {
  boardChangedPayload,
  handleWidgetMessage,
  hostMessage,
  rejectionReply,
  type WidgetGrant,
  type WidgetHostBridge,
} from '@/lib/canvasWidgetHost';
import styles from './CanvasWidgetFrame.module.css';

/**
 * ONE THIRD-PARTY WIDGET, FRAMED — the browser host the protocol package describes.
 *
 * Every message goes through the same four doors, in the protocol's order:
 *  1. `event.source` must be THIS frame's window — anything else is dropped unread;
 *  2. `effectiveWidgetOrigin` + `widgetAcceptsOrigin` — the registered origin, active;
 *  3. `parseWidgetMessage` — channel, version, allowlist, the REGISTERED permission;
 *  4. `handleWidgetMessage` — what it does, against a bridge that is all it can reach.
 *
 * The frame is `sandbox`ed without `allow-same-origin`, with an empty `allow` and an
 * `origin` referrer policy, all read from the package so the attributes cannot drift
 * from the contract. A second document load means the frame navigated away from its
 * registered entry URL: the host stops answering and says so, and only a reload by
 * the person restores it.
 *
 * ── WHY IT READS NO CONTEXT ──────────────────────────────────────────────────
 * It is drawn on a room stand's face through `SurfacePanel`, whose DOM lives in its own
 * root with no providers. So its caller hands it the widget, the bridge and its words.
 */

export interface CanvasWidgetFrameLabels {
  frameTitle: string;
  navigated: string;
  reload: string;
  closed: string;
  reopen: string;
}

export interface CanvasWidgetFrameProps {
  widget: CanvasWidgetRecord;
  bridge: WidgetHostBridge;
  /** Changes whenever the board does; a widget that may read the board hears about it. */
  boardVersion: unknown;
  labels: CanvasWidgetFrameLabels;
  /** `fill` takes its container's size (a stand's face, a panel); `intrinsic` starts at
   *  the manifest's height and follows `widget.resize`. */
  sizing?: 'fill' | 'intrinsic';
}

/** How long the board must be still before a widget is told it changed — a drag is
 *  sixty changes a second, and a widget wants the one where it stopped. */
const BOARD_CHANGE_SETTLE_MS = 250;

export function CanvasWidgetFrame({ widget, bridge, boardVersion, labels, sizing = 'intrinsic' }: CanvasWidgetFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const loads = useRef(0);
  // The bridge is rebuilt whenever the board changes; the listener reads the latest
  // through a ref so it is not torn down and re-added on every keystroke on the board.
  const bridgeRef = useRef(bridge);
  useEffect(() => { bridgeRef.current = bridge; }, [bridge]);
  const [state, setState] = useState<'live' | 'navigated' | 'closed'>('live');
  const [height, setHeight] = useState(widget.height);
  const [generation, setGeneration] = useState(0);

  const grant = useMemo<WidgetGrant>(
    () => ({ id: widget.id, key: widget.key, version: widget.version, permissions: widget.permissions }),
    [widget.id, widget.key, widget.permissions, widget.version],
  );

  const post = useCallback((message: HostToWidgetMessage) => {
    const target = frameRef.current?.contentWindow;
    // Never to a frame that has navigated: '*' is only safe while the document in it is
    // the one the host put there.
    if (!target || loads.current > 1) return;
    target.postMessage(message, WIDGET_REPLY_TARGET_ORIGIN);
  }, []);

  useEffect(() => {
    if (state !== 'live') return undefined;
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const origin = effectiveWidgetOrigin({
        eventOrigin: event.origin,
        fromOwnFrame: true,
        navigated: loads.current > 1,
        entryOrigin: widget.entryOrigin,
      });
      if (!widgetAcceptsOrigin(widget, origin)) return;
      const verdict = parseWidgetMessage(event.data, { origin, expectedOrigin: widget.entryOrigin, granted: widget.permissions });
      if (!verdict.ok) {
        const refusal = rejectionReply(verdict.reason, event.data);
        if (refusal) post(refusal);
        return;
      }
      const reply = handleWidgetMessage(verdict.message, bridgeRef.current, {
        resize: setHeight,
        close: () => setState('closed'),
      }, grant);
      if (reply) post(reply);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [grant, post, state, widget]);

  const settled = useRef(false);
  useEffect(() => {
    // The first board is the one `widget.ready` is answered with; only later ones are news.
    if (!settled.current) { settled.current = true; return undefined; }
    if (state !== 'live' || loads.current === 0) return undefined;
    const timer = window.setTimeout(() => {
      const payload = boardChangedPayload(bridgeRef.current, grant);
      if (Object.keys(payload).length) post(hostMessage('host.boardChanged', undefined, payload));
    }, BOARD_CHANGE_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [boardVersion, grant, post, state]);

  const onLoad = useCallback(() => {
    loads.current += 1;
    if (loads.current > 1) setState('navigated');
  }, []);

  const restart = useCallback(() => {
    loads.current = 0;
    setState('live');
    setGeneration((value) => value + 1);
  }, []);

  if (state !== 'live') {
    return (
      <div className={styles.notice} role="status" data-testid="canvas-widget-stopped">
        <p>{state === 'navigated' ? labels.navigated : labels.closed}</p>
        <button type="button" className={styles.restart} onClick={restart}>
          {state === 'navigated' ? labels.reload : labels.reopen}
        </button>
      </div>
    );
  }

  return (
    <iframe
      key={generation}
      ref={frameRef}
      className={styles.frame}
      data-sizing={sizing}
      data-testid="canvas-widget-frame"
      src={widget.entryUrl}
      title={labels.frameTitle}
      sandbox={CANVAS_WIDGET_SANDBOX}
      allow={CANVAS_WIDGET_ALLOW}
      referrerPolicy={CANVAS_WIDGET_REFERRER_POLICY as HTMLAttributeReferrerPolicy}
      loading="lazy"
      onLoad={onLoad}
      style={sizing === 'intrinsic' ? { height } : undefined}
    />
  );
}
