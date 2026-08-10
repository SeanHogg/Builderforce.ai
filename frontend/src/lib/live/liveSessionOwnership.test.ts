import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('live media ownership', () => {
  it('keeps useMediaRoom ownership in the shell provider only', () => {
    const root = resolve(process.cwd(), 'src');
    const owners = [
      'lib/live/LiveSessionContext.tsx',
      'components/meetings/MeetingRoom.tsx',
      'components/ceremony/CeremonyStage.tsx',
      'components/brain/GuestRoomMeeting.tsx',
    ].filter((path) => readFileSync(resolve(root, path), 'utf8').includes('useMediaRoom('));
    expect(owners).toEqual(['lib/live/LiveSessionContext.tsx']);
  });
});
