/**
 * The loader's config answer — `GET /api/replay-ingest/v1/config` (PRD 33 §3.5, D5).
 *
 * The loader URL never changes; this answer names the recorder each page load
 * should inject: the site's `recorderChannel` (a manifest channel, or a recorder
 * hash pinned for rollback), else the platform pin, else the manifest's latest. The
 * manifest is read from `REPLAY_MANIFEST_URL` through the read-through cache (10 min).
 *
 * `enabled: false` for an unknown/disabled site or a workspace without the licence.
 * When the recording allowance is spent the site stays `enabled` with `keepRate: 0`:
 * events of every session still count, only NEW recordings stop (D4).
 */

import { RECORDER_HASH_PATTERN, type ReplayClientConfig } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { getOrSetCached, peekCached, setCached } from '../../infrastructure/cache/readThroughCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { deferPastResponse } from '../shared/requestScope';
import { loaderTraceKey, MANIFEST_CACHE_KEY } from './replayCacheKeys';
import { replayEntitledForSite } from './replayEntitlement';
import { resolveSiteForIngest, type ReplaySiteRecord } from './replaySites';
import { recordReplayTrace, REPLAY_TRACE_VERBS } from './replayTrace';
import { canKeepNewRecording } from './replayUsage';

const SOURCE = 'application/replay/ReplayConfigService.ts';
const MANIFEST_TTL_SECONDS = 10 * 60;
const DEFAULT_CDN_ORIGIN = 'https://cdn.builderforce.ai';

interface ManifestEntry {
  version?: string;
  url?: string;
  hash?: string;
}

/** `replay/manifest.json` (written by replay-sdk's emit-assets): `latest`, optional `pinned` and `channels`. */
export interface RecorderManifest {
  latest?: ManifestEntry;
  pinned?: ManifestEntry;
  channels?: Record<string, ManifestEntry>;
}

const DISABLED: ReplayClientConfig = { enabled: false };

function usable(entry: ManifestEntry | undefined): { url: string; version: string } | null {
  if (!entry || typeof entry.url !== 'string' || !entry.url.startsWith('https://')) return null;
  return { url: entry.url, version: typeof entry.version === 'string' ? entry.version : entry.hash ?? '' };
}

/**
 * Which recorder to inject. A channel naming a manifest channel wins; a channel that
 * is a recorder content hash (`RECORDER_HASH_LENGTH` hex) pins that exact immutable build; else the platform pin;
 * else the latest.
 */
export function pickRecorder(
  manifest: RecorderManifest | null,
  channel: string | null | undefined,
  cdnOrigin: string = DEFAULT_CDN_ORIGIN,
): { url: string; version: string } | null {
  if (channel) {
    const named = usable(manifest?.channels?.[channel]);
    if (named) return named;
    if (RECORDER_HASH_PATTERN.test(channel)) {
      return { url: `${cdnOrigin.replace(/\/+$/, '')}/replay/r/recorder.${channel}.js`, version: channel };
    }
  }
  return usable(manifest?.pinned) ?? usable(manifest?.latest);
}

/** The manifest, cached 10 minutes; null when unreachable (the site then reads disabled). */
export async function loadRecorderManifest(env: Env): Promise<RecorderManifest | null> {
  const url = env.REPLAY_MANIFEST_URL;
  if (!url) return null;
  try {
    return await getOrSetCached<RecorderManifest>(env, MANIFEST_CACHE_KEY, async () => {
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`replay manifest ${response.status}`);
      return (await response.json()) as RecorderManifest;
    }, { kvTtlSeconds: MANIFEST_TTL_SECONDS });
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'loadRecorderManifest' });
    return null;
  }
}

export class ReplayConfigService {
  constructor(private readonly env: Env, private readonly db: Db) {}

  /** The config for one loader hit. Never throws; a failure reads as disabled. */
  async config(siteToken: string | null, origin: string | null, now: Date = new Date()): Promise<ReplayClientConfig> {
    try {
      const site = await resolveSiteForIngest(this.env, this.db, siteToken, origin);
      if (!site || site.status !== 'active') return DISABLED;
      if (!(await replayEntitledForSite(this.env, this.db, site))) return DISABLED;
      const recorder = pickRecorder(
        await loadRecorderManifest(this.env),
        site.settings.recorderChannel,
        this.env.REPLAY_CDN_ORIGIN,
      );
      if (!recorder) return DISABLED;
      const canKeep = await canKeepNewRecording(this.env, this.db, site.tenantId, now);
      const trace = this.traceLoaderHit(site, origin, now);
      if (!deferPastResponse(trace)) await trace;
      return {
        enabled: true,
        recorderUrl: recorder.url,
        recorderVersion: recorder.version,
        keepRate: canKeep ? site.settings.keepRate : 0,
        maskAllText: site.settings.maskAllText,
        consentRequired: site.settings.consentRequired,
        recordCanvas: site.settings.recordCanvas,
        identify: site.settings.identify,
        releaseHint: null,
      };
    } catch (error) {
      reportCaughtError(error, { source: SOURCE, operation: 'config' });
      return DISABLED;
    }
  }

  /** `replay.loader.hit` once per site per UTC day (KV-gated). */
  private async traceLoaderHit(site: ReplaySiteRecord, origin: string | null, now: Date): Promise<void> {
    try {
      const key = loaderTraceKey(site.id, now.toISOString().slice(0, 10));
      if (await peekCached<boolean>(this.env, key)) return;
      await setCached(this.env, key, true, { kvTtlSeconds: 2 * 24 * 60 * 60 });
      await recordReplayTrace(this.env, this.db, {
        tenantId: site.tenantId,
        siteId: site.id,
        verb: REPLAY_TRACE_VERBS.loaderHit,
        summary: 'Insights loader seen on the site',
        metadata: { origin },
      });
    } catch (error) {
      reportCaughtError(error, { source: SOURCE, operation: 'traceLoaderHit' });
    }
  }
}
