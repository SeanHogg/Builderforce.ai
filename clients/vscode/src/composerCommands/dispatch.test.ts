import { describe, expect, it, vi } from "vitest";
import { createComposerCommandRegistry } from "@seanhogg/builderforce-brain-embedded/composerCommands";

vi.mock("vscode", () => ({
  l10n: { t: (message: string, ...args: unknown[]) => message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)])) },
}));

import { handleComposerInput, type ComposerCommandExecutor } from "./dispatch";
import { buildComposerCommands } from "./entries";
import { composerCommandText } from "./labels";
import type { ComposerReply } from "./reply";
import { WriteRefusedError } from "./writeContainment";

const done: ComposerReply = { kind: "text", tone: "info", lines: ["done"] };

function setup(hasWorkspace = true) {
  const text = composerCommandText();
  const registry = createComposerCommandRegistry(
    buildComposerCommands({ hasWorkspace, noWorkspaceReason: text.noWorkspace, stopLabel: text.launchStopChoice, trustLabel: text.launchTrustChoice, externalLabel: text.launchExternalChoice, manifestMoveLabel: text.manifestMoveChoice }),
    text,
  );
  const executors = {
    "starter-kit": vi.fn<ComposerCommandExecutor>(async () => done),
    manifest: vi.fn<ComposerCommandExecutor>(async () => done),
    launch: vi.fn<ComposerCommandExecutor>(async () => done),
  };
  const ranAny = () => Object.values(executors).some((executor) => executor.mock.calls.length > 0);
  return { deps: { registry, text, executors }, executors, ranAny };
}

describe("handleComposerInput", () => {
  it("leaves an ordinary message to the chat", async () => {
    const { deps, ranAny } = setup();
    expect(await handleComposerInput("make the button blue", deps)).toEqual({ handled: false });
    expect(ranAny()).toBe(false);
  });

  it("treats a path-like line (`/api/users returns 500`) as a normal message", async () => {
    const { deps, ranAny } = setup();
    expect(await handleComposerInput("/api/users returns 500", deps)).toEqual({ handled: false });
    expect(ranAny()).toBe(false);
  });

  it("sends an escaped `//…` line with one slash removed", async () => {
    const { deps } = setup();
    expect(await handleComposerInput("//help me", deps)).toEqual({ handled: false, text: "/help me" });
  });

  it("answers /help from the registry, listing every command, without running anything", async () => {
    const { deps, ranAny } = setup();
    const result = await handleComposerInput("/help", deps);
    expect(result.handled && result.reply.kind === "help" ? result.reply.help.entries.map((entry) => entry.id) : null)
      .toEqual(["help", "starter-kit", "manifest", "launch"]);
    expect(ranAny()).toBe(false);
  });

  it("words a write the containment check refused at write time, naming the path", async () => {
    const { deps, executors } = setup();
    executors.manifest.mockRejectedValueOnce(new WriteRefusedError([{ file: "/work/app/builderforce.json", reason: "symlink" }]));
    expect(await handleComposerInput("/manifest init", deps)).toEqual({
      handled: true,
      reply: { kind: "text", tone: "error", lines: [deps.text.writeRefused(["/work/app/builderforce.json"])] },
    });
  });

  it("answers /help <command> with that command alone", async () => {
    const { deps } = setup();
    const result = await handleComposerInput("/help launch", deps);
    expect(result.handled && result.reply.kind === "help" ? result.reply.help.entries.map((entry) => entry.id) : null).toEqual(["launch"]);
  });

  it("answers an unknown command with 'no such command' and the full list, never the model", async () => {
    const { deps, ranAny } = setup();
    const result = await handleComposerInput("/deploy prod", deps);
    expect(result).toMatchObject({ handled: true, reply: { kind: "help", help: { unknown: "deploy" } } });
    expect(ranAny()).toBe(false);
  });

  it("answers a command that does not parse with its problems and its own help", async () => {
    const { deps, ranAny } = setup();
    const result = await handleComposerInput("/starter-kit", deps);
    expect(result).toMatchObject({ handled: true, reply: { kind: "help", lines: ["/starter-kit was not run:", "Missing <kit>"] } });
    expect(result.handled && result.reply.kind === "help" ? result.reply.help.entries.map((entry) => entry.id) : null).toEqual(["starter-kit"]);
    expect(ranAny()).toBe(false);
  });

  it("answers an unavailable command with its reason", async () => {
    const { deps, ranAny } = setup(false);
    const result = await handleComposerInput("/launch", deps);
    expect(result).toMatchObject({ handled: true, reply: { kind: "text", tone: "error" } });
    expect(result.handled && result.reply.kind === "text" ? result.reply.lines[0] : "").toContain("Open a folder first");
    expect(ranAny()).toBe(false);
  });

  it("runs a parsed command with its canonical arguments", async () => {
    const { deps, executors } = setup();
    expect(await handleComposerInput("/starter-kit React-Node --with postgres", deps)).toEqual({ handled: true, reply: done });
    expect(executors["starter-kit"]).toHaveBeenCalledWith({ kit: "react-node", with: ["postgres"] });
  });

  it("reports an executor's failure in the reply", async () => {
    const { deps, executors } = setup();
    executors.launch.mockRejectedValueOnce(new Error("port in use"));
    expect(await handleComposerInput("/launch", deps)).toEqual({
      handled: true,
      reply: { kind: "text", tone: "error", lines: ["/launch failed: port in use"] },
    });
  });
});
