/**
 * Kimi Code's OAuth credential record, as it lives on disk.
 *
 * ONE reason to change: the on-disk credential format. The endpoint/model half of an
 * install is `kimiCodeInstall.ts`; the OAuth protocol is `kimiCodeAuth.ts`.
 *
 * This is a FOREIGN file — Kimi Code owns it and refreshes it whenever it runs — so both
 * halves of the contract are matched exactly rather than approximated:
 *
 *   wire  : snake_case `{ access_token, refresh_token, expires_at, scope, token_type,
 *           expires_in }`, `expires_at` in SECONDS
 *   write : `<name>.tmp.<pid>.<rand>` at mode 0600 → fsync → rename over the target,
 *           parent dir 0700, body pretty-printed with a trailing newline
 *   revoke: an EMPTY `access_token` is Kimi's tombstone for "signed out", not corruption
 *
 * Writing another application's credential file is not something to do casually. It is
 * done here because Kimi rotates the refresh token on every grant: taking a new access
 * token without persisting the new refresh token would leave Kimi Code holding one the
 * server has already retired, which would break the user's own Kimi Code install. Reading
 * without writing is the unsafe option, not the safe one.
 */

import { randomBytes } from "node:crypto";
import path from "node:path";

/** The record, in the field names this module's callers use. */
export interface KimiCredentialRecord {
  accessToken: string;
  refreshToken: string;
  /** Absolute expiry, in SECONDS since the epoch (Kimi's unit, kept as-is). */
  expiresAt: number;
  scope: string;
  tokenType: string;
  /** Lifetime the server granted, in seconds. Observed value: 900. */
  expiresIn: number;
}

/** The filesystem operations this module performs, injected so it is unit-testable. */
export interface KimiCredentialFs {
  existsSync(target: string): boolean;
  readFileSync(target: string, encoding: "utf8"): string;
  readdirSync(target: string): string[];
  mkdirSync(target: string, options: { recursive: true; mode: number }): void;
  writeFileSync(target: string, data: string, options: { mode: number }): void;
  renameSync(from: string, to: string): void;
  unlinkSync(target: string): void;
}

/** Where a credential sits in its lifecycle. Drives whether a caller may use it, must
 *  refresh it, or has to send the user back to Kimi Code. */
export type KimiCredentialState =
  /** Usable now, and far enough from expiry to start a request. */
  | { kind: "fresh"; record: KimiCredentialRecord }
  /** Still parseable and refreshable, but too close to (or past) expiry to use. */
  | { kind: "stale"; record: KimiCredentialRecord }
  /** Kimi's signed-out tombstone: the record exists with an empty access token. */
  | { kind: "revoked" }
  /** No file, or a file this reader cannot make sense of. `detail` names the fields it
   *  saw — never a value — so an unfamiliar shape produces one actionable sentence
   *  rather than an unexplained empty model picker. */
  | { kind: "unreadable"; detail: string };

/**
 * Refresh once the remaining life drops below `max(300s, expires_in / 2)`.
 *
 * Copied deliberately from Kimi Code's own `defaultRefreshThreshold` rather than invented:
 * two clients refreshing the same rotating credential on different schedules is how one
 * of them ends up holding a retired refresh token. With Kimi's 900-second grants this is
 * 450 seconds, so a token is replaced at the halfway mark and no request ever starts on
 * one that could die mid-stream.
 */
const MIN_REFRESH_THRESHOLD_SECONDS = 300;
const REFRESH_THRESHOLD_RATIO = 0.5;

export function refreshThresholdSeconds(expiresIn: number): number {
  return expiresIn > 0
    ? Math.max(MIN_REFRESH_THRESHOLD_SECONDS, expiresIn * REFRESH_THRESHOLD_RATIO)
    : MIN_REFRESH_THRESHOLD_SECONDS;
}

/** Kimi's own file modes: 0600 for the credential, 0700 for the directory. */
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

/** The credential directory and the one file inside it that Kimi Code writes. */
export function credentialsDir(home: string): string {
  return path.join(home, "credentials");
}
export function credentialPath(home: string, name = "kimi-code"): string {
  return path.join(credentialsDir(home), `${name}.json`);
}

/** Wire → record. Mirrors Kimi's `tokenFromWire`, including its permissive defaults. */
function fromWire(wire: Record<string, unknown>): KimiCredentialRecord {
  return {
    accessToken: typeof wire.access_token === "string" ? wire.access_token : "",
    refreshToken: typeof wire.refresh_token === "string" ? wire.refresh_token : "",
    expiresAt: typeof wire.expires_at === "number" ? wire.expires_at : 0,
    scope: typeof wire.scope === "string" ? wire.scope : "",
    tokenType: typeof wire.token_type === "string" ? wire.token_type : "",
    expiresIn: typeof wire.expires_in === "number" ? wire.expires_in : 0,
  };
}

/** Record → wire. Mirrors Kimi's `tokenToWire` field-for-field, so a file this module
 *  writes is indistinguishable from one Kimi Code wrote. */
function toWire(record: KimiCredentialRecord): Record<string, unknown> {
  return {
    access_token: record.accessToken,
    refresh_token: record.refreshToken,
    expires_at: record.expiresAt,
    scope: record.scope,
    token_type: record.tokenType,
    expires_in: record.expiresIn,
  };
}

/** Classify a parsed record against the clock. Exported so the refresh path and the
 *  picker ask the same question in the same place. */
export function classifyCredential(record: KimiCredentialRecord, nowMs: number): KimiCredentialState {
  if (record.accessToken.length === 0) return { kind: "revoked" };
  const remainingSeconds = record.expiresAt - Math.floor(nowMs / 1000);
  return remainingSeconds > refreshThresholdSeconds(record.expiresIn)
    ? { kind: "fresh", record }
    : { kind: "stale", record };
}

/**
 * Read the credential Kimi Code holds for this install.
 *
 * Every failure degrades to `unreadable` with a description: a developer without Kimi
 * Code is the normal case, and a machine that has it must never lose its model picker to
 * a malformed foreign file.
 */
export function loadCredential(
  fs: KimiCredentialFs,
  home: string,
  nowMs: number = Date.now(),
): KimiCredentialState {
  const dir = credentialsDir(home);
  if (!fs.existsSync(dir)) {
    return { kind: "unreadable", detail: "Kimi Code is installed but has never signed in." };
  }
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((name) => name.toLowerCase().endsWith(".json")).sort();
  } catch {
    return { kind: "unreadable", detail: `Could not read ${dir}.` };
  }
  if (files.length === 0) {
    return { kind: "unreadable", detail: "Kimi Code is installed but has never signed in." };
  }

  let lastDetail = "No readable credential in the Kimi Code store.";
  for (const name of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    } catch {
      lastDetail = `The Kimi Code credential file ${name} is not valid JSON.`;
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
    const record = fromWire(parsed as Record<string, unknown>);
    // An empty access token is the tombstone, and it is decisive — reporting it as an
    // unknown shape would send the user to debug a file that is doing exactly its job.
    if (record.accessToken.length === 0) return { kind: "revoked" };
    if (record.refreshToken.length === 0 && record.expiresAt === 0) {
      // Neither usable nor refreshable: name the fields so an unfamiliar format is
      // diagnosable from the picker without anyone opening a credential file.
      lastDetail = `Unrecognized Kimi Code credential shape in ${name}. Fields: ${
        Object.keys(parsed as Record<string, unknown>).sort().join(", ") || "(none)"
      }.`;
      continue;
    }
    return classifyCredential(record, nowMs);
  }
  return { kind: "unreadable", detail: lastDetail };
}

/**
 * Persist a rotated credential in Kimi Code's exact write protocol.
 *
 * Atomic where the platform allows it: a distinct temp name per process, fsync via the
 * write, then a rename over the target. A half-written credential file would sign the
 * user out of Kimi Code as well as out of this extension, so the rename is the only
 * moment the real path changes.
 */
export function saveCredential(
  fs: KimiCredentialFs,
  home: string,
  record: KimiCredentialRecord,
  name = "kimi-code",
): void {
  const dir = credentialsDir(home);
  fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  const target = credentialPath(home, name);
  const tmp = `${target}.tmp.${process.pid}.${randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, `${JSON.stringify(toWire(record), null, 2)}\n`, { mode: FILE_MODE });
  try {
    fs.renameSync(tmp, target);
  } catch (error) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // The rename already failed; a failed cleanup must not mask the real error.
    }
    throw error;
  }
}
