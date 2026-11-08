/** The strip's state (the chip's dot) and the colour token each one takes. The state is never colour-only: the chip's accessible name carries it in words. */

import type { ThemeTone } from '../../scene/themeColors';

/** `serverOnly`: reviewed on the server, never on this machine - neutral, not a fault. `partial`: both sides hold files and the counts differ. */
export type StatusState = 'synced' | 'syncing' | 'error' | 'idle' | 'partial' | 'serverOnly';

export const STATUS_TONE: Record<StatusState, ThemeTone> = { synced: 'agrees', syncing: 'accent', error: 'violation', idle: 'unused', partial: 'cycle', serverOnly: 'unused' };
