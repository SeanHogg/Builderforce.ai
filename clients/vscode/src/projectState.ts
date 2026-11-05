import * as vscode from "vscode";

export interface SelectedProject {
  id: number;
  name: string;
}

/** Persisted (per-machine) id of the workspace the editor is acting as. */
export const SELECTED_TENANT_KEY = "builderforce.selectedTenantId";

const KEY = "builderforce.selectedProject";
let mem: vscode.Memento | undefined;
const emitter = new vscode.EventEmitter<SelectedProject | undefined>();
export const onProjectChange = emitter.event;

export function initProjectState(memento: vscode.Memento): void {
  mem = memento;
}

export function getSelectedProject(): SelectedProject | undefined {
  return mem?.get<SelectedProject>(KEY);
}

export function setSelectedProject(project: SelectedProject | undefined): void {
  void mem?.update(KEY, project);
  emitter.fire(project);
}
