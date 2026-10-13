/**
 * `window.BFReplay` (PRD 33 §8 S2) — the one public API:
 * `consent(granted)`, `event(name)`, `tag(key, value)`, `identify(id, traits?)`,
 * `keep()`, `stop()`, `version`.
 *
 * Validation lives here so the recorder only ever sees clean input:
 * - event names ≤80 chars of `[\w .:-]`;
 * - tag keys ≤64, values ≤200, ≤20 keys per visit; a value that looks like an
 *   email address or a 13–19 digit card number is refused with a warning
 *   naming the tag;
 * - identify only when the site allows it (`config.identify`); traits are a
 *   flat string map of ≤20 keys.
 */

import { REPLAY_LIMITS, REPLAY_STRING_LIMITS } from '@builderforce/interaction-contract';
import { QUEUED_METHODS, type BFReplayApi, type QueuedCall } from './handoff';

const EVENT_NAME = /^[\w .:-]{1,80}$/;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const CARD = /^(?:\d[ -]?){12,18}\d$/;

export function isValidEventName(name: unknown): name is string {
  return typeof name === 'string' && EVENT_NAME.test(name);
}

/** An email address, or 13–19 digits (spaces/dashes allowed) — never stored as a tag. */
export function looksSensitive(value: string): boolean {
  return EMAIL.test(value) || CARD.test(value.trim());
}

function warn(message: string): void {
  try {
    console.warn(`[BFReplay] ${message}`);
  } catch {
    /* no console */
  }
}

/** What the recorder does with validated calls. */
export interface ReplayController {
  consent(granted: boolean): void;
  event(name: string): void;
  tag(key: string, value: string): void;
  identify(id: string, traits?: Record<string, string>): void;
  keep(): void;
  stop(): void;
}

export interface PublicApiOptions {
  version: string;
  /** `config.identify` — otherwise identify is ignored. */
  identify: boolean;
  /** Tag keys already set this visit. */
  tagKeys?: () => readonly string[];
}

function cleanTraits(traits: unknown): Record<string, string> | undefined | null {
  if (traits === undefined) return undefined;
  if (typeof traits !== 'object' || traits === null || Array.isArray(traits)) return null;
  const entries = Object.entries(traits as Record<string, unknown>);
  if (entries.length > REPLAY_STRING_LIMITS.maxTraits) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!key || key.length > REPLAY_STRING_LIMITS.traitKey) return null;
    if (typeof value !== 'string' || value.length > REPLAY_STRING_LIMITS.traitValue) return null;
    out[key] = value;
  }
  return out;
}

export function createPublicApi(ctrl: ReplayController, opts: PublicApiOptions): BFReplayApi {
  return {
    version: opts.version,
    consent(granted) {
      ctrl.consent(granted === true);
    },
    event(name) {
      if (!isValidEventName(name)) {
        warn('event ignored: names are 1–80 characters of letters, digits, space, _ . : -');
        return;
      }
      ctrl.event(name);
    },
    tag(key, value) {
      if (typeof key !== 'string' || !key || key.length > REPLAY_STRING_LIMITS.tagKey) {
        warn('tag ignored: keys are 1–64 characters');
        return;
      }
      if (typeof value !== 'string' || value.length > REPLAY_STRING_LIMITS.tagValue) {
        warn(`tag "${key}" ignored: values are strings of at most 200 characters`);
        return;
      }
      if (looksSensitive(value)) {
        warn(`tag "${key}" refused: the value looks like an email address or a card number`);
        return;
      }
      const keys = opts.tagKeys?.() ?? [];
      if (!keys.includes(key) && keys.length >= REPLAY_LIMITS.maxTagsPerVisit) {
        warn(`tag "${key}" ignored: at most ${REPLAY_LIMITS.maxTagsPerVisit} tags per visit`);
        return;
      }
      ctrl.tag(key, value);
    },
    identify(id, traits) {
      if (!opts.identify) return;
      if (typeof id !== 'string' || !id || id.length > REPLAY_STRING_LIMITS.identifyId) {
        warn('identify ignored: the id is 1–128 characters');
        return;
      }
      const clean = cleanTraits(traits);
      if (clean === null) {
        warn('identify ignored: traits are at most 20 string values');
        return;
      }
      ctrl.identify(id, clean);
    },
    keep() {
      ctrl.keep();
    },
    stop() {
      ctrl.stop();
    },
  };
}

/** Replay the loader stub's queued calls, in order, on the live API. */
export function replayQueue(api: BFReplayApi, queue: QueuedCall[]): void {
  for (const [method, args] of queue.splice(0, queue.length)) {
    if (!(QUEUED_METHODS as readonly string[]).includes(method)) continue;
    (api[method] as unknown as (...a: unknown[]) => void)(...args);
  }
}
