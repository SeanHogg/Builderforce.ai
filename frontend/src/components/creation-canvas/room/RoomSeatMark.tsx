import { AvatarFace } from '@/components/Avatar';
import { bodyColor, type RoomPalette, type RoomSeat } from '@/lib/canvas/roomSeating';
import surfaceStyles from '../CanvasRoomSurface.module.css';

/**
 * The mark beside a name in the room's lists — the person's picture when they have
 * one, otherwise the dot in their body's colour.
 *
 * One component because the roster and the no-WebGL fallback both list the same
 * seats, and two copies of "picture or dot" would drift. The picture is the app's
 * one `AvatarFace`, ringed in the body's colour so the list still ties each face to
 * the figure in the room; decorative, since the name is right beside it.
 */
export function RoomSeatMark({ seat, palette }: { seat: RoomSeat; palette: RoomPalette }) {
  const color = bodyColor(seat.userId, palette, seat.isSelf);
  if (seat.avatarUrl) return <AvatarFace name={seat.displayName} imageUrl={seat.avatarUrl} color={color} active size={20} />;
  return <span className={surfaceStyles.seatDot} style={{ background: color }} />;
}
