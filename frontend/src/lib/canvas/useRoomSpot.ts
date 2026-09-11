import { useCallback, useEffect, useState } from 'react';
import { readRoomSpot, writeRoomSpot, type RoomSpot } from './roomSpots';

/**
 * Where one thing stands in the room for this viewer: restored after mount, written
 * on every move.
 *
 * Restored in an effect rather than as the initial state, the way the folded bar and
 * the phase are: storage is a per-browser fact, and reading it during render is the
 * hydration mismatch the hooks ratchet exists to stop. The fallback is read by VALUE,
 * so a caller that derives it afresh each render does not re-read storage each render.
 */
export function useRoomSpot(key: string, fallback: RoomSpot): readonly [RoomSpot, (next: RoomSpot) => void] {
  const { x, z } = fallback;
  const [spot, setSpot] = useState<RoomSpot>({ x, z });
  useEffect(() => { setSpot(readRoomSpot(key, { x, z })); }, [key, x, z]);
  const place = useCallback((next: RoomSpot) => {
    setSpot(next);
    writeRoomSpot(key, next);
  }, [key]);
  return [spot, place] as const;
}
