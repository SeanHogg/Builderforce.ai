/**
 * WHERE AN AGENT HOST SPEAKS — the channel registry behind
 * `GET /api/agent-hosts/:id/channels`.
 *
 * That endpoint returned a hardcoded `{ channels: [] }` while a complete CRUD
 * surface shipped against it, so the list was permanently empty and add/toggle/
 * delete answered 404. This module is the missing half.
 *
 * ── A SECRET IS NEVER READ BACK OUT ──────────────────────────────────────────
 * The surface accepts a bot token or a webhook URL as free text. It is sealed with
 * the same per-tenant AES-GCM credential crypto every other integration uses, and
 * the read model exposes only whether a config is PRESENT. A registry that echoed
 * the token back would put a live Slack credential in every browser that opened
 * the panel, and in every log that recorded the response.
 *
 * ── THE PLATFORM IS A COLUMN VALUE ───────────────────────────────────────────
 * Adding Matrix or Signal is a new entry in {@link CHANNEL_PLATFORMS}, never a new
 * table and never a new branch. An unknown platform is refused rather than stored,
 * so the set the UI offers and the set the database holds cannot drift apart.
 *
 * ── READS ARE CACHED, WRITES INVALIDATE ──────────────────────────────────────
 * The panel re-reads this list on every open and after every toggle, and the rows
 * change only when somebody edits them. One version token per host keys the cache,
 * so a write orphans exactly that host's entry and nobody else's.
 */

import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { agentHostChannels } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, getCacheVersion, bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { credentialSecret, encryptCredentials } from '../integrations/credentialCrypto';

/**
 * Every platform a host can be pointed at.
 *
 * Declared once, here, because three things have to agree about it: what the
 * panel offers, what the route accepts, and what the host knows how to run. A
 * fourth copy is how a user configures a channel that silently never connects.
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

/** What a caller may see. Note what is absent: the config, and its ciphertext. */
export interface AgentHostChannelView {
  id: string;
  agentHostId: number;
  platform: ChannelPlatform;
  name: string;
  /** Whether a sealed config or a connected account backs this channel. The
   *  SECRET itself is never projected — only the fact that one exists. */
  configured: boolean;
  connectionId: string | null;
  enabled: boolean;
  lastStatus: string | null;
  lastError: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export class ChannelError extends Error {
  constructor(message: string, readonly status: 400 | 404 = 400) {
    super(message);
    this.name = 'ChannelError';
  }
}

const versionKey = (agentHostId: number) => `agent-host-channels:${agentHostId}`;

type ChannelRow = typeof agentHostChannels.$inferSelect;

function toView(row: ChannelRow): AgentHostChannelView {
  return {
    id: row.id,
    agentHostId: row.agentHostId,
    // Rows predate no platform: the column is written only through this module,
    // which refuses anything outside the list.
    platform: row.platform as ChannelPlatform,
    name: row.name,
    configured: Boolean(row.configEnc) || row.connectionId !== null,
    connectionId: row.connectionId,
    enabled: row.enabled,
    lastStatus: row.lastStatus,
    lastError: row.lastError,
    lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Every channel configured on this host, oldest first. */
export async function listChannels(
  db: Db,
  env: Env,
  tenantId: number,
  agentHostId: number,
): Promise<AgentHostChannelView[]> {
  const version = await getCacheVersion(env, versionKey(agentHostId));
  return getOrSetCached(
    env,
    `ahc:${tenantId}:${agentHostId}:${version}`,
    async () => {
      const rows = await db
        .select()
        .from(agentHostChannels)
        .where(scopedToTenant(agentHostChannels, tenantId, eq(agentHostChannels.agentHostId, agentHostId)))
        .orderBy(asc(agentHostChannels.createdAt));
      return rows.map(toView);
    },
    { kvTtlSeconds: 300 },
  );
}

/** Seal a caller-supplied config, or clear it when the caller sent an empty one. */
async function sealConfig(
  env: Env,
  tenantId: number,
  config: string | null | undefined,
): Promise<{ configEnc: string | null; configIv: string | null } | null> {
  if (config === undefined) return null;              // not being changed
  if (config === null || config.trim() === '') return { configEnc: null, configIv: null };
  // Stored as a single opaque `value`: the surface takes free text (a token, a
  // webhook URL, a JSON blob), and parsing it here would mean guessing which.
  const { enc, iv } = await encryptCredentials({ value: config.trim() }, credentialSecret(env), tenantId);
  return { configEnc: enc, configIv: iv };
}

export interface CreateChannelInput {
  platform: string;
  name: string;
  config?: string | null;
  connectionId?: string | null;
  enabled?: boolean;
}

export async function createChannel(
  db: Db,
  env: Env,
  tenantId: number,
  agentHostId: number,
  input: CreateChannelInput,
  segmentId?: string | null,
): Promise<AgentHostChannelView> {
  if (!isChannelPlatform(input.platform)) {
    throw new ChannelError(`Unsupported channel platform: ${String(input.platform)}`, 400);
  }
  const name = (input.name ?? '').trim();
  if (!name) throw new ChannelError('A channel name is required', 400);

  const sealed = await sealConfig(env, tenantId, input.config);
  const [row] = await db
    .insert(agentHostChannels)
    .values({
      tenantId,
      ...(segmentId ? { segmentId } : {}),
      agentHostId,
      platform: input.platform,
      name,
      connectionId: input.connectionId ?? null,
      configEnc: sealed?.configEnc ?? null,
      configIv: sealed?.configIv ?? null,
      enabled: input.enabled ?? true,
    })
    .returning();
  // The unique index refuses a duplicate target, which is a conflict rather than a
  // fault: the channel the caller asked for already exists on this host.
  if (!row) throw new ChannelError('That channel is already configured on this host', 400);

  await bumpCacheVersion(env, versionKey(agentHostId));
  return toView(row);
}

export interface UpdateChannelInput {
  name?: string;
  config?: string | null;
  connectionId?: string | null;
  enabled?: boolean;
}

export async function updateChannel(
  db: Db,
  env: Env,
  tenantId: number,
  agentHostId: number,
  channelId: string,
  input: UpdateChannelInput,
): Promise<AgentHostChannelView> {
  const updates: Partial<typeof agentHostChannels.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new ChannelError('A channel name is required', 400);
    updates.name = name;
  }
  if (input.enabled !== undefined) updates.enabled = input.enabled;
  if (input.connectionId !== undefined) updates.connectionId = input.connectionId;
  const sealed = await sealConfig(env, tenantId, input.config);
  if (sealed) {
    updates.configEnc = sealed.configEnc;
    updates.configIv = sealed.configIv;
  }

  const [row] = await db
    .update(agentHostChannels)
    .set(updates)
    .where(scopedToTenant(agentHostChannels, tenantId,
      and(eq(agentHostChannels.id, channelId), eq(agentHostChannels.agentHostId, agentHostId))))
    .returning();
  if (!row) throw new ChannelError('Channel not found', 404);

  await bumpCacheVersion(env, versionKey(agentHostId));
  return toView(row);
}

export async function deleteChannel(
  db: Db,
  env: Env,
  tenantId: number,
  agentHostId: number,
  channelId: string,
): Promise<void> {
  await db
    .delete(agentHostChannels)
    .where(scopedToTenant(agentHostChannels, tenantId,
      and(eq(agentHostChannels.id, channelId), eq(agentHostChannels.agentHostId, agentHostId))));
  await bumpCacheVersion(env, versionKey(agentHostId));
}

/**
 * Record what the HOST says about a channel it just brought up.
 *
 * Reported over the relay rather than asked for: the host is the only thing that
 * knows whether the adapter actually connected, and a registry that showed a
 * channel as configured while it was failing to authenticate is worse than one
 * that shows nothing.
 */
export async function recordChannelStatus(
  db: Db,
  env: Env,
  tenantId: number,
  agentHostId: number,
  input: { platform: string; name: string; status: string; error?: string | null },
): Promise<void> {
  if (!isChannelPlatform(input.platform)) return;
  await db
    .update(agentHostChannels)
    .set({
      lastStatus: input.status.slice(0, 32),
      lastError: input.error ?? null,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    })
    .where(scopedToTenant(agentHostChannels, tenantId, and(
      eq(agentHostChannels.agentHostId, agentHostId),
      eq(agentHostChannels.platform, input.platform),
      eq(agentHostChannels.name, input.name),
    )));
  await bumpCacheVersion(env, versionKey(agentHostId));
}
