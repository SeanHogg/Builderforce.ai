/**
 * In-platform messaging — two-party employer↔freelancer threads.
 *
 * Its own module rather than part of the freelance marketplace client because a
 * conversation is its own bounded context: it outlives the engagement that started
 * it, it is the only thing here that carries an attachment, and it is the only
 * caller that has to choose a credential per request. The freelancer's side uses
 * the person-level WEB token (a freelancer may have no workspace at all) and the
 * employer's side uses the workspace TENANT token — `authFor` is that whole rule.
 *
 * Feeds mutate on every send, so they are polled and never cached.
 */
import { apiRequestStream, type AuthMode } from './apiClient';
import { jsonOrThrow } from './apiEnvelope';

export interface ConversationSummary {
  id: string;
  tenantId: number;
  tenantName: string | null;
  freelancerUserId: string;
  freelancerName: string | null;
  employerUserId: string | null;
  subjectType: 'engagement' | 'job' | 'proposal' | 'direct';
  engagementId: string | null;
  jobId: string | null;
  proposalId: string | null;
  projectId: number | null;
  title: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unread: number;
  updatedAt: string | null;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  senderUserId: string;
  senderName: string | null;
  /** True when the freelancer authored it (drives left/right bubble alignment). */
  fromFreelancer: boolean;
  body: string;
  attachmentName: string | null;
  attachmentType: string | null;
  hasAttachment: boolean;
  createdAt: string | null;
}

export type MessagingSide = 'employer' | 'freelancer';

/**
 * Which credential a messaging call carries. A freelancer may have no workspace
 * at all, so their side of a conversation uses the person-level web JWT while the
 * employer's side uses the workspace JWT.
 */
const authFor = (side: MessagingSide): AuthMode => (side === 'freelancer' ? 'web' : 'tenant');

/** The freelancer's endpoints are the employer's under a `/mine` prefix. */
const convBase = (side: MessagingSide, path = '') =>
  `/api/conversations${side === 'freelancer' ? '/mine' : ''}${path}`;

const threadPath = (side: MessagingSide, id: string, suffix: string) =>
  `/api/conversations/${side === 'freelancer' ? 'mine/' : ''}${id}/${suffix}`;

/** List my conversations for the given side, with per-thread + total unread counts. */
export async function listConversations(side: MessagingSide): Promise<{ items: ConversationSummary[]; unread: number }> {
  const res = await apiRequestStream(convBase(side), { auth: authFor(side) });
  return jsonOrThrow(res, 'Failed to load messages');
}

export async function getConversationThread(side: MessagingSide, id: string): Promise<{ conversation: ConversationSummary; messages: ConversationMessage[] }> {
  const res = await apiRequestStream(threadPath(side, id, 'messages'), { auth: authFor(side) });
  return jsonOrThrow(res, 'Failed to load thread');
}

/** Send a message (text, and optionally an attachment) into a conversation. */
export async function sendConversationMessage(side: MessagingSide, id: string, input: { body: string; file?: File | null }): Promise<{ id: string }> {
  const url = threadPath(side, id, 'messages');
  if (input.file) {
    const fd = new FormData();
    fd.append('body', input.body);
    fd.append('file', input.file);
    const res = await apiRequestStream(url, { method: 'POST', auth: authFor(side), body: fd });
    return jsonOrThrow(res, 'Failed to send');
  }
  const res = await apiRequestStream(url, { method: 'POST', auth: authFor(side), body: JSON.stringify({ body: input.body }) });
  return jsonOrThrow(res, 'Failed to send');
}

export async function markConversationRead(side: MessagingSide, id: string): Promise<void> {
  const res = await apiRequestStream(threadPath(side, id, 'read'), { method: 'POST', auth: authFor(side) });
  await jsonOrThrow(res, 'Failed');
}

/** Employer opens (or reuses) a thread with a freelancer, optionally scoped + seeded. */
export async function startEmployerConversation(input: { freelancerUserId: string; engagementId?: string; jobId?: string; proposalId?: string; subjectType?: string; title?: string; body?: string }): Promise<{ id: string }> {
  const res = await apiRequestStream(`/api/conversations`, { method: 'POST', auth: 'tenant', body: JSON.stringify(input) });
  return jsonOrThrow(res, 'Failed to start conversation');
}

/** Freelancer opens (or reuses) a thread with an engaged tenant. */
export async function startFreelancerConversation(input: { engagementId: string; title?: string; body?: string }): Promise<{ id: string }> {
  const res = await apiRequestStream(`/api/conversations/mine`, { method: 'POST', auth: 'web', body: JSON.stringify(input) });
  return jsonOrThrow(res, 'Failed to start conversation');
}

/** Fetch a message attachment as a blob (the serve route requires an auth header, so
 *  it can't be a plain <img src>) and hand back an object URL the caller opens/revokes. */
export async function fetchConversationAttachment(side: MessagingSide, messageId: string): Promise<string> {
  const res = await apiRequestStream(`/api/conversations/attachment/${messageId}`, { auth: authFor(side) });
  if (!res.ok) throw new Error('Failed to load attachment');
  return URL.createObjectURL(await res.blob());
}
