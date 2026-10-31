import type * as vscode from "vscode";
import { authed } from "./transport";

// ── Meetings (live video/audio) ───────────────────────────────────────────────
interface BfMeeting {
  id: string;
  title: string;
  kind: string;
  status: "scheduled" | "live" | "ended" | "cancelled";
  scheduledAt: string | null;
  durationMinutes: number;
  roomKey: string;
  videoEnabled: boolean;
}
interface BfMeetingAttendee { memberRef: string; memberName: string; response: string; }
export interface BfMeetingDetail { meeting: BfMeeting; attendees: BfMeetingAttendee[]; }
export interface BfMeetingJoin {
  roomKey: string;
  videoEnabled: boolean;
  iceServers: unknown[];
  meeting: BfMeetingDetail;
}

/** Upcoming + live meetings for the active workspace (authorization-scoped server-side). */
export async function listMeetings(secrets: vscode.SecretStorage): Promise<BfMeetingDetail[]> {
  const r = await authed<{ meetings: BfMeetingDetail[] }>(secrets, "/api/meetings?scope=upcoming");
  return r?.meetings ?? [];
}

/** Join a meeting — marks presence and returns the media room key + ICE config. */
export async function joinMeeting(secrets: vscode.SecretStorage, id: string): Promise<BfMeetingJoin> {
  const r = await authed<BfMeetingJoin>(secrets, `/api/meetings/${encodeURIComponent(id)}/join`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (!r) throw new Error("not signed in");
  return r;
}
