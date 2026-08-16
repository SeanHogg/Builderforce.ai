/**
 * What pressing a starting point DOES — the client half of the extension point.
 *
 * The server has an output-kind registry that decides what INSTALLING a template
 * writes. This is its counterpart for the surfaces that are purely client-side:
 * seeding the composer, and placing a pack of objects on the board. Selecting an
 * entry dispatches on `entry.action.kind` in exactly one place, so a surface
 * never has to know which of the four catalogues an entry came from.
 *
 * A surface declares only what it CAN do. The landing hero can seed a prompt and
 * nothing else — it has no board and no workspace — so it passes one handler and
 * `applyTemplateEntry` reports the entries it cannot run rather than silently
 * doing nothing when somebody presses one.
 */

import type { CreationTemplate } from '@/components/creation-canvas/creationTemplates';
import type { TemplateEntry } from './contract';

export interface TemplateApplyHandlers {
  /** Put text in the composer. Every surface with a prompt bar has this. */
  onPrompt?: (prompt: string, entry: TemplateEntry) => void;
  /** Place a pack of objects. Canvas surfaces only. */
  onPack?: (template: CreationTemplate, entry: TemplateEntry) => void;
  /** Open the guided setup. Surfaces inside a workspace only. */
  onInstall?: (templateKey: string, entry: TemplateEntry) => void;
}

/**
 * Run an entry against what this surface can do.
 *
 * Returns false when the surface cannot run the entry, so the caller can fall
 * back — the canvas falls back from `install` to navigating to the templates
 * gallery rather than leaving a press with no effect, which is the failure this
 * return value exists to make impossible to ignore.
 */
export function applyTemplateEntry(entry: TemplateEntry, handlers: TemplateApplyHandlers): boolean {
  switch (entry.action.kind) {
    case 'prompt':
      if (!handlers.onPrompt) return false;
      handlers.onPrompt(entry.action.prompt, entry);
      return true;
    case 'pack':
      if (!handlers.onPack) return false;
      handlers.onPack(entry.action.template, entry);
      return true;
    case 'install':
      if (!handlers.onInstall) return false;
      handlers.onInstall(entry.action.templateKey, entry);
      return true;
    default:
      return false;
  }
}
