import { useCallback, useEffect, useRef } from 'react';
import type { CanvasPresenceSpatial, CanvasPresenceState } from '@builderforce/creation-canvas-contract';
import { PRESENCE_SEND_INTERVAL_MS } from '@/lib/canvas/livePresence';

/** Re-assert presence comfortably inside the relay's 30s expiry. */
export const BODY_HEARTBEAT_MS = 10_000;

/**
 * ANNOUNCING WHERE MY BODY IS — the one sender every spatial surface uses.
 *
 * ── WHY ONE HOOK FOR A SEAT AND A WALKER ──────────────────────────────────────
 * A seated body changes once (I arrived, the ring closed up); a walking body
 * changes sixty times a second. Both need the same three rules, and they were
 * about to be written twice:
 *  • THROTTLE — never faster than `PRESENCE_SEND_INTERVAL_MS`, with a trailing
 *    send so the LAST position (where the walker stopped) always goes out;
 *  • HEARTBEAT — the relay drops a peer after 30s without a frame, which is right
 *    for a pointer and wrong for a person standing still, so the last body is
 *    re-asserted every `BODY_HEARTBEAT_MS`;
 *  • RETRACT — leaving takes the body away now (`spatial: null`), not after the TTL.
 *
 * `enabled: false` hands the body to someone else (the room while a level is being
 * played inside it): no heartbeat, no retract — the owner does both.
 */
export function useBodyAnnouncer(
  onPresence: (state: CanvasPresenceState) => void,
  enabled = true,
): (spatial: CanvasPresenceSpatial) => void {
  const lastRef = useRef<CanvasPresenceSpatial | null>(null);
  const sentAtRef = useRef(0);
  const trailingRef = useRef<number | null>(null);
  const sendRef = useRef(onPresence);
  useEffect(() => { sendRef.current = onPresence; }, [onPresence]);

  const flush = useCallback(() => {
    trailingRef.current = null;
    if (!lastRef.current) return;
    sentAtRef.current = Date.now();
    sendRef.current({ spatial: lastRef.current });
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = window.setInterval(() => { if (lastRef.current) sendRef.current({ spatial: lastRef.current }); }, BODY_HEARTBEAT_MS);
    return () => {
      window.clearInterval(timer);
      if (trailingRef.current !== null) window.clearTimeout(trailingRef.current);
      trailingRef.current = null;
      lastRef.current = null;
      // `null` is the contract's own "I left" — see `canvasPresenceFrame`.
      sendRef.current({ spatial: null });
    };
  }, [enabled]);

  return useCallback((spatial: CanvasPresenceSpatial) => {
    if (!enabled) return;
    lastRef.current = spatial;
    const wait = PRESENCE_SEND_INTERVAL_MS - (Date.now() - sentAtRef.current);
    if (wait <= 0) { flush(); return; }
    if (trailingRef.current === null) trailingRef.current = window.setTimeout(flush, wait);
  }, [enabled, flush]);
}
