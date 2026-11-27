import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const showWarningMessage = vi.fn();
const showQuickPick = vi.fn();
const createProjectInteractive = vi.fn();
const runProjectTypeActions = vi.fn();
const files = new Map<string, string>();
const folder = { name: "app", path: path.join("work", "app") };
const file = path.join(folder.path, ".builderforce", "project.json");

vi.mock("vscode", () => ({
  window: {
    showWarningMessage: (...a: unknown[]) => showWarningMessage(...a),
    showQuickPick: (...a: unknown[]) => showQuickPick(...a),
    showErrorMessage: vi.fn(),
  },
  l10n: { t: (message: string, ...args: unknown[]) => message.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)])) },
}));
vi.mock("../gateway/gateway", () => ({ getWebBaseUrl: () => "https://app.example" }));
vi.mock("../composerCommands/vscodeWorkspacePort", () => ({
  vscodeWorkspacePort: () => ({
    folders: () => [folder],
    readText: async (f: string) => files.get(f),
    writeText: async (f: string, text: string) => void files.set(f, text),
  }),
}));
vi.mock("../composerCommands/workspacePort", async (importActual) => ({
  ...(await importActual<typeof import("../composerCommands/workspacePort")>()),
  chooseFolder: async () => folder,
}));
vi.mock("./createProjectInteractive", () => ({ createProjectInteractive: (...a: unknown[]) => createProjectInteractive(...a) }));
vi.mock("./projectTypeActions", () => ({ runProjectTypeActions: (...a: unknown[]) => runProjectTypeActions(...a) }));

import { newAiProject } from "./newAiProject";

const context = {} as never;
const signedIn = async () => true;

beforeEach(() => {
  vi.clearAllMocks();
  files.clear();
  createProjectInteractive.mockResolvedValue({ id: 5, name: "Demo" });
});

describe("newAiProject", () => {
  it("falls back to the picker for an unknown type id", async () => {
    showQuickPick.mockResolvedValue(undefined);
    await newAiProject(context, signedIn, "nope");
    expect(showQuickPick).toHaveBeenCalledTimes(1);
    expect(createProjectInteractive).not.toHaveBeenCalled();
  });

  it("creates nothing when the existing link file is unreadable", async () => {
    files.set(file, "{ broken");
    await newAiProject(context, signedIn, "ai-scratch");
    expect(showWarningMessage).toHaveBeenCalledTimes(1);
    expect(createProjectInteractive).not.toHaveBeenCalled();
    expect(files.get(file)).toBe("{ broken");
  });

  it("creates nothing when the person cancels the re-bind, and shows a hand-edited non-numeric id", async () => {
    files.set(file, JSON.stringify({ projectId: "abc" }));
    showWarningMessage.mockResolvedValueOnce(undefined);
    await newAiProject(context, signedIn, "ai-scratch");
    expect(showWarningMessage.mock.calls[0]![0]).toContain("abc");
    expect(createProjectInteractive).not.toHaveBeenCalled();
  });

  it("replaces the confirmed link, and warns when it changed in the meantime", async () => {
    files.set(file, JSON.stringify({ version: 1, projectId: 3, projectType: "ai-existing" }));
    showWarningMessage.mockResolvedValueOnce("Replace");
    await newAiProject(context, signedIn, "ai-scratch");
    expect(JSON.parse(files.get(file)!)).toMatchObject({ projectId: 5, projectType: "ai-scratch" });
    expect(runProjectTypeActions).toHaveBeenCalledTimes(1);

    files.set(file, JSON.stringify({ version: 1, projectId: 3, projectType: "ai-existing" }));
    showWarningMessage.mockReset();
    showWarningMessage.mockImplementationOnce(async () => {
      files.set(file, JSON.stringify({ version: 1, projectId: 77, projectType: "ai-existing" })); // changes while the modal is open
      return "Replace";
    });
    await newAiProject(context, signedIn, "ai-scratch");
    expect(JSON.parse(files.get(file)!)).toMatchObject({ projectId: 77 });
    expect(showWarningMessage).toHaveBeenCalledTimes(2);
  });
});
