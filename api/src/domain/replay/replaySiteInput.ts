/**
 * What a person may write onto an Insights site — pure validation (PRD 33 §3.2, D3).
 *
 * The routes parse the body's SHAPE; this decides whether the VALUES are legal, and
 * throws a 400 (`ValidationError`) naming the field rather than clamping silently: a
 * site set to keep 150% of visits, or to keep recordings for a year, is a mistake the
 * person should see, not one the server quietly rewrites.
 */
import type { ReplaySiteSettings } from '@builderforce/interaction-contract';
import { ValidationError } from '../shared/errors';

/** D3: 30 days by default; a site may raise it to 90. */
export const REPLAY_RETENTION_MIN_DAYS = 1;
export const REPLAY_RETENTION_MAX_DAYS = 90;
export const REPLAY_SITE_LABEL_MAX = 200;
export const REPLAY_SITE_MAX_ORIGINS = 20;
const RECORDER_CHANNEL_MAX = 64;

const BOOLEAN_SETTINGS = ['maskAllText', 'consentRequired', 'recordCanvas', 'identify'] as const;

export function validateSiteLabel(raw: unknown): string {
  const label = typeof raw === 'string' ? raw.trim() : '';
  if (!label) throw new ValidationError('A site needs a name');
  if (label.length > REPLAY_SITE_LABEL_MAX) {
    throw new ValidationError(`A site name is at most ${REPLAY_SITE_LABEL_MAX} characters`);
  }
  return label;
}

/**
 * Validate a partial settings write. Only the keys present are returned; unknown
 * keys are refused rather than stored, so a typo cannot ride into the jsonb column.
 */
export function validateSiteSettingsPatch(raw: unknown): Partial<ReplaySiteSettings> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ValidationError('settings must be an object');
  const input = raw as Record<string, unknown>;
  const out: Partial<ReplaySiteSettings> = {};
  const known = new Set<string>([...BOOLEAN_SETTINGS, 'keepRate', 'retentionDays', 'recorderChannel']);
  for (const key of Object.keys(input)) {
    if (!known.has(key)) throw new ValidationError(`Unknown site setting "${key}"`);
  }
  for (const key of BOOLEAN_SETTINGS) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'boolean') throw new ValidationError(`settings.${key} must be true or false`);
    out[key] = input[key] as boolean;
  }
  if (input.keepRate !== undefined) {
    const v = input.keepRate;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
      throw new ValidationError('settings.keepRate must be between 0 and 1');
    }
    out.keepRate = v;
  }
  if (input.retentionDays !== undefined) {
    const v = input.retentionDays;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < REPLAY_RETENTION_MIN_DAYS || v > REPLAY_RETENTION_MAX_DAYS) {
      throw new ValidationError(
        `settings.retentionDays must be a whole number from ${REPLAY_RETENTION_MIN_DAYS} to ${REPLAY_RETENTION_MAX_DAYS}`,
      );
    }
    out.retentionDays = v;
  }
  if (input.recorderChannel !== undefined) {
    const v = input.recorderChannel;
    if (v !== null && (typeof v !== 'string' || v.trim().length === 0 || v.length > RECORDER_CHANNEL_MAX)) {
      throw new ValidationError(`settings.recorderChannel must be null or a name of at most ${RECORDER_CHANNEL_MAX} characters`);
    }
    out.recorderChannel = v === null ? null : (v as string).trim();
  }
  return out;
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * The origins a site key accepts, normalised to `scheme://host[:port]`, lower-case,
 * de-duplicated. https only (http for localhost, for local testing). No wildcard: the
 * key is public, and an any-origin key would let any page spend the workspace's
 * allowance.
 */
export function normaliseSiteOrigins(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new ValidationError('List at least one domain the site is served from');
  if (raw.length > REPLAY_SITE_MAX_ORIGINS) {
    throw new ValidationError(`A site accepts at most ${REPLAY_SITE_MAX_ORIGINS} domains`);
  }
  const out = new Set<string>();
  for (const entry of raw) {
    const text = typeof entry === 'string' ? entry.trim() : '';
    if (!text || text.includes('*')) throw new ValidationError(`"${String(entry)}" is not a domain this site can be served from`);
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
    let url: URL;
    try {
      url = new URL(withScheme);
    } catch {
      throw new ValidationError(`"${text}" is not a valid domain`);
    }
    const secure = url.protocol === 'https:';
    const local = url.protocol === 'http:' && isLocalHost(url.hostname);
    if (!secure && !local) throw new ValidationError(`"${text}" must be served over https`);
    if (url.username || url.password || (url.pathname && url.pathname !== '/') || url.search || url.hash) {
      throw new ValidationError(`"${text}" must be a domain only — no path, query or credentials`);
    }
    out.add(url.origin.toLowerCase());
  }
  return [...out];
}
