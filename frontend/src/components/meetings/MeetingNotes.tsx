'use client';

import { SlideOutPanel } from '@/components/SlideOutPanel';
import { MeetingMinutesPanel } from './MeetingMinutesPanel';

/**
 * Past-meeting notes as a slide-out — the meetings list's door onto a finished
 * meeting's record.
 *
 * It is only the door. Reading the record, generating minutes that were never
 * generated, and every state in between belong to `MeetingMinutesPanel`, because a
 * ceremony's history and a board's stand-up card want exactly the same thing and a
 * component that cannot leave its own panel guarantees they each get a copy of it.
 */
export function MeetingNotes({
  meetingId, title, open, onClose,
}: {
  meetingId: string;
  title: string;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <SlideOutPanel open={open} onClose={onClose} title={title}>
      <div style={{ padding: 20 }}>
        {/* Mounted only while open, so closing and reopening re-reads a meeting that
            may have been summarized in the meantime. */}
        {open && <MeetingMinutesPanel meetingId={meetingId} />}
      </div>
    </SlideOutPanel>
  );
}
