import * as vscode from "vscode";

/** The selected model, shared across all chat panels (single source of truth). */
let selected: string | undefined;
const emitter = new vscode.EventEmitter<string | undefined>();
export const onModelChange = emitter.event;

export function getSelectedModel(): string | undefined {
  if (selected) return selected;
  return vscode.workspace.getConfiguration("builderforce").get<string>("defaultModel") || undefined;
}

export function setSelectedModel(model: string | undefined): void {
  selected = model;
  emitter.fire(model);
}
