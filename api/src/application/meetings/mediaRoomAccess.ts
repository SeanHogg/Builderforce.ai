/**
 * Who may join a media (WebRTC signaling) room — the ONE port the meetings relay asks.
 *
 * The relay (`/api/meetings/rooms/:key/ws`) fans signaling out in a Durable Object named
 * `media:<key>`; before this port, any authenticated caller who knew a key could join any
 * room. Each key shape belongs to a domain, and each domain already has an access check:
 *
 *   canvas:<sessionId>   → `resolveSessionAccess` (board membership, incl. the declared
 *                          superadmin branch) — the canvas's own gate
 *   ceremony-<projectId> → `projectInTenant` — a team ceremony's room is its project's
 *   <meeting room key>   → `canAccessMeeting` (manager / organizer / attendee / project team)
 *
 * The registry below is DATA: a key pattern → an authoriser. A key that matches no entry
 * is DENIED, so a new room kind must declare its check here before it can be relayed.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { canAccessMeeting, loadMeetingByRoomKey, type MeetingCaller } from './meetingAccess';
import { resolveSessionAccess } from '../creation/sessionAccess';
import { projectInTenant } from '../project/projectOwnership';

export type MediaRoomCaller = MeetingCaller;

/** Decides whether `caller` may join the room whose id (the captured part of the key) is `id`. */
export type MediaRoomAuthoriser = (db: Db, env: Env | undefined, caller: MediaRoomCaller, id: string) => Promise<boolean>;

export interface MediaRoomRule { /** Must capture the room id as group 1. */ pattern: RegExp; authorise: MediaRoomAuthoriser; }

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** Machine subjects (`agentHost:<id>`, `embed:<keyId>`) are not people; they never join a call. */
const MACHINE_SUBJECT = /^(agentHost|embed):/;

/** A meeting that is over (or called off) has no room to signal in. */
const CLOSED_MEETING = new Set(['cancelled', 'ended']);

export const MEDIA_ROOM_RULES: readonly MediaRoomRule[] = [
  {
    pattern: new RegExp(`^canvas:(${UUID_SOURCE})$`, 'i'),
    authorise: async (db, env, caller, id) =>
      (await resolveSessionAccess(db, id, caller.tenantId, caller.userId, env)) != null,
  },
  {
    pattern: /^ceremony-(\d{1,12})$/,
    authorise: (db, _env, caller, id) => projectInTenant(db, caller.tenantId, Number(id)),
  },
  {
    // ANY stored `meetings.roomKey`: the bare UUID minted for an ad-hoc meeting, or the
    // `ceremony-<sessionUuid>` a ceremony's companion meeting is created with
    // (`ensureCeremonyMeeting`). The FULL capture is what is stored, so it is what is looked up.
    pattern: new RegExp(`^((?:ceremony-)?${UUID_SOURCE})$`, 'i'),
    authorise: async (db, _env, caller, roomKey) => {
      const meeting = await loadMeetingByRoomKey(db, caller.tenantId, roomKey);
      if (!meeting || CLOSED_MEETING.has(meeting.status)) return false;
      return canAccessMeeting(db, caller, meeting);
    },
  },
];

/** True only when a rule matches the key AND its domain check passes. Unknown shapes deny. */
export async function canJoinMediaRoom(
  db: Db,
  env: Env | undefined,
  caller: MediaRoomCaller,
  roomKey: string,
  rules: readonly MediaRoomRule[] = MEDIA_ROOM_RULES,
): Promise<boolean> {
  if (MACHINE_SUBJECT.test(caller.userId ?? '')) return false;
  for (const rule of rules) {
    const match = rule.pattern.exec(roomKey);
    if (!match?.[1]) continue;
    // A failing domain check is a refusal, never a 500 that tells a prober the key parsed.
    try { return await rule.authorise(db, env, caller, match[1]); } catch { return false; }
  }
  return false;
}
