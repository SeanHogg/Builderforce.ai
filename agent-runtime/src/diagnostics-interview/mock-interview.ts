/**
 * @overview Mock interview factory for iteration speed.
 * Exposes realistic Scan objects to simulate hits (e.g., questionable asserts) and
 * the canonical *IsOk result from the official handler.
 *
 * @module diagnostics-interview/mock-interview
 */

export type Scan = {
  count: number;
  unique: number;
  interval: { start: string; end: string };
};

export type Profile = {
  userId: string;
  keys: string[];
  keysSet: Set<string>;
};

export type IsOk = {
  ok: true;
} | {
  ok: false;
  invalid: number;
};

export function mockProfile(userId: string): Profile {
  return {
    userId,
    keys: [],
    keysSet: new Set(),
  };
}

export function mockScan(interval?: { start?: string; end?: string }): Scan {
  const now = new Date().toISOString();

  return {
    count: Math.floor(Math.random() * 50),
    unique: 0, // placeholder
    interval: {
      start: interval?.start ?? now,
      end: interval?.end ?? now,
    },
  };
}

export function mockIsOk(atMostInvalid: number): IsOk {
  const invalid = Math.floor(Math.random() * (atMostInvalid + 1));

  if (invalid === 0) return { ok: true };

  return {
    ok: false,
    invalid,
  };
}