/**
 * WHERE AN AGENT HOST SPEAKS — the platforms a channel can be pointed at.
 *
 * Declared once, here, because three things have to agree about it: what the
 * panel offers, what `POST /api/agent-hosts/:id/channels` accepts, and what
 * the host knows how to run. Two hand-written unions (API + frontend) plus a
 * third array in the panel is how a user configures a channel that silently
 * never connects. Adding Matrix is a new entry in {@link CHANNEL_PLATFORMS},
 * never a new table and never a new branch.
 *
 * Lives in this package rather than in either consumer because the Worker
 * route, the browser panel and the typed client already share this contract
 * for every other vocabulary that must not drift; a fourth copy is the bug
 * this file exists to make impossible.
 */

export const CHANNEL_PLATFORMS = [
  'slack',
  'discord',
  'telegram',
  'whatsapp',
  'teams',
  'google_chat',
  'signal',
  'webhook',
] as const;

export type ChannelPlatform = (typeof CHANNEL_PLATFORMS)[number];

export function isChannelPlatform(value: unknown): value is ChannelPlatform {
  return typeof value === 'string' && (CHANNEL_PLATFORMS as readonly string[]).includes(value);
}
