import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { HOUR_MS } from '../../domain/shared/time';

/**
 * ICE configuration for every mesh-P2P surface — tenant meetings/ceremonies AND
 * the free logged-out guest rooms. Both need the identical STUN/TURN answer, so
 * it lives here once rather than being re-derived per route.
 *
 * WebRTC ICE server descriptor (the DOM `RTCIceServer` type is absent in the
 * Workers lib, so declare the shape we serialize to the client).
 */
export interface IceServer { urls: string | string[]; username?: string; credential?: string; }

/**
 * Short-lived TURN credentials minted from Cloudflare's TURN service, when a
 * Cloudflare TURN key is configured (`CLOUDFLARE_TURN_KEY_ID` +
 * `CLOUDFLARE_TURN_API_TOKEN`). This turns "provision a TURN relay" into setting
 * two secrets instead of standing up coturn. Cached (creds outlive the cache TTL),
 * best-effort — a failure just omits TURN and mesh falls back to STUN.
 */
/** A call's realistic maximum: the credential lives this long, and no cache outlives it. */
const TURN_CREDENTIAL_TTL_SECONDS = 4 * 60 * 60;

async function cloudflareTurn(env: Env, subject?: string): Promise<IceServer | null> {
  const keyId = env.CLOUDFLARE_TURN_KEY_ID;
  const token = env.CLOUDFLARE_TURN_API_TOKEN;
  if (!keyId || !token) return null;
  try {
    return await getOrSetCached<IceServer>(
      env,
      // Per caller when one is named, so a TURN credential minted for one person is never
      // handed to another; the shared key remains for the anonymous (guest) path.
      `turn:cf:${keyId}${subject ? `:${subject}` : ''}`,
      async () => {
        const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ttl: TURN_CREDENTIAL_TTL_SECONDS }),
        });
        if (!res.ok) throw new Error(`cloudflare turn ${res.status}`);
        const d = (await res.json()) as { iceServers?: { urls?: string | string[]; username?: string; credential?: string } };
        const ice = d.iceServers;
        if (!ice?.urls) throw new Error('cloudflare turn: no urls');
        return { urls: ice.urls, username: ice.username, credential: ice.credential };
      },
      // Cached for well under the credential's life, so a served credential always has
      // most of its 4 hours left.
      { kvTtlSeconds: 3_600, l1TtlMs: HOUR_MS / 4 },
    );
  } catch {
    return null;
  }
}

/** ICE servers for mesh P2P — public STUN, plus a TURN relay when configured
 *  (static `TURN_URL`, and/or Cloudflare-minted short-lived credentials). */
export async function iceServers(env: Env, subject?: string): Promise<IceServer[]> {
  const servers: IceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];
  if (env.TURN_URL) {
    servers.push({
      urls: env.TURN_URL.split(',').map((u) => u.trim()).filter(Boolean),
      username: env.TURN_USERNAME,
      credential: env.TURN_CREDENTIAL,
    });
  }
  const cf = await cloudflareTurn(env, subject);
  if (cf) servers.push(cf);
  return servers;
}
