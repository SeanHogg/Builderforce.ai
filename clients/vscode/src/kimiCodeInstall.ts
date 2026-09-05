/**
 * The Kimi Code installation ON THIS MACHINE — its endpoint, its model table, and the
 * credential its own login already stored.
 *
 * Why this module exists: Kimi Code subscription keys are licensed for a personal
 * interactive client, and Kimi's edge enforces that by refusing our hosted gateway's
 * egress with an HTML 403 *before* the API reads a credential (see
 * `api/src/application/llm/hostEgress.ts`). The VS Code extension host is not a hosted
 * gateway — it is a Node process on the developer's own machine, the very client the
 * subscription is for — so it can simply make the call itself. It needs three facts to do
 * that, and Kimi Code already wrote all three to disk when the user signed in:
 *
 *   ~/.kimi-code/config.toml            → base_url + the model table
 *   ~/.kimi-code/credentials/*.json     → the OAuth result (`storage = "file"`)
 *
 * So nothing is pasted, nothing is captured off the wire, and nothing is impersonated:
 * we read the user's own install and use the account they already authenticated.
 *
 * Deliberately free of any `vscode` import — the parsers are the part worth testing, and
 * the vitest harness has no extension-host stub. Filesystem access rides the narrow
 * {@link KimiCodeFs} port for the same reason.
 *
 * ONE reason to change: the on-disk shape of a Kimi Code install. How the editor SERVES a
 * local model lives in `localModels.ts`; how a turn is ROUTED lives in `modelRouting.ts`.
 */

import os from "node:os";
import path from "node:path";

/** The filesystem reads this module performs. Injected so the parsers are testable. */
export interface KimiCodeFs {
  existsSync(target: string): boolean;
  readFileSync(target: string, encoding: "utf8"): string;
  readdirSync(target: string): string[];
}

/** One model the local install declares, from its `[models."kimi-code/<id>"]` table. */
export interface KimiCodeModel {
  /** The bare id Kimi's API knows, e.g. `kimi-for-coding`, `k3-256k`. */
  model: string;
  /** Kimi's own label, e.g. "K2.7 Coding", "K3-256k". Shown in the picker as-is. */
  displayName: string;
  /** Context window Kimi declares, when it declares one. */
  maxContextSize?: number;
}

/** A usable local install: everything needed to make the call from this machine. */
export interface KimiCodeInstall {
  /** Resolved `KIMI_CODE_HOME`. */
  home: string;
  /** OpenAI-compatible base, e.g. `https://api.kimi.com/coding/v1`. */
  baseUrl: string;
  /** Bearer token from the install's own login. */
  token: string;
  /** Models the install declares, in file order (Kimi lists its default first). */
  models: readonly KimiCodeModel[];
}

/**
 * Why a local install could not be used. Carried rather than collapsed to null because
 * each reason sends the user somewhere different, and one of them ("the credential file
 * is a shape this reader does not know") must be able to say WHAT it saw — otherwise the
 * only symptom is a Kimi group silently missing from the model picker.
 */
export interface KimiCodeUnavailable {
  reason: "no_install" | "no_endpoint" | "no_credential" | "expired";
  /** Operator-facing detail. Never contains a credential VALUE — only key names. */
  detail: string;
}

export type KimiCodeInstallResult = KimiCodeInstall | KimiCodeUnavailable;

/** Narrow the union without every caller repeating the `"reason" in x` shape. */
export function isKimiCodeInstall(result: KimiCodeInstallResult): result is KimiCodeInstall {
  return !("reason" in result);
}

/**
 * The install root: `KIMI_CODE_HOME` when set (Kimi documents the system-level variable as
 * the ONLY way to relocate it — there is no separate VS Code setting), else `~/.kimi-code`.
 */
export function resolveKimiCodeHome(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const configured = env.KIMI_CODE_HOME?.trim();
  return configured && configured.length > 0 ? configured : path.join(homedir(), ".kimi-code");
}

// ---------------------------------------------------------------------------
// config.toml
// ---------------------------------------------------------------------------

/** The subset of `config.toml` this module needs. */
export interface KimiCodeConfig {
  baseUrl: string | null;
  models: KimiCodeModel[];
}

/** `key = <value>` inside the table currently open. */
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

/** Unwrap a TOML scalar to the two types this reader consumes. Anything else is ignored
 *  — the file also carries arrays and booleans that no caller here reads. */
function scalar(raw: string): string | number | null {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1);
  }
  if (/^-?\d+$/.test(value)) return Number(value);
  return null;
}

/**
 * Read the two tables we care about out of Kimi's `config.toml`.
 *
 * Deliberately NOT a general TOML parser — writing one to read four keys would be a
 * liability, and a wrong general parser fails in ways a targeted reader cannot. This
 * handles exactly the shapes the file uses: `[table]` / `[table."quoted.segment"]`
 * headers, `key = "string"`, and `key = <integer>`. Everything else is skipped, so an
 * unrecognized construct costs nothing rather than throwing on a valid file.
 *
 * The provider table is matched by PREFIX (`[providers."managed:kimi-code"`) so the
 * nested `.oauth` sub-table does not close it — `base_url` sits in the parent, and a
 * strict equality match silently lost it the moment Kimi nested anything.
 */
export function parseKimiCodeConfig(text: string): KimiCodeConfig {
  const models: KimiCodeModel[] = [];
  let baseUrl: string | null = null;
  let table = "";
  let current: KimiCodeModel | null = null;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      table = trimmed;
      // A model table opens a record; anything else closes the one in progress.
      const model = /^\[models\."kimi-code\/(.+)"\]$/.exec(trimmed);
      current = model ? { model: model[1]!, displayName: model[1]! } : null;
      if (current) models.push(current);
      continue;
    }

    const assignment = ASSIGNMENT.exec(trimmed);
    if (!assignment) continue;
    const [, key, rawValue] = assignment;
    const value = scalar(rawValue!);
    if (value === null) continue;

    // The provider table's own `base_url`. The `.oauth` child has no base_url of its own,
    // and the search/fetch SERVICES have their own — which must never win, since they are
    // different APIs (`/v1/search`, `/v1/fetch`), not the completions endpoint.
    if (table === '[providers."managed:kimi-code"]' && key === "base_url" && typeof value === "string") {
      baseUrl = value;
      continue;
    }
    if (!current) continue;
    // `model` overrides the id parsed from the header: the header is Kimi's REF
    // (`kimi-code/k3`), the field is what its API expects on the wire (`k3`).
    if (key === "model" && typeof value === "string") current.model = value;
    if (key === "display_name" && typeof value === "string") current.displayName = value;
    if (key === "max_context_size" && typeof value === "number") current.maxContextSize = value;
  }

  return { baseUrl, models };
}

// ---------------------------------------------------------------------------
// credentials/
// ---------------------------------------------------------------------------

/**
 * Field names an OAuth credential store uses for the bearer token, most specific first.
 *
 * A LIST rather than one name because the store is Kimi's private format, not a contract
 * they publish — and the failure mode of assuming a single name is the worst one
 * available: the Kimi group vanishes from the picker with no explanation. Trying the
 * conventional set and REPORTING what was actually present ({@link resolveKimiToken})
 * turns an invisible failure into one sentence the user can act on. The same
 * try-in-order shape the runtime already uses for other providers' local credentials
 * (`agent-runtime/src/infra/provider-usage.auth.ts`).
 */
const TOKEN_FIELDS = ["access_token", "accessToken", "api_key", "apiKey", "token", "id_token"] as const;

/** Field names carrying the absolute expiry, in epoch seconds or milliseconds. */
const EXPIRY_FIELDS = ["expires_at", "expiresAt", "expiry", "expires"] as const;

/** A string long enough to be a credential rather than an enum like `"Bearer"`. */
const MIN_TOKEN_LENGTH = 16;

/**
 * Treat a token as spent this long BEFORE its stated expiry.
 *
 * Not defensive padding — it is load-bearing here. Kimi issues access tokens with
 * `expires_in: 900`, i.e. FIFTEEN MINUTES, so a credential read off disk is routinely
 * close to the end of its life. Starting a completion with four seconds left produces a
 * mid-stream 401 that reads to the user as "Kimi is broken", where declining to start
 * produces the one sentence that actually helps. The window is small enough that it never
 * rejects a token with useful life left.
 */
const EXPIRY_SKEW_MS = 30_000;

interface TokenSearch {
  token?: string;
  /** The field the token came from — logged, never the value. */
  field?: string;
  expiresAt?: number;
  /** Every string-valued key seen, so a miss can name the shape it found. */
  keysSeen: string[];
}

/** Walk the parsed credential document for the first plausible token. Recursive because
 *  a store commonly nests the record under a provider or profile key. */
function searchToken(node: unknown, out: TokenSearch, depth = 0): void {
  if (depth > 6 || node === null || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (typeof value === "string") {
      out.keysSeen.push(key);
      if (!out.token && (TOKEN_FIELDS as readonly string[]).includes(key) && value.length >= MIN_TOKEN_LENGTH) {
        out.token = value;
        out.field = key;
      }
    } else if (typeof value === "number") {
      out.keysSeen.push(key);
      if (out.expiresAt === undefined && (EXPIRY_FIELDS as readonly string[]).includes(key)) {
        // Seconds vs milliseconds: anything below this threshold cannot be a plausible
        // millisecond timestamp, so it is seconds. Guessing wrong in the safe direction
        // (treating ms as ms) is what keeps a valid token from being called expired.
        out.expiresAt = value < 1e11 ? value * 1000 : value;
      }
    } else if (value && typeof value === "object") {
      searchToken(value, out, depth + 1);
    }
  }
}

/**
 * The bearer token from a credential document, or a reason naming what was found.
 *
 * `now` is injected so the expiry branch is testable without freezing the clock.
 */
export function resolveKimiToken(raw: string, now: number = Date.now()): { token: string } | KimiCodeUnavailable {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { reason: "no_credential", detail: "The Kimi Code credential file is not valid JSON." };
  }
  const found: TokenSearch = { keysSeen: [] };
  searchToken(parsed, found);
  if (!found.token) {
    // Name the keys, never the values — this string reaches a notification and a log.
    const seen = [...new Set(found.keysSeen)].sort().join(", ") || "(none)";
    return {
      reason: "no_credential",
      detail: `No bearer token found in the Kimi Code credential store. Fields present: ${seen}.`,
    };
  }
  if (found.expiresAt !== undefined && found.expiresAt - EXPIRY_SKEW_MS <= now) {
    // Kimi's access tokens last 15 minutes and are refreshed by Kimi Code ITSELF, on
    // disk, whenever it runs. So this is not "your account lapsed" — it is "nothing has
    // refreshed the file lately", and the remedy is to use Kimi Code once, not to
    // re-authenticate anything. Saying the wrong one sends the user to redo a login that
    // is perfectly valid.
    return {
      reason: "expired",
      detail: "The Kimi Code access token on disk has expired (they last 15 minutes). "
        + "Open Kimi Code once and it refreshes the file.",
    };
  }
  return { token: found.token };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** Credential filenames are read in sorted order so a multi-profile store is at least
 *  deterministic rather than dependent on directory iteration order. */
function credentialFiles(fs: KimiCodeFs, home: string): string[] {
  const dir = path.join(home, "credentials");
  if (!fs.existsSync(dir)) return [];
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith(".json"))
      .sort()
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

/**
 * Load the machine's Kimi Code install, or say why it is unusable.
 *
 * Never throws: a developer with no Kimi Code installed is the NORMAL case (the picker
 * simply shows no Kimi rows), so every filesystem failure degrades to a reason rather
 * than breaking the model list for everyone else.
 */
export function loadKimiCodeInstall(
  fs: KimiCodeFs,
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
  now: number = Date.now(),
): KimiCodeInstallResult {
  const home = resolveKimiCodeHome(env, homedir);
  const configPath = path.join(home, "config.toml");
  if (!fs.existsSync(configPath)) {
    return { reason: "no_install", detail: `No Kimi Code install found at ${home}.` };
  }

  let config: KimiCodeConfig;
  try {
    config = parseKimiCodeConfig(fs.readFileSync(configPath, "utf8"));
  } catch {
    return { reason: "no_install", detail: `Could not read ${configPath}.` };
  }
  if (!config.baseUrl) {
    return {
      reason: "no_endpoint",
      detail: "The Kimi Code config declares no base_url for the kimi-code provider.",
    };
  }

  const files = credentialFiles(fs, home);
  if (files.length === 0) {
    return {
      reason: "no_credential",
      detail: "Kimi Code is installed but not signed in — no credential file on disk.",
    };
  }

  // First file that yields a token wins; the last failure is what gets reported, so a
  // single-profile store (the overwhelmingly common case) reports ITS reason, not a
  // generic one.
  let lastFailure: KimiCodeUnavailable = {
    reason: "no_credential",
    detail: "Kimi Code is installed but no credential file could be read.",
  };
  for (const file of files) {
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const resolved = resolveKimiToken(raw, now);
    if ("token" in resolved) {
      return { home, baseUrl: config.baseUrl, token: resolved.token, models: config.models };
    }
    lastFailure = resolved;
  }
  return lastFailure;
}
