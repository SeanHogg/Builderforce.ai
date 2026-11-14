import { authed } from "./transport";
/** Upcoming + live meetings for the active workspace (authorization-scoped server-side). */
export async function listMeetings(secrets) {
    const r = await authed(secrets, "/api/meetings?scope=upcoming");
    return r?.meetings ?? [];
}
/** Join a meeting — marks presence and returns the media room key + ICE config. */
export async function joinMeeting(secrets, id) {
    const r = await authed(secrets, `/api/meetings/${encodeURIComponent(id)}/join`, {
        method: "POST",
        body: JSON.stringify({}),
    });
    if (!r)
        throw new Error("not signed in");
    return r;
}
//# sourceMappingURL=meetings.js.map