/**
 * Trusting the local launcher's certificate (PRD 31 §W11, "Local launch from the VSIX"):
 * the launcher serves HTTPS with a locally generated CA that is name-constrained to
 * loopback names. Before the first launch — and again whenever that CA file changes
 * (regenerated) — the person is asked, in a MODAL, whether to add it to THEIR user
 * certificate store so the browser trusts the preview. Declined ⇒ the app still launches,
 * and the reply says the browser will warn. `/launch trust` runs the step again on demand.
 *
 * The platform command comes from the runtime (`caTrustCommand`): Windows `certutil -user`
 * (the OS shows its own confirmation), macOS `security add-trusted-cert`; where there is no
 * command (Linux) the reply carries the instructions instead. It runs with an argument
 * array (`execFile`, never a shell string), and a failure is reported in the reply.
 */
import type { ComposerCommandText } from "./labels";

/** What `caTrustCommand` answers: a command to run, manual instructions, or nothing to run. */
export type CaTrustCommand = { command: string; args: string[] } | { instructions: string } | null;

/** The decision recorded per CA file, by its fingerprint. */
export interface CaTrustDecision {
  fingerprint: string;
  trusted: boolean;
}

export type TrustAnswer = "trust" | "skip";

export interface LauncherTrustDeps {
  text: ComposerCommandText;
  /** The runtime's `caTrustCommand`. Undefined ⇒ this launcher serves no TLS to trust: the step is skipped. */
  trustCommand?: (caCertPath: string, platform: NodeJS.Platform) => CaTrustCommand;
  /** The runtime's `isCaTrusted`, when it has one: already trusted ⇒ no prompt. */
  isTrusted?: (caCertPath: string) => boolean | Promise<boolean>;
  platform: NodeJS.Platform;
  /** A hash of the CA file, so a regenerated CA is asked about again. */
  fingerprint: (caCertPath: string) => Promise<string>;
  decision: { get(): CaTrustDecision | undefined; set(decision: CaTrustDecision): Promise<void> };
  /** The MODAL question. Undefined when dismissed (treated as "launch without trusting"). */
  ask: (message: string, trust: string, skip: string) => Promise<TrustAnswer | undefined>;
  /** Run a command with an argument array (`execFile`). Rejects on a non-zero exit. */
  exec: (command: string, args: readonly string[]) => Promise<void>;
}

export interface TrustOutcome {
  /** What the reply adds (nothing when the CA is already trusted or there is no TLS). */
  lines: string[];
  /** The trust command failed: the reply is an error. */
  failed: boolean;
}

const quiet: TrustOutcome = { lines: [], failed: false };

/** Make sure the person was asked about this CA. `force` (`/launch trust`) asks again whatever was decided. */
export async function ensureLauncherTrust(caCertPath: string | undefined, deps: LauncherTrustDeps, force = false): Promise<TrustOutcome> {
  const { text } = deps;
  if (!caCertPath || !deps.trustCommand) return quiet;
  const fingerprint = await deps.fingerprint(caCertPath);
  if (deps.isTrusted && (await deps.isTrusted(caCertPath))) {
    await deps.decision.set({ fingerprint, trusted: true });
    return quiet;
  }
  const previous = deps.decision.get();
  if (!force && previous?.fingerprint === fingerprint) {
    return previous.trusted ? quiet : { lines: [text.trustUntrusted], failed: false };
  }

  const answer = await deps.ask(text.trustQuestion, text.trustApprove, text.trustSkip);
  if (answer !== "trust") {
    await deps.decision.set({ fingerprint, trusted: false });
    return { lines: [text.trustUntrusted], failed: false };
  }
  const command = deps.trustCommand(caCertPath, deps.platform);
  if (!command || "instructions" in command) {
    await deps.decision.set({ fingerprint, trusted: false });
    return { lines: [text.trustManual(caCertPath), ...(command ? [command.instructions] : [])], failed: false };
  }
  try {
    await deps.exec(command.command, command.args);
  } catch (error) {
    await deps.decision.set({ fingerprint, trusted: false });
    return { lines: [text.trustFailed(error instanceof Error ? error.message : String(error))], failed: true };
  }
  await deps.decision.set({ fingerprint, trusted: true });
  return { lines: [text.trustDone], failed: false };
}
