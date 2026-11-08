// No 'use client' directive: rendered only by `LiveSessionProvider`, already a client boundary.
import { useEffect, useRef } from 'react';
import { useOptionalLiveSession } from '@/lib/live/LiveSessionContext';

/**
 * The ONE place a call's remote audio is played.
 *
 * Every gallery `<video>` (VideoTile, the live bar's tile) is muted, because a gallery can
 * be mounted twice at once (the dock and the Room) and an unmuted `<video>` per mount
 * plays each voice twice — while a peer who joined with audio only has no gallery tile
 * worth mounting at all and would be silent. One hidden `<audio autoplay>` per remote
 * stream, owned by the session provider, makes both true: each voice plays exactly once,
 * whatever is or isn't on screen.
 */
function Sink({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (node && node.srcObject !== stream) node.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay aria-hidden="true" hidden />;
}

/** Mount ONCE per app, inside `LiveSessionProvider` (the shell does). Reads the session itself. */
export function RemoteAudioSink() {
  const live = useOptionalLiveSession();
  if (!live) return null;
  return <>{live.tiles.map((tile) => <Sink key={tile.peerId} stream={tile.stream} />)}</>;
}
