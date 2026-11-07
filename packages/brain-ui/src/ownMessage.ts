import type { BrainMessage } from '@seanhogg/builderforce-brain-embedded';

/**
 * THE `isOwnMessage` every host hands `<BrainTimeline>` (PRD 42 Part E): whether the viewer wrote a message.
 * `false` ONLY when the message names an author and that author is not the viewer - the one case worth
 * translating. A message with no author (agent turn, a device-local message) or a viewer who is not known
 * answers `undefined`, which the timeline treats as the reader's own - so a host that cannot name its
 * viewer simply never translates.
 */
export function ownMessageOf(viewerUserId: string | null | undefined): (msg: BrainMessage) => boolean | undefined {
  return (msg) => (msg.authorUserId && viewerUserId ? msg.authorUserId === viewerUserId : undefined);
}
