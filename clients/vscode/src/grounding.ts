import * as vscode from "vscode";

/** Single source of truth for the current workspace grounding summary, shared by the
 *  chat panels and the native chat participant (so none holds its own copy). */
let groundingSummary: string | undefined;
const emitter = new vscode.EventEmitter<void>();
export const onGroundingChange = emitter.event;

export function setGroundingSummary(summary: string | undefined): void {
  groundingSummary = summary;
  emitter.fire();
}

export function getGroundingSummary(): string | undefined {
  return groundingSummary;
}
