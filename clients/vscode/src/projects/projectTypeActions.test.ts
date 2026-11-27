import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECT_TYPES, type ProjectTypeAction } from "@builderforce/ide-templates/project-types";

const executeCommand = vi.fn(async (..._args: unknown[]) => undefined);
const openExternal = vi.fn(async (_uri: unknown) => true);
const showQuickPick = vi.fn();
const showErrorMessage = vi.fn();

vi.mock("vscode", () => ({
  commands: { executeCommand: (...args: unknown[]) => executeCommand(...args) },
  env: { openExternal: (uri: unknown) => openExternal(uri) },
  window: { showQuickPick: (...args: unknown[]) => showQuickPick(...args), showErrorMessage: (...args: unknown[]) => showErrorMessage(...args) },
  Uri: { parse: (value: string) => ({ toString: () => value }) },
  l10n: { t: (message: string, ...args: unknown[]) => message.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)])) },
}));

import { runProjectTypeActions } from "./projectTypeActions";
import { PROJECT_TYPE_TEXT_KEYS } from "./projectTypeText";

const context = { projectId: 7, webBaseUrl: "https://app.example" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runProjectTypeActions", () => {
  it("runs a command action", async () => {
    await runProjectTypeActions([{ kind: "command", command: "builderforce.evermind.focus" }], context);
    expect(executeCommand).toHaveBeenCalledWith("builderforce.evermind.focus");
  });

  it("runs pickModel as the pickModel command, then openWeb with the project id filled in", async () => {
    executeCommand.mockResolvedValueOnce(true as never);
    await runProjectTypeActions([{ kind: "pickModel" }, { kind: "openWeb", path: "/studio/project/{projectId}" }], context);
    expect(executeCommand).toHaveBeenCalledWith("builderforce.pickModel");
    expect(openExternal.mock.calls[0]![0]!.toString()).toBe("https://app.example/studio/project/7");
  });

  it("stops the sequence when the model pick is dismissed", async () => {
    executeCommand.mockResolvedValueOnce(false as never);
    await runProjectTypeActions([{ kind: "pickModel" }, { kind: "openWeb", path: "/x" }], context);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("runs the option a choice picks, and nothing when it is dismissed", async () => {
    const choice: ProjectTypeAction = {
      kind: "choice",
      placeholderKey: "projectType.aiKnowledgePack.choice",
      options: [
        { kind: "command", command: "builderforce.createKnowledgePack", labelKey: "projectType.aiKnowledgePack.create" },
        { kind: "command", command: "builderforce.loadKnowledgePack", labelKey: "projectType.aiKnowledgePack.load" },
      ],
    };
    showQuickPick.mockImplementationOnce(async (items: { option: ProjectTypeAction }[]) => items[1]);
    await runProjectTypeActions([choice], context);
    expect(executeCommand).toHaveBeenCalledWith("builderforce.loadKnowledgePack");

    executeCommand.mockClear();
    showQuickPick.mockResolvedValueOnce(undefined);
    await runProjectTypeActions([choice, { kind: "openWeb", path: "/x" }], context);
    expect(executeCommand).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("reports a failing step once and stops", async () => {
    executeCommand.mockRejectedValueOnce(new Error("boom"));
    await runProjectTypeActions([{ kind: "command", command: "a.b" }, { kind: "openWeb", path: "/x" }], context);
    expect(showErrorMessage).toHaveBeenCalledTimes(1);
    expect(openExternal).not.toHaveBeenCalled();
  });
});

describe("the registry's wording", () => {
  it("has a localized string for every key the registry uses", () => {
    const keys = PROJECT_TYPES.flatMap((type) => [type.labelKey, type.descriptionKey, ...collectKeys(type.firstRun)]);
    for (const key of keys) expect(PROJECT_TYPE_TEXT_KEYS, key).toContain(key);
  });
});

function collectKeys(actions: readonly ProjectTypeAction[]): string[] {
  return actions.flatMap((a) => (a.kind === "choice" ? [a.placeholderKey, ...collectKeys(a.options)] : a.kind === "command" && a.labelKey ? [a.labelKey] : []));
}
