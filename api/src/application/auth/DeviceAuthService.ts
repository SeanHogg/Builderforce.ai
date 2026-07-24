import { and, eq, lt, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { deviceAuthorizations, tenantMembers } from '../../infrastructure/database/schema';
import { hashSecret } from '../../infrastructure/auth/HashService';
import { encryptSecretForStorage, decryptSecretFromStorage } from '../../infrastructure/auth/MfaService';
import { mintTenantApiKey } from '../llm/tenantApiKeyService';

const DEVICE_TTL_SECS = 600;
const POLL_INTERVAL_SECS = 5;
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars

function randomDeviceCode(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
}

function randomUserCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let s = '';
  for (let i = 0; i < 8; i++) s += USER_CODE_ALPHABET[bytes[i]! % USER_CODE_ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export interface DeviceCodeStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  interval: number;
  expires_in: number;
}

export type DevicePollResult =
  | { state: 'approved'; accessKey: string; tenantId: number }
  | { state: 'pending' }
  | { state: 'slow_down' }
  | { state: 'denied' }
  | { state: 'expired' };

export type DeviceApproveResult = { ok: true } | { ok: false; error: string };

/**
 * Device Authorization Grant (RFC 8628). Bridges the API-key-only gateway to a browser
 * login: start() issues a code pair, approve() mints a tenant gateway key (the kind the
 * gateway accepts) and stores it encrypted, poll() delivers it exactly once.
 */
export class DeviceAuthService {
  constructor(private readonly db: Db) {}

  async start(appUrl: string, client?: string): Promise<DeviceCodeStart> {
    const deviceCode = randomDeviceCode();
    const userCode = randomUserCode();
    const deviceCodeHash = await hashSecret(deviceCode);
    const expiresAt = new Date(Date.now() + DEVICE_TTL_SECS * 1000);

    await this.db.insert(deviceAuthorizations).values({
      deviceCodeHash,
      userCode,
      status: 'pending',
      intervalSecs: POLL_INTERVAL_SECS,
      client: client?.slice(0, 32) ?? null,
      expiresAt,
    });

    const verifyBase = `${appUrl.replace(/\/$/, '')}/activate`;
    return {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: verifyBase,
      verification_uri_complete: `${verifyBase}?code=${encodeURIComponent(userCode)}`,
      interval: POLL_INTERVAL_SECS,
      expires_in: DEVICE_TTL_SECS,
    };
  }

  /** Resolve the tenant to mint against: explicit, else the user's first active membership. */
  private async resolveTenant(userId: string, tenantId?: number): Promise<number | undefined> {
    if (tenantId) return tenantId;
    const [membership] = await this.db
      .select({ tenantId: tenantMembers.tenantId })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.userId, userId), eq(tenantMembers.isActive, true)))
      .limit(1);
    return membership?.tenantId;
  }

  /**
   * Mint a tenant gateway key (bfk_*) for an editor connection. Available to any active
   * member (not owner-gated, unlike the shared tenant-keys admin page) — it's the user's
   * own editor credential. Single mint path reused by approve() and the editor-key route.
   */
  async mintEditorKey(opts: {
    userId: string;
    tenantId?: number;
  }): Promise<{ ok: true; key: string; tenantId: number } | { ok: false; error: string }> {
    const tenantId = await this.resolveTenant(opts.userId, opts.tenantId);
    if (!tenantId) return { ok: false, error: 'no_tenant' };
    const minted = await mintTenantApiKey(this.db, {
      tenantId,
      name: 'VS Code',
      createdByUserId: opts.userId,
    });
    return { ok: true, key: minted.key, tenantId };
  }

  /** Approve a pending device by user_code; mints a tenant gateway key (bfk_*). */
  async approve(opts: {
    userCode: string;
    userId: string;
    tenantId?: number;
    envSecret: string;
  }): Promise<DeviceApproveResult> {
    const code = opts.userCode.trim().toUpperCase();
    const [row] = await this.db
      .select()
      .from(deviceAuthorizations)
      .where(eq(deviceAuthorizations.userCode, code))
      .limit(1);

    if (!row) return { ok: false, error: 'unknown_code' };
    if (row.status !== 'pending') return { ok: false, error: 'already_resolved' };
    if (row.expiresAt <= new Date()) return { ok: false, error: 'expired' };

    const minted = await this.mintEditorKey({ userId: opts.userId, tenantId: opts.tenantId });
    if (!minted.ok) return { ok: false, error: minted.error };
    // M2: seal the issued gateway key under the dedicated credential secret (caller
    // passes credentialSecret(env) as envSecret), per-tenant-bound (v2). Legacy rows
    // still decrypt in poll() via the JWT_SECRET fallback.
    const enc = await encryptSecretForStorage(minted.key, opts.envSecret, { tenantId: minted.tenantId });

    await this.db
      .update(deviceAuthorizations)
      .set({
        status: 'approved',
        userId: opts.userId,
        tenantId: minted.tenantId,
        issuedKeyEnc: enc,
        approvedAt: sql`now()`,
      })
      .where(eq(deviceAuthorizations.id, row.id));

    return { ok: true };
  }

  async deny(userCode: string): Promise<void> {
    await this.db
      .update(deviceAuthorizations)
      .set({ status: 'denied' })
      .where(
        and(
          eq(deviceAuthorizations.userCode, userCode.trim().toUpperCase()),
          eq(deviceAuthorizations.status, 'pending'),
        ),
      );
  }

  /** Poll for the minted key; delivers it exactly once, then nulls it.
   *  `envSecret` is the dedicated credential secret; `legacySecret` (JWT_SECRET)
   *  lets pre-migration rows still decrypt (versioned dual-read). */
  async poll(deviceCode: string, envSecret: string, legacySecret?: string): Promise<DevicePollResult> {
    const hash = await hashSecret(deviceCode);
    const [row] = await this.db
      .select()
      .from(deviceAuthorizations)
      .where(eq(deviceAuthorizations.deviceCodeHash, hash))
      .limit(1);

    if (!row) return { state: 'expired' };
    if (row.expiresAt <= new Date()) return { state: 'expired' };
    if (row.status === 'denied') return { state: 'denied' };

    if (row.lastPolledAt && Date.now() - row.lastPolledAt.getTime() < row.intervalSecs * 1000) {
      return { state: 'slow_down' };
    }
    await this.db
      .update(deviceAuthorizations)
      .set({ lastPolledAt: sql`now()` })
      .where(eq(deviceAuthorizations.id, row.id));

    if (row.status === 'approved' && row.issuedKeyEnc && row.tenantId != null) {
      const accessKey = await decryptSecretFromStorage(row.issuedKeyEnc, envSecret, { tenantId: row.tenantId, legacySecret });
      await this.db
        .update(deviceAuthorizations)
        .set({ status: 'claimed', issuedKeyEnc: null })
        .where(eq(deviceAuthorizations.id, row.id));
      return { state: 'approved', accessKey, tenantId: row.tenantId };
    }
    if (row.status === 'claimed') return { state: 'expired' };
    return { state: 'pending' };
  }

  /** Best-effort cleanup of long-expired rows. */
  async sweep(): Promise<void> {
    await this.db
      .delete(deviceAuthorizations)
      .where(lt(deviceAuthorizations.expiresAt, sql`now() - interval '1 day'`));
  }
}
