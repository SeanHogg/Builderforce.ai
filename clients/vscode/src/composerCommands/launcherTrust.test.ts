import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  l10n: { t: (message: string, ...args: unknown[]) => message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)])) },
}));

import { composerCommandText } from "./labels";
import { ensureLauncherTrust, type CaTrustCommand, type CaTrustDecision, type LauncherTrustDeps, type TrustAnswer } from "./launcherTrust";
import { FolderLaunchers } from "./folderLaunchers";
import { launchExecutor } from "./launch";
import { fakeWorkspacePort, folderRef } from "./testWorkspacePort";

const text = composerCommandText();
const CA = "/store/launcher-ca/ca.pem";
const WINDOWS: CaTrustCommand = { command: "certutil", args: ["-user", "-addstore", "Root", CA] };

function setup(options: { answer?: TrustAnswer; command?: CaTrustCommand; fingerprint?: string; isTrusted?: boolean } = {}) {
  let stored: CaTrustDecision | undefined;
  let fingerprint = options.fingerprint ?? "fp-1";
  const deps = {
    text,
    trustCommand: vi.fn(() => (options.command === undefined ? WINDOWS : options.command)),
    ...(options.isTrusted !== undefined ? { isTrusted: vi.fn(async () => options.isTrusted!) } : {}),
    platform: "win32" as NodeJS.Platform,
    fingerprint: vi.fn(async () => fingerprint),
    decision: { get: () => stored, set: async (decision: CaTrustDecision) => { stored = decision; } },
    ask: vi.fn(async (): Promise<TrustAnswer | undefined> => options.answer ?? "trust"),
    exec: vi.fn(async (_command: string, _args: readonly string[]) => undefined),
  } satisfies LauncherTrustDeps;
  return { deps, stored: () => stored, regenerate: (next: string) => { fingerprint = next; } };
}

describe("the launcher's certificate trust", () => {
  it("asks once per CA, runs the runtime's command as an argument array, and remembers it", async () => {
    const { deps, stored } = setup();
    expect(await ensureLauncherTrust(CA, deps)).toEqual({ lines: [text.trustDone], failed: false });
    expect(deps.trustCommand).toHaveBeenCalledWith(CA, "win32");
    expect(deps.exec).toHaveBeenCalledWith("certutil", ["-user", "-addstore", "Root", CA]);
    expect(stored()).toEqual({ fingerprint: "fp-1", trusted: true });
    expect(await ensureLauncherTrust(CA, deps)).toEqual({ lines: [], failed: false });
    expect(deps.ask).toHaveBeenCalledOnce();
  });

  it("asks again when the CA is regenerated, or on /launch trust", async () => {
    const { deps, regenerate } = setup();
    await ensureLauncherTrust(CA, deps);
    regenerate("fp-2");
    await ensureLauncherTrust(CA, deps);
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

  it("where the platform has no command (Linux), shows the instructions instead", async () => {
    const { deps } = setup({ command: { instructions: "Import ca.pem into your browser." } });
    deps.platform = "linux";
    expect(await ensureLauncherTrust(CA, deps)).toEqual({ lines: [text.trustManual(CA), "Import ca.pem into your browser."], failed: false });
    expect(deps.exec).not.toHaveBeenCalled();
  });

  it("reports a failed trust command", async () => {
    const { deps, stored } = setup();
    deps.exec.mockRejectedValueOnce(new Error("certutil exited with 2"));
    expect(await ensureLauncherTrust(CA, deps)).toEqual({ lines: [text.trustFailed("certutil exited with 2")], failed: true });
    expect(stored()?.trusted).toBe(false);
  });

  it("skips the question when the CA is already trusted", async () => {
    const { deps } = setup({ isTrusted: true });
    expect(await ensureLauncherTrust(CA, deps)).toEqual({ lines: [], failed: false });
    expect(deps.ask).not.toHaveBeenCalled();
  });

  it("does nothing for a launcher without TLS", async () => {
    const { deps } = setup();
    expect(await ensureLauncherTrust(undefined, deps)).toEqual({ lines: [], failed: false });
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
      start: async () => ({ url: "https://localhost:4000/#token=t", caCertPath: CA, close: async () => undefined }),
      openExternal: async () => { order.push("open"); },
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
});
