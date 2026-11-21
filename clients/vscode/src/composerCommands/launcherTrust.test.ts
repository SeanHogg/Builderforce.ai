import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { TrustCommand, TrustPlan } from "@seanhogg/builderforce-webcontainers/launcher/server";

vi.mock("vscode", () => ({
  l10n: { t: (message: string, ...args: unknown[]) => message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)])) },
}));

import { composerCommandText } from "./labels";
import {
  caFingerprint,
  ensureLauncherTrust,
  TRUST_CHECK_TIMEOUT_MS,
  TRUST_COMMAND_TIMEOUT_MS,
  TrustCommandTimeoutError,
  trustCommandRunner,
  type CaTrustDecision,
  type LauncherCa,
  type LauncherTrustDeps,
  type TrustAnswer,
  type TrustExecOptions,
} from "./launcherTrust";
import { FolderLaunchers } from "./folderLaunchers";
import { launchExecutor } from "./launch";
import { fakeWorkspacePort, folderRef } from "./testWorkspacePort";

const text = composerCommandText();
/** The CA store directory — the ONLY cwd a trust command may run in (never the workspace). */
const CA_DIR = path.resolve("/store/launcher-ca");
const CERTUTIL = "C:\\Windows\\System32\\certutil.exe";
const caOf = (certPem: string): LauncherCa => ({ certPem, certPath: path.join(CA_DIR, "ca.pem"), derPath: path.join(CA_DIR, "ca.cer") });
const CA = caOf("-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n");

/** `caTrustCommand`'s real win32 shape: an absolute tool, an argument array, the CA store as cwd. */
const command = (args: string[]): TrustCommand => ({ command: CERTUTIL, args, cwd: CA_DIR, display: [CERTUTIL, ...args].join(" ") });
const ADD = command(["-user", "-addstore", "Root", CA.derPath]);
const CHECK = command(["-user", "-verifystore", "Root", "THUMB"]);
const WINDOWS: TrustPlan = { kind: "command", trust: ADD };

/** An `execFile` rejection for a process that ran and exited non-zero. */
const exitCode = (code: number) => Object.assign(new Error(`Command failed: exit ${code}`), { code });

interface SetupOptions {
  answer?: TrustAnswer;
  plan?: TrustPlan;
  /** `caTrustCheckCommand`'s answer: a command, or null (unknown on this platform). Default null. */
  check?: TrustCommand | null;
  /** What running the check does: resolve (exit 0 ⇒ trusted) or reject. Default: exit 1. */
  checkResult?: "trusted" | "untrusted" | "cannot-run" | "timed-out";
}

function setup(options: SetupOptions = {}) {
  let stored: CaTrustDecision | undefined;
  const checkResult = options.checkResult ?? "untrusted";
  const deps = {
    text,
    plan: vi.fn((_ca: LauncherCa) => options.plan ?? WINDOWS),
    checkCommand: vi.fn((_ca: LauncherCa) => (options.check === undefined ? null : options.check)),
    decision: { get: () => stored, set: async (decision: CaTrustDecision) => { stored = decision; } },
    ask: vi.fn(async (): Promise<TrustAnswer | undefined> => options.answer ?? "trust"),
    exec: vi.fn(async (run: TrustCommand, _step: "check" | "trust") => {
      if (run !== options.check) return;
      if (checkResult === "untrusted") throw exitCode(1);
      if (checkResult === "cannot-run") throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
      if (checkResult === "timed-out") throw new TrustCommandTimeoutError("check", TRUST_CHECK_TIMEOUT_MS, run.display);
    }),
    report: vi.fn(),
  } satisfies LauncherTrustDeps;
  return { deps, stored: () => stored, store: (decision: CaTrustDecision) => { stored = decision; } };
}

describe("the launcher's certificate trust", () => {
  it("asks once per CA, runs the runtime's command (absolute tool, CA store as cwd), and remembers it", async () => {
    const { deps, stored } = setup();
    expect(await ensureLauncherTrust(CA, deps)).toEqual({ lines: [text.trustDone], failed: false });
    expect(deps.plan).toHaveBeenCalledWith(CA);
    expect(deps.exec).toHaveBeenCalledWith(ADD, "trust");
    const ran = deps.exec.mock.calls[0]![0];
    expect(path.win32.isAbsolute(ran.command)).toBe(true);
    expect(ran.cwd).toBe(CA_DIR);
    expect(stored()).toEqual({ fingerprint: caFingerprint(CA), trusted: true });
    expect(await ensureLauncherTrust(CA, deps)).toEqual({ lines: [], failed: false });
    expect(deps.ask).toHaveBeenCalledOnce();
  });

  it("asks again when the CA is regenerated, or on /launch trust", async () => {
    const { deps } = setup();
    await ensureLauncherTrust(CA, deps);
    await ensureLauncherTrust(caOf("-----BEGIN CERTIFICATE-----\nBBBB\n-----END CERTIFICATE-----\n"), deps);
    await ensureLauncherTrust(CA, deps, true);
    expect(deps.ask).toHaveBeenCalledTimes(3);
  });

  it("declined: runs nothing and warns, on this launch and the next, without asking again", async () => {
    const { deps } = setup({ answer: "skip" });
    expect(await ensureLauncherTrust(CA, deps)).toEqual({ lines: [text.trustUntrusted], failed: false });
    expect(await ensureLauncherTrust(CA, deps)).toEqual({ lines: [text.trustUntrusted], failed: false });
    expect(deps.exec).not.toHaveBeenCalled();
    expect(deps.ask).toHaveBeenCalledOnce();
  });

  it("where the platform has no command (Linux), shows the instructions and the certificate path instead", async () => {
    const { deps } = setup({ plan: { kind: "manual", instructions: "Import ca.pem into your browser." } });
    expect(await ensureLauncherTrust(CA, deps)).toEqual({ lines: [text.trustManual(CA.certPath), "Import ca.pem into your browser."], failed: false });
    expect(deps.exec).not.toHaveBeenCalled();
  });

  it("reports a failed trust command", async () => {
    const { deps, stored } = setup();
    deps.exec.mockRejectedValueOnce(new Error("certutil exited with 2"));
    expect(await ensureLauncherTrust(CA, deps)).toEqual({ lines: [text.trustFailed("certutil exited with 2")], failed: true });
    expect(stored()?.trusted).toBe(false);
    expect(deps.report).toHaveBeenCalledWith(expect.objectContaining({ message: "certutil exited with 2" }), "trust");
  });

  it("a trust command that times out is reported and is a failed trust, worded as a timeout", async () => {
    const { deps, stored } = setup();
    const timeout = new TrustCommandTimeoutError("trust", TRUST_COMMAND_TIMEOUT_MS, ADD.display);
    deps.exec.mockRejectedValueOnce(timeout);
    expect(await ensureLauncherTrust(CA, deps)).toEqual({ lines: [text.trustTimedOut(120)], failed: true });
    expect(deps.report).toHaveBeenCalledWith(timeout, "trust");
    expect(stored()?.trusted).toBe(false);
  });

  it("a check that times out is reported as 'could not check', and the recorded decision answers", async () => {
    const { deps, store } = setup({ check: CHECK, checkResult: "timed-out" });
    store({ fingerprint: caFingerprint(CA), trusted: true });
    expect(await ensureLauncherTrust(CA, deps)).toEqual({ lines: [], failed: false });
    expect(deps.report).toHaveBeenCalledWith(expect.any(TrustCommandTimeoutError), "check");
    expect(deps.ask).not.toHaveBeenCalled();
  });

  it("skips the question when the platform check exits 0 (already trusted), running it in the CA store", async () => {
    const { deps, stored } = setup({ check: CHECK, checkResult: "trusted" });
    expect(await ensureLauncherTrust(CA, deps)).toEqual({ lines: [], failed: false });
    expect(deps.checkCommand).toHaveBeenCalledWith(CA);
    expect(deps.exec).toHaveBeenCalledWith(CHECK, "check");
    expect(deps.exec.mock.calls[0]![0].cwd).toBe(CA_DIR);
    expect(deps.ask).not.toHaveBeenCalled();
    expect(stored()).toEqual({ fingerprint: caFingerprint(CA), trusted: true });
  });

  it("asks again when the check says a CA recorded as trusted no longer is", async () => {
    const { deps, store } = setup({ check: CHECK, checkResult: "untrusted" });
    store({ fingerprint: caFingerprint(CA), trusted: true });
    await ensureLauncherTrust(CA, deps);
    expect(deps.ask).toHaveBeenCalledOnce();
  });

  it("a check that cannot run is reported, and the recorded decision answers", async () => {
    const { deps, store } = setup({ check: CHECK, checkResult: "cannot-run" });
    store({ fingerprint: caFingerprint(CA), trusted: true });
    expect(await ensureLauncherTrust(CA, deps)).toEqual({ lines: [], failed: false });
    expect(deps.report).toHaveBeenCalledOnce();
    expect(deps.report).toHaveBeenCalledWith(expect.objectContaining({ code: "ENOENT" }), "check");
    expect(deps.ask).not.toHaveBeenCalled();
  });

  it("runs the check HIDDEN with a 15 s timeout, and the trust command VISIBLE with a 120 s timeout — in the CA store, by absolute path, with no shell", async () => {
    const execFileAsync = vi.fn(async (_file: string, _args: readonly string[], _options: TrustExecOptions) => ({ stdout: "", stderr: "" }));
    const run = trustCommandRunner(execFileAsync);
    await run(CHECK, "check");
    await run(ADD, "trust");
    expect(path.win32.isAbsolute(CERTUTIL)).toBe(true);
    expect(execFileAsync).toHaveBeenNthCalledWith(1, CERTUTIL, CHECK.args, { cwd: CA_DIR, shell: false, windowsHide: true, timeout: 15_000 });
    // No `windowsHide`: certutil's "install this certificate?" Security Warning must be visible, or certutil blocks forever.
    expect(execFileAsync).toHaveBeenNthCalledWith(2, CERTUTIL, ADD.args, { cwd: CA_DIR, shell: false, timeout: 120_000 });
    expect(execFileAsync.mock.calls[1]![2]).not.toHaveProperty("windowsHide");
  });

  it("turns a run killed at its timeout into a TrustCommandTimeoutError, and passes other failures through", async () => {
    const killed = Object.assign(new Error("Command failed"), { killed: true, signal: "SIGTERM", code: null });
    const run = trustCommandRunner(vi.fn(async () => { throw killed; }));
    await expect(run(ADD, "trust")).rejects.toMatchObject({ name: "TrustCommandTimeoutError", step: "trust", timeoutMs: TRUST_COMMAND_TIMEOUT_MS });
    await expect(run(CHECK, "check")).rejects.toMatchObject({ name: "TrustCommandTimeoutError", step: "check", timeoutMs: TRUST_CHECK_TIMEOUT_MS });
    const exited = exitCode(1);
    await expect(trustCommandRunner(vi.fn(async () => { throw exited; }))(CHECK, "check")).rejects.toBe(exited);
  });

  it("does nothing for a launcher without TLS", async () => {
    const { deps } = setup();
    expect(await ensureLauncherTrust(null, deps)).toEqual({ lines: [], failed: false });
    expect(deps.ask).not.toHaveBeenCalled();
  });
});

describe("/launch with the trust step", () => {
  const app = folderRef("app");

  function launchSetup(trust: { lines: string[]; failed: boolean }) {
    const order: string[] = [];
    const port = fakeWorkspacePort([app], { [path.join(app.path, "builderforce.json")]: "{}" });
    const trustStep = vi.fn(async () => { order.push("trust"); return trust; });
    const execute = launchExecutor({
      port,
      text,
      launchers: new FolderLaunchers(),
      // `createLocalLauncher`'s shape: the url, and the CA it serves from.
      start: async () => ({ url: "https://localhost:4000/#token=t", ca: CA, close: async () => undefined }),
      openInEditor: async () => { order.push("open"); },
      openExternal: async () => { order.push("open-external"); },
      readFiles: async () => new Map(),
      detect: () => ({ text: "{}", services: [], resources: [], notes: [] }),
      trust: trustStep,
    });
    return { execute, trustStep, order };
  }

  it("asks about the certificate before the browser opens, and still launches when declined", async () => {
    const { execute, trustStep, order } = launchSetup({ lines: [text.trustUntrusted], failed: false });
    const reply = await execute({});
    expect(trustStep).toHaveBeenCalledWith(CA, false);
    expect(order).toEqual(["trust", "open"]);
    expect(reply).toMatchObject({ kind: "text", tone: "info", link: "https://localhost:4000/#token=t" });
    expect(reply.kind === "text" ? reply.lines : []).toContain(text.trustUntrusted);
  });

  it("/launch trust asks again; a failure makes the reply an error", async () => {
    const { execute, trustStep } = launchSetup({ lines: [text.trustFailed("denied")], failed: true });
    const reply = await execute({ environment: "trust" });
    expect(trustStep).toHaveBeenCalledWith(CA, true);
    expect(reply).toMatchObject({ kind: "text", tone: "error" });
  });

  it("/launch external asks about the certificate before the system browser opens", async () => {
    const { execute, trustStep, order } = launchSetup({ lines: [], failed: false });
    await execute({ environment: "external" });
    expect(trustStep).toHaveBeenCalledWith(CA, false);
    expect(order).toEqual(["trust", "open-external"]);
  });
});
