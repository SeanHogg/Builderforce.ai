/**
 * "What do you want done?" — the Work-mode starting points.
 *
 * Shown only in WORK mode, and only before the conversation has started: once there
 * is a thread, the thread is the starting point. Picking a tile seeds the composer
 * with a COMPLETE brief (see `lib/brain/chatModes.ts` for why the briefs are long)
 * which the user then edits — the host focuses the composer with the caret at the end
 * so it reads as a sentence to finish, not a message to send.
 *
 * Self-gating on `mode`, per the shared-component rule: a host renders it
 * unconditionally and this decides whether it belongs on screen.
 *
 * Rendered through the shared `StarterTiles` shape (theme tokens, reflows from three
 * columns to one without overflowing a 360px viewport).
 */

import { useTranslations } from 'next-intl';
import { workOptions, type ChatMode, type WorkOptionId } from '@/lib/brain';
import { StarterGroup, StarterTile } from './StarterTiles';

export interface WorkOptionsPickerProps {
  /** The conversation's mode. Anything but `work` renders nothing. */
  mode: ChatMode;
  /** Seed the composer with this option's brief. */
  onPick: (id: WorkOptionId, brief: string) => void;
  disabled?: boolean;
}

export function WorkOptionsPicker({ mode, onPick, disabled }: WorkOptionsPickerProps) {
  const t = useTranslations('brain.workOptions');
  if (mode !== 'work') return null;

  return (
    <StarterGroup heading={t('tilesHint')} ariaLabel={t('pickerAria')}>
      {workOptions().map((option) => (
        <StarterTile
          key={option.id}
          icon={option.icon}
          label={t(`${option.id}.label`)}
          hint={t(`${option.id}.hint`)}
          disabled={disabled}
          onClick={() => onPick(option.id, t(`${option.id}.brief`))}
        />
      ))}
    </StarterGroup>
  );
}
