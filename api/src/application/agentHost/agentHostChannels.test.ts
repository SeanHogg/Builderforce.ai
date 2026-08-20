/**
 * A REGISTRY THAT NEVER HANDS THE CREDENTIAL BACK.
 *
 * The channels endpoint used to answer a hardcoded `{ channels: [] }` while a full
 * CRUD panel shipped against it. Now that it is real, the property that matters
 * most is not that it stores rows — it is what it REFUSES to say: the read model
 * projects whether a config exists and never the config, because a panel that
 * round-tripped the value would put a live bot token in every browser that opened
 * it and in every log that recorded the response.
 *
 * The other invariant under test is that a platform is a COLUMN VALUE from a
 * declared list. An unknown one is refused rather than stored, so the set the UI
 * offers and the set the database holds cannot drift apart.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { fakeDb } from '../../../test/fakeDb';
import {
  CHANNEL_PLATFORMS,
  ChannelError,
  createChannel,
  isChannelPlatform,
  listChannels,
  recordChannelStatus,
  updateChannel,
} from './agentHostChannels';

const env = { JWT_SECRET: 'test-secret-value-for-derivation' } as unknown as Env;

const row = (over: Record<string, unknown> = {}) => ({
  id: 'ch-1',
  tenantId: 42,
  segmentId: null,
  agentHostId: 7,
  platform: 'slack',
  name: '#general',
  connectionId: null,
  configEnc: null,
  configIv: null,
  enabled: true,
  lastStatus: null,
  lastError: null,
  lastSeenAt: null,
  createdAt: new Date('2026-08-19T12:00:00Z'),
  updatedAt: new Date('2026-08-19T12:00:00Z'),
  ...over,
});

beforeEach(() => { vi.restoreAllMocks(); });

describe('the platform list is the contract', () => {
  it('accepts every declared platform and nothing else', () => {
    for (const p of CHANNEL_PLATFORMS) expect(isChannelPlatform(p)).toBe(true);
    expect(isChannelPlatform('matrix')).toBe(false);
    expect(isChannelPlatform('')).toBe(false);
    expect(isChannelPlatform(undefined)).toBe(false);
  });

  it('refuses to store a channel on a platform nothing can run', async () => {
    const db = fakeDb([]);
    await expect(createChannel(db as unknown as Db, env, 42, 7, { platform: 'matrix', name: '#x' }))
      .rejects.toBeInstanceOf(ChannelError);
    expect(db.calls).toHaveLength(0);
  });

  it('refuses a channel with no name, which could address nothing', async () => {
    await expect(createChannel(fakeDb([]) as unknown as Db, env, 42, 7, { platform: 'slack', name: '   ' }))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe('the secret never comes back out', () => {
  it('projects only WHETHER a config is stored', async () => {
    const db = fakeDb([[row({ configEnc: 'sealed-ciphertext', configIv: 'aabb' })]]);
    const [view] = await listChannels(db as unknown as Db, env, 42, 7);
    expect(view).toMatchObject({ id: 'ch-1', platform: 'slack', name: '#general', configured: true });
    // The shapes that would leak it, by every name they could arrive under.
    expect(view).not.toHaveProperty('config');
    expect(view).not.toHaveProperty('configEnc');
    expect(view).not.toHaveProperty('configIv');
    expect(JSON.stringify(view)).not.toContain('sealed-ciphertext');
  });

  it('counts a connected account as configured even with no sealed blob', async () => {
    const db = fakeDb([[row({ connectionId: 'conn-1' })]]);
    const [view] = await listChannels(db as unknown as Db, env, 42, 7);
    expect(view!.configured).toBe(true);
  });

  it('reports a channel with neither as not configured', async () => {
    const db = fakeDb([[row()]]);
    const [view] = await listChannels(db as unknown as Db, env, 42, 7);
    expect(view!.configured).toBe(false);
  });

  it('seals a supplied config rather than storing it as text', async () => {
    const db = fakeDb([[row({ configEnc: 'x', configIv: 'y' })]]);
    await createChannel(db as unknown as Db, env, 42, 7, {
      platform: 'slack', name: '#general', config: 'xoxb-super-secret',
    });
    const written = db.calls[0]!.payload as Record<string, unknown>;
    expect(written.configEnc).toBeTruthy();
    expect(written.configIv).toBeTruthy();
    expect(JSON.stringify(written)).not.toContain('xoxb-super-secret');
  });
});

describe('updating', () => {
  it('leaves the stored credentials alone when the caller sends no config', async () => {
    const db = fakeDb([[row()]]);
    await updateChannel(db as unknown as Db, env, 42, 7, 'ch-1', { enabled: false });
    const set = db.calls[0]!.payload as Record<string, unknown>;
    expect(set).toMatchObject({ enabled: false });
    // Absent, not null — null would ERASE the credentials on a toggle.
    expect(set).not.toHaveProperty('configEnc');
  });

  it('clears the credentials when the caller explicitly sends an empty one', async () => {
    const db = fakeDb([[row()]]);
    await updateChannel(db as unknown as Db, env, 42, 7, 'ch-1', { config: '' });
    const set = db.calls[0]!.payload as Record<string, unknown>;
    expect(set.configEnc).toBeNull();
    expect(set.configIv).toBeNull();
  });

  it('404s a channel that is not on this host', async () => {
    await expect(updateChannel(fakeDb([[]]) as unknown as Db, env, 42, 7, 'ch-nope', { enabled: true }))
      .rejects.toMatchObject({ status: 404 });
  });
});

describe('host-reported status', () => {
  it('records what the host says about a channel', async () => {
    const db = fakeDb([[]]);
    await recordChannelStatus(db as unknown as Db, env, 42, 7, {
      platform: 'slack', name: '#general', status: 'connected',
    });
    const set = db.calls[0]!.payload as Record<string, unknown>;
    expect(set).toMatchObject({ lastStatus: 'connected', lastError: null });
    expect(set.lastSeenAt).toBeInstanceOf(Date);
  });

  it('ignores a status for a platform nothing can run, rather than writing it', async () => {
    const db = fakeDb([[]]);
    await recordChannelStatus(db as unknown as Db, env, 42, 7, {
      platform: 'matrix', name: '#x', status: 'connected',
    });
    expect(db.calls).toHaveLength(0);
  });

  it('truncates an over-long status to what the column can hold', async () => {
    const db = fakeDb([[]]);
    await recordChannelStatus(db as unknown as Db, env, 42, 7, {
      platform: 'slack', name: '#general', status: 'x'.repeat(200),
    });
    expect((db.calls[0]!.payload as { lastStatus: string }).lastStatus).toHaveLength(32);
  });
});
