import * as vscode from "vscode";
/** Persisted (per-machine) id of the workspace the editor is acting as. */
export const SELECTED_TENANT_KEY = "builderforce.selectedTenantId";
const KEY = "builderforce.selectedProject";
let mem;
const emitter = new vscode.EventEmitter();
export const onProjectChange = emitter.event;
export function initProjectState(memento) {
    mem = memento;
}
export function getSelectedProject() {
    return mem?.get(KEY);
}
export function setSelectedProject(project) {
    void mem?.update(KEY, project);
    emitter.fire(project);
}
//# sourceMappingURL=projectState.js.map