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

import { loadCredential, type KimiCredentialFs, type KimiCredentialState } from "./kimiCodeCredentials";

/** The reads this module performs. Structurally the credential store's port, so ONE
 *  `node:fs` satisfies both and no caller assembles two filesystem objects. */
export type KimiCodeFs = KimiCredentialFs;

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
  /** Models the install declares, in file order (Kimi lists its default first). */
  models: readonly KimiCodeModel[];
  /** The stored credential's lifecycle at read time — `fresh` (send it) or `stale`
   *  (one refresh grant away). Never a raw token: see {@link loadKimiCodeInstall}. */
  credential: Extract<KimiCredentialState, { kind: "fresh" | "stale" }>;
}

/**
 * Why a local install could not be used. Carried rather than collapsed to null because
 * each reason sends the user somewhere different, and one of them ("the credential file
 * is a shape this reader does not know") must be able to say WHAT it saw — otherwise the
 * only symptom is a Kimi group silently missing from the model picker.
 */
export interface KimiCodeUnavailable {
  reason: "no_install" | "no_endpoint" | "no_credential" | "signed_out";
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
// Assembly
// ---------------------------------------------------------------------------

/**
 * Load the machine's Kimi Code install, or say why it is unusable.
 *
 * Reports the credential's LIFECYCLE rather than a token, because a token cannot be
 * produced synchronously: Kimi's access tokens last fifteen minutes, so the usable
 * answer routinely requires a refresh grant over the network. Callers that only need to
 * know whether to OFFER Kimi (the model picker) read the state; the one caller about to
 * make a request awaits `ensureFreshKimiToken`.
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

  const credential = loadCredential(fs, home, now);
  if (credential.kind === "revoked") {
    return { reason: "signed_out", detail: "You are signed out of Kimi Code. Sign in there to use it here." };
  }
  if (credential.kind === "unreadable") {
    return { reason: "no_credential", detail: credential.detail };
  }
  // `stale` is offered exactly like `fresh`: it is refreshable, and refusing to list a
  // model that one grant away is usable would put the user back to poking another app.
  return { home, baseUrl: config.baseUrl, models: config.models, credential };
}
