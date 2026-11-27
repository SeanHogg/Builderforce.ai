import { beforeEach, describe, expect, it, vi } from "vitest";

const showInputBox = vi.fn();
const showInformationMessage = vi.fn();
const showErrorMessage = vi.fn();
const executeCommand = vi.fn();
const createProject = vi.fn();
const handlePlanLimit = vi.fn(async (_message: string) => undefined);
const setSelectedProject = vi.fn();

vi.mock("vscode", () => ({
  window: {
    showInputBox: (...a: unknown[]) => showInputBox(...a),
    showInformationMessage: (...a: unknown[]) => showInformationMessage(...a),
    showErrorMessage: (...a: unknown[]) => showErrorMessage(...a),
  },
  commands: { executeCommand: (...a: unknown[]) => executeCommand(...a) },
  l10n: { t: (message: string, ...args: unknown[]) => message.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)])) },
}));
vi.mock("../bfApi", () => ({ createProject: (...a: unknown[]) => createProject(...a), invalidateTasks: vi.fn() }));
vi.mock("../project/projectNames", () => ({ invalidateProjectNames: vi.fn() }));
vi.mock("../project/projectState", () => ({ setSelectedProject: (...a: unknown[]) => setSelectedProject(...a) }));
vi.mock("./planLimit", () => ({ handlePlanLimit: (message: string) => handlePlanLimit(message) }));

import { createProjectInteractive } from "./createProjectInteractive";

const context = { secrets: {} } as never;

beforeEach(() => vi.clearAllMocks());

describe("createProjectInteractive", () => {
  it("creates with the modality, selects the project and says so", async () => {
    showInputBox.mockResolvedValue("  Demo ");
    createProject.mockResolvedValue({ id: 9, name: "Demo" });
    const project = await createProjectInteractive(context, { modality: "evermind" });
    expect(createProject).toHaveBeenCalledWith(context.secrets, "Demo", "evermind");
    expect(setSelectedProject).toHaveBeenCalledWith({ id: 9, name: "Demo" });
    expect(showInformationMessage).toHaveBeenCalled();
    expect(project).toEqual({ id: 9, name: "Demo" });
  });

  it("does nothing when the name prompt is dismissed", async () => {
    showInputBox.mockResolvedValue(undefined);
    expect(await createProjectInteractive(context)).toBeUndefined();
    expect(createProject).not.toHaveBeenCalled();
  });

  it("routes a 402 to the plan-limit upgrade prompt, not a plain error", async () => {
    showInputBox.mockResolvedValue("Demo");
    createProject.mockRejectedValue(new Error("HTTP 402: limit"));
    expect(await createProjectInteractive(context)).toBeUndefined();
    expect(handlePlanLimit).toHaveBeenCalledTimes(1);
    expect(showErrorMessage).not.toHaveBeenCalled();
    expect(setSelectedProject).not.toHaveBeenCalled();
  });

  it("shows any other failure", async () => {
    showInputBox.mockResolvedValue("Demo");
    createProject.mockRejectedValue(new Error("HTTP 500"));
    await createProjectInteractive(context);
    expect(showErrorMessage).toHaveBeenCalledTimes(1);
    expect(handlePlanLimit).not.toHaveBeenCalled();
  });
});
