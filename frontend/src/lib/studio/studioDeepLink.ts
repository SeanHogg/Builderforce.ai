/**
 * A link into a Studio project that opens a particular project CHAT — `?chat=<id>`, or a
 * chat linked to a work item, `?ticket=<kind>:<ref>`.
 *
 * Project chats live beside the editor in Studio. The canvas App surface runs the same
 * workspace but talks through the canvas Brain, so a link that names a project chat
 * (`/create/build/<id>?chat=…`, the Brain conversation header, Project 360's "open task")
 * opens Studio, and a plain build link opens the canvas. `BuildCanvasRedirect` is the one
 * place that decides; this module is the one reading of the parameters.
 */
import { studioProjectPath } from './studioHost';

export interface StudioChatLink {
  chatId: number | null;
  ticket: { kind: string; ref: string } | null;
}

/** The work-item kinds a chat can be linked to from a link. */
const TICKET_KINDS = new Set(['portfolio', 'objective', 'initiative', 'roadmap', 'spec', 'epic', 'gap', 'task']);

/** `<kind>:<ref>` → a ticket, or null when it is not one a chat can link to. */
export function parseTicketParam(raw: string | null | undefined): { kind: string; ref: string } | null {
  if (!raw) return null;
  const separator = raw.indexOf(':');
  if (separator <= 0) return null;
  const kind = raw.slice(0, separator);
  const ref = raw.slice(separator + 1);
  return ref && TICKET_KINDS.has(kind) ? { kind, ref } : null;
}

/** The chat a link names, from its `chat` and `ticket` parameters. */
export function studioChatLinkFrom(params: { get: (name: string) => string | null }): StudioChatLink {
  const chat = Number(params.get('chat'));
  return {
    chatId: Number.isInteger(chat) && chat > 0 ? chat : null,
    ticket: parseTicketParam(params.get('ticket')),
  };
}

/** True when the link names a project chat — the case that belongs in Studio. */
export function namesProjectChat(link: StudioChatLink): boolean {
  return link.chatId !== null || link.ticket !== null;
}

/** The Studio page for a project, opening the chat the link names. */
export function studioChatHref(projectId: number, link: StudioChatLink): string {
  const query = new URLSearchParams();
  if (link.chatId !== null) query.set('chat', String(link.chatId));
  if (link.ticket) query.set('ticket', `${link.ticket.kind}:${link.ticket.ref}`);
  const qs = query.toString();
  return qs ? `${studioProjectPath(projectId)}?${qs}` : studioProjectPath(projectId);
}

/** `?panel=publish` opens the workspace's Publish panel; `?prescription=<id>` names the Insights fix being built. */
export const PUBLISH_PANEL_PARAM = 'panel';
export const PUBLISH_PANEL_VALUE = 'publish';
export const PRESCRIPTION_PARAM = 'prescription';

const PRESCRIPTION_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface StudioPublishLink {
  /** The link asks for the Publish panel to be open on arrival. */
  openPublish: boolean;
  /** The Insights fix this workspace was opened for, or null. */
  prescriptionId: string | null;
}

/** The Publish-panel request and the fix a link names — the one reading of these parameters. */
export function studioPublishLinkFrom(params: { get: (name: string) => string | null }): StudioPublishLink {
  const prescription = params.get(PRESCRIPTION_PARAM);
  return {
    openPublish: params.get(PUBLISH_PANEL_PARAM) === PUBLISH_PANEL_VALUE,
    prescriptionId: prescription && PRESCRIPTION_ID.test(prescription) ? prescription : null,
  };
}

/** The Studio page for a project with its Publish panel open, building the preview of an Insights fix. */
export function studioFixPreviewHref(projectId: number, prescriptionId: string): string {
  const query = new URLSearchParams({ [PUBLISH_PANEL_PARAM]: PUBLISH_PANEL_VALUE, [PRESCRIPTION_PARAM]: prescriptionId });
  return `${studioProjectPath(projectId)}?${query.toString()}`;
}
