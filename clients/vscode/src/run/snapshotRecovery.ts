/**
 * G26 VSIX corrupt-file recovery. Pure: no filesystem, no lock, no vscode.
 * A later store calls this instead of throwing or stealing a lock. This module
 * does not open `local-first-v1.json`.
 *
 * A corrupt payload is never recovered as an empty store. Last-good bytes are
 * returned only when they can be redacted. Otherwise the result is unavailable.
 */
import { BUSY_TIMEOUT, leaseBusy } from "@builderforce/local-first";

/**
 * Busy timeout for a later VSIX store: the contract's `until_release`.
 * This is not a millisecond steal window. 30_000 must not be used to delete
 * the lock and admit a second window.
 */
export const VSIX_SNAPSHOT_BUSY_TIMEOUT = BUSY_TIMEOUT;

export type VsixSnapshotBusyTimeout = typeof VSIX_SNAPSHOT_BUSY_TIMEOUT;

/**
 * A second window never takes the lock because of age.
 * `heldForMs` of 30_000, or any later time, does not admit them.
 */
export function secondWindowMayStealLock(heldForMs: number, holder: string | null | undefined = "other-window"): false {
  // Age is passed through and ignored. A named holder stays busy. A missing
  // holder is not a steal grant either.
  if (leaseBusy(holder, heldForMs, 0)) return false;
  return false;
}

/**
 * Secret-shaped fields omitted from any recovery copy a later store writes.
 * Values are dropped. They are not copied into the recovery copy.
 */
export const VSIX_SNAPSHOT_SECRET_FIELDS = [
  "token",
  "password",
  "authorization",
  "cookie",
  "apiKey",
  "clientSecret",
  "secret",
  "accessToken",
  "refreshToken",
] as const;

export type VsixSnapshotSecretField = (typeof VSIX_SNAPSHOT_SECRET_FIELDS)[number];

/** Stated redaction rule for the recovery copy. */
export const VSIX_SNAPSHOT_REDACTION_NOTE =
  "Secrets are not written into the recovery copy.";

const SECRET_KEY_SET = new Set<string>(
  VSIX_SNAPSHOT_SECRET_FIELDS.map((key) => key.toLowerCase()),
);

const SECRET_FIELD_PATTERN = new RegExp(
  `"(${VSIX_SNAPSHOT_SECRET_FIELDS.join("|")})"\\s*:\\s*"(?:\\\\.|[^"\\\\])*"`,
  "gi",
);

export type RecoveryCopy =
  | { readonly kind: "unavailable"; readonly reason: "corrupt_snapshot" }
  | { readonly kind: "last-good"; readonly bytes: string };

export interface CorruptSnapshotRecovery {
  readonly reason: "corrupt_snapshot";
  readonly recovered: RecoveryCopy;
  readonly redactionNote: typeof VSIX_SNAPSHOT_REDACTION_NOTE;
  readonly busyTimeout: VsixSnapshotBusyTimeout;
}

function baseRecovery(recovered: RecoveryCopy): CorruptSnapshotRecovery {
  return {
    reason: "corrupt_snapshot",
    recovered,
    redactionNote: VSIX_SNAPSHOT_REDACTION_NOTE,
    busyTimeout: VSIX_SNAPSHOT_BUSY_TIMEOUT,
  };
}

function isSecretKey(key: string): boolean {
  return SECRET_KEY_SET.has(key.toLowerCase());
}

function decodeLastGood(value: string | Uint8Array | null | undefined): string | undefined {
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  if (value instanceof Uint8Array && value.byteLength > 0) {
    return new TextDecoder().decode(value);
  }
  return undefined;
}

function collectSecretValues(payload: unknown, into: Set<string>, seen: WeakSet<object>): void {
  if (typeof payload === "string") {
    try {
      collectSecretValues(JSON.parse(payload) as unknown, into, seen);
    } catch {
      for (const match of payload.matchAll(SECRET_FIELD_PATTERN)) {
        const raw = match[0];
        const valueMatch = /:\s*"((?:\\.|[^"\\])*)"/.exec(raw);
        if (valueMatch?.[1]) into.add(valueMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
      }
    }
    return;
  }
  if (Array.isArray(payload)) {
    if (seen.has(payload)) return;
    seen.add(payload);
    for (const item of payload) collectSecretValues(item, into, seen);
    return;
  }
  if (payload !== null && typeof payload === "object") {
    if (seen.has(payload)) return;
    seen.add(payload);
    for (const key of Object.keys(payload)) {
      let child: unknown;
      try {
        child = (payload as Record<string, unknown>)[key];
      } catch {
        continue;
      }
      if (isSecretKey(key)) {
        if (typeof child === "string" && child.length > 0) into.add(child);
        continue;
      }
      collectSecretValues(child, into, seen);
    }
  }
}

function redactValue(value: unknown, ancestors: readonly object[]): unknown {
  if (Array.isArray(value)) {
    if (ancestors.includes(value)) return [];
    const path = [...ancestors, value];
    return value.map((item) => redactValue(item, path));
  }
  if (value !== null && typeof value === "object") {
    if (ancestors.includes(value)) return {};
    const path = [...ancestors, value];
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      if (isSecretKey(key)) continue;
      try {
        // `path` is the ancestry only: two references to the same record are
        // both copied. Only a reference into its own ancestry is a cycle.
        out[key] = redactValue((value as Record<string, unknown>)[key], path);
      } catch {
        // A throwing getter is corrupt input, not something to copy.
      }
    }
    return out;
  }
  return value;
}

function echoesSecret(text: string, secrets: ReadonlySet<string>): boolean {
  for (const secret of secrets) {
    if (secret.length >= 4 && text.includes(secret)) return true;
  }
  SECRET_FIELD_PATTERN.lastIndex = 0;
  return SECRET_FIELD_PATTERN.test(text);
}

function scrubSecretValues(text: string, secrets: ReadonlySet<string>): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 4 && out.includes(secret)) out = out.split(secret).join("");
  }
  return out.replace(SECRET_FIELD_PATTERN, "");
}

function redactRecoveryBytes(raw: string, secrets: ReadonlySet<string>): string | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const redacted = redactValue(parsed, []);
    const rewritten = JSON.stringify(redacted);
    const text = scrubSecretValues(rewritten === JSON.stringify(parsed) ? raw : rewritten, secrets);
    SECRET_FIELD_PATTERN.lastIndex = 0;
    if (echoesSecret(text, secrets)) return undefined;
    SECRET_FIELD_PATTERN.lastIndex = 0;
    return text;
  } catch {
    // Opaque bytes that still carry a secret cannot be a recovery copy.
    SECRET_FIELD_PATTERN.lastIndex = 0;
    if (echoesSecret(raw, secrets)) return undefined;
    return raw;
  }
}

/**
 * Recover from a corrupt snapshot without throwing and without substituting
 * an empty store.
 *
 * The corrupt payload is never copied into the result. The recovery copy is
 * last-good bytes when those are provided and can be returned without a secret
 * field. Otherwise the result is unavailable: a corrupt file is not an empty
 * snapshot. `redactionNote` states that secrets are not written into that copy.
 */
export function recoverCorruptSnapshot(
  payload: unknown,
  lastGoodBytes?: string | Uint8Array | null,
): CorruptSnapshotRecovery {
  const unavailable = (): CorruptSnapshotRecovery =>
    baseRecovery({ kind: "unavailable", reason: "corrupt_snapshot" });
  try {
    const secrets = new Set<string>();
    collectSecretValues(payload, secrets, new WeakSet());
    const bytes = decodeLastGood(lastGoodBytes);
    if (bytes !== undefined) {
      const redacted = redactRecoveryBytes(bytes, secrets);
      if (redacted !== undefined) {
        return baseRecovery({ kind: "last-good", bytes: redacted });
      }
    }
    return unavailable();
  } catch {
    return unavailable();
  }
}
