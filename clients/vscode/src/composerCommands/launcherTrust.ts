/**
 * Trusting the local launcher's certificate (PRD 31 §W11, "Local launch from the VSIX"):
 * the launcher serves HTTPS with a locally generated CA that is name-constrained to
 * loopback names. Before the first launch — and again whenever that CA changes
 * (regenerated) — the person is asked, in a MODAL, whether to add it to THEIR user
 * certificate store so the browser trusts the preview. Declined ⇒ the app still launches,
 * and the reply says the browser will warn. `/launch trust` runs the step again on demand.
 *
 * The commands come from the runtime: `caTrustCheckCommand(ca)` (exit 0 ⇒ already trusted,
 * no prompt; null ⇒ unknown, the recorded decision for this CA's fingerprint answers) and
 * `caTrustCommand(ca)` — Windows `certutil -user` (the OS shows its own confirmation), macOS
 * `security add-trusted-cert`, or manual instructions (Linux). Each command names its tool by
 * ABSOLUTE path and carries `cwd` (the CA store directory): the host runs it with `execFile`
 * in THAT directory, never through a shell and never with the workspace as cwd — a project's
 * own `certutil.exe` must never be what runs. The check runs hidden with a short timeout (hung ⇒
 * "could not check"); the trust command runs VISIBLE (certutil's confirmation dialog must show)
 * with a generous one (hung ⇒ a failed trust, worded `trustTimedOut`).
 */
import { createHash } from "node:crypto";
import type { LocalCa, TrustCommand, TrustPlan } from "@seanhogg/builderforce-webcontainers/launcher/server";
import type { ComposerCommandText } from "./labels";

/** The CA fields the trust step reads (`LocalLauncher.ca`, less its private key). */
export type LauncherCa = Pick<LocalCa, "certPem" | "certPath" | "derPath">;

/** The decision recorded per CA, by its fingerprint. */
export interface CaTrustDecision {
  fingerprint: string;
  trusted: boolean;
}

export type TrustAnswer = "trust" | "skip";

export interface LauncherTrustDeps {
  text: ComposerCommandText;
  /** The runtime's `caTrustCommand`. */
  plan: (ca: LauncherCa) => TrustPlan;
  /** The runtime's `caTrustCheckCommand`: exit 0 ⇒ already trusted; null ⇒ unknown. */
  checkCommand: (ca: LauncherCa) => TrustCommand | null;
  decision: { get(): CaTrustDecision | undefined; set(decision: CaTrustDecision): Promise<void> };
  /** The MODAL question. Undefined when dismissed (treated as "launch without trusting"). */
  ask: (message: string, trust: string, skip: string) => Promise<TrustAnswer | undefined>;
  /**
   * Run a command for a step (`trustCommandRunner`): `execFile(command.command, command.args,
   * trustExecOptions(command, step))`. Rejects on a non-zero exit (the error's `code` is the
   * exit code), when it cannot start, or with a {@link TrustCommandTimeoutError}.
   */
  exec: (command: TrustCommand, step: TrustStep) => Promise<void>;
  /**
   * A step that failed: a check that could not run or timed out (not a "no" — the recorded
   * decision answers), or a trust command that failed or timed out (the reply says so too).
   */
  report: (error: unknown, step: TrustStep) => void;
}

/** Which command runs: the silent "already trusted?" check, or the trust (add-to-store) command. */
export type TrustStep = "check" | "trust";

/** The check is silent and quick: a hung one is cut off and treated as "could not check". */
export const TRUST_CHECK_TIMEOUT_MS = 15_000;
/** The trust command waits on the person (the OS confirmation): generous, but never forever. */
export const TRUST_COMMAND_TIMEOUT_MS = 120_000;

/** A trust command killed at its step's timeout. */
export class TrustCommandTimeoutError extends Error {
  constructor(readonly step: TrustStep, readonly timeoutMs: number, readonly command: string) {
    super(`${command} did not finish within ${timeoutMs / 1000} s (${step})`);
    this.name = "TrustCommandTimeoutError";
  }
}

export interface TrustOutcome {
  /** What the reply adds (nothing when the CA is already trusted or there is no TLS). */
  lines: string[];
  /** The trust command failed: the reply is an error. */
  failed: boolean;
  /**
   * A browser will accept the launcher's certificate: it is trusted (or there is no TLS). False
   * when declined, left to manual steps, or failed — VS Code's integrated browser cannot click
   * through the warning, so the launch opens in the system browser.
   */
  trusted: boolean;
}

/** Nothing to say and nothing to stop a browser: a trusted CA, no TLS, or no trust step at all (`launch.ts`). */
export const NO_TRUST_STEP: Readonly<TrustOutcome> = Object.freeze({ lines: [], failed: false, trusted: true });
const untrusted = (lines: string[], failed = false): TrustOutcome => ({ lines, failed, trusted: false });

/** The `execFile` options a trust step runs with. */
export interface TrustExecOptions {
  cwd: string;
  shell: false;
  timeout: number;
  windowsHide?: true;
}

/** `promisify(execFile)`, as far as the trust step uses it. */
export type ExecFileAsync = (file: string, args: readonly string[], options: TrustExecOptions) => Promise<unknown>;

/**
 * The options per step. Both run IN the command's `cwd` (the CA store directory), never through
 * a shell. The check is hidden (`windowsHide`). The trust command is NOT: `certutil -addstore`
 * shows a Security Warning ("install this certificate?") and, hidden, waits forever for an
 * answer nobody can give.
 */
export function trustExecOptions(command: TrustCommand, step: TrustStep): TrustExecOptions {
  return step === "check"
    ? { cwd: command.cwd, shell: false, windowsHide: true, timeout: TRUST_CHECK_TIMEOUT_MS }
    : { cwd: command.cwd, shell: false, timeout: TRUST_COMMAND_TIMEOUT_MS };
}

/** An `execFile` rejection for a process it killed at its `timeout`. */
const killedAtTimeout = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { killed?: unknown }).killed === true;

/**
 * Run a runtime trust command: its absolute tool with its argument array, IN ITS `cwd` (the CA
 * store directory) — never through a shell, never with the workspace (or the extension host's own
 * cwd) as the directory a bare tool name could resolve from. A run cut off at its timeout rejects
 * with a {@link TrustCommandTimeoutError}.
 */
export function trustCommandRunner(execFileAsync: ExecFileAsync): (command: TrustCommand, step: TrustStep) => Promise<void> {
  return async (command, step) => {
    const options = trustExecOptions(command, step);
    try {
      await execFileAsync(command.command, [...command.args], options);
    } catch (error) {
      if (killedAtTimeout(error)) throw new TrustCommandTimeoutError(step, options.timeout, command.display);
      throw error;
    }
  };
}

/** The CA's fingerprint: the sha256 of its PEM file's text. A regenerated CA is asked about again. */
export function caFingerprint(ca: LauncherCa): string {
  return createHash("sha256").update(ca.certPem).digest("hex");
}

/** An `execFile` rejection for a process that ran and exited non-zero (its `code` is the exit code). */
const exitedNonZero = (error: unknown): boolean =>
  typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "number";

/** Ask the platform whether the CA is trusted: true / false, or undefined when it cannot say. */
async function checkTrusted(ca: LauncherCa, deps: LauncherTrustDeps): Promise<boolean | undefined> {
  const check = deps.checkCommand(ca);
  if (!check) return undefined;
  try {
    await deps.exec(check, "check");
    return true;
  } catch (error) {
    if (!(error instanceof TrustCommandTimeoutError) && exitedNonZero(error)) return false;
    // Could not check (it did not run, or hung past its timeout): reported, and the recorded decision answers.
    deps.report(error, "check");
    return undefined;
  }
}

/** Make sure the person was asked about this CA. `force` (`/launch trust`) asks again whatever was decided. */
export async function ensureLauncherTrust(ca: LauncherCa | null | undefined, deps: LauncherTrustDeps, force = false): Promise<TrustOutcome> {
  const { text } = deps;
  if (!ca) return NO_TRUST_STEP;
  const fingerprint = caFingerprint(ca);
  const trusted = await checkTrusted(ca, deps);
  if (trusted) {
    await deps.decision.set({ fingerprint, trusted: true });
    return NO_TRUST_STEP;
  }
  const previous = deps.decision.get();
  // A recorded "trusted" the platform now denies (removed from the store) is asked again.
  const stale = previous?.trusted === true && trusted === false;
  if (!force && !stale && previous?.fingerprint === fingerprint) {
    return previous.trusted ? NO_TRUST_STEP : untrusted([text.trustUntrusted]);
  }

  const answer = await deps.ask(text.trustQuestion, text.trustApprove, text.trustSkip);
  if (answer !== "trust") {
    await deps.decision.set({ fingerprint, trusted: false });
    return untrusted([text.trustUntrusted]);
  }
  const plan = deps.plan(ca);
  if (plan.kind === "manual") {
    await deps.decision.set({ fingerprint, trusted: false });
    return untrusted([text.trustManual(ca.certPath), plan.instructions]);
  }
  try {
    await deps.exec(plan.trust, "trust");
  } catch (error) {
    deps.report(error, "trust");
    await deps.decision.set({ fingerprint, trusted: false });
    const line = error instanceof TrustCommandTimeoutError
      ? text.trustTimedOut(Math.round(error.timeoutMs / 1000))
      : text.trustFailed(error instanceof Error ? error.message : String(error));
    return untrusted([line], true);
  }
  await deps.decision.set({ fingerprint, trusted: true });
  return { lines: [text.trustDone], failed: false, trusted: true };
}
