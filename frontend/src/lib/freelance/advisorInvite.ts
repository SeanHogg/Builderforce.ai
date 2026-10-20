/**
 * The founder's ONE act that admits a restricted advisory thread to AI context:
 * `POST /api/brain/chats/:id/advisor-invite`. The thread lives in the ADVISOR's
 * workspace and is owned by the founder; the server resolves it by chat id +
 * owner, so this works from the founder's own workspace.
 */
import { apiRequest } from '@/lib/apiClient';

export interface AdvisoryThreadInviteTarget {
  /** `meetings.chat_id` of the advisory session — null until provisioned. */
  chatId: number | null;
  /** `booking_reservations.host_ref` — the advisor's user id. */
  hostRef: string | null;
}

/** A session can invite its advisor once its restricted thread exists. */
export function canInviteAdvisor(session: AdvisoryThreadInviteTarget): session is { chatId: number; hostRef: string } {
  return typeof session.chatId === 'number' && session.chatId > 0 && !!session.hostRef?.trim();
}

export async function inviteAdvisorToAiContext(session: { chatId: number; hostRef: string }): Promise<{ founderInvitedAdvisor: boolean }> {
  return apiRequest<{ founderInvitedAdvisor: boolean }>(`/api/brain/chats/${session.chatId}/advisor-invite`, {
    method: 'POST',
    body: JSON.stringify({ advisorUserId: session.hostRef.trim() }),
  });
}
