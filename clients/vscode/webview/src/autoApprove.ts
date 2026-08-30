import { localStorageConfirmationPersistence } from '@seanhogg/builderforce-brain-embedded';
import { readStored, writeStored } from './storage';

/**
 * The editor's human-in-the-loop gate, reconciled with the setting that seeds it.
 *
 * Two things are true at once: `builderforce.permissionMode` is the user's standing
 * instruction, and the panel's Auto-mode switch is a live override of it that should
 * survive a reload. The panel used to store only the override — and to default it off in
 * its own code, never reading the setting at all — so switching the setting to
 * `acceptEdits` moved the `@builderforce` participant and left the panel still asking.
 * One product question, two answers, which is the same failure the model-routing seam
 * exists to prevent.
 *
 * The rule: the stored override wins UNTIL the setting itself changes, which is a
 * deliberate act and therefore the newer instruction. Changing the setting moves the
 * panel even if the switch was flipped by hand long ago; flipping the switch still
 * sticks across reloads until the setting next moves.
 */
const AUTO_APPROVE_KEY = 'bf_brain_auto_approve';

/** The setting value this panel last reconciled against — how a change is detected. */
const AUTO_APPROVE_SETTING_SEEN_KEY = 'bf_brain_auto_approve_setting';

/**
 * The stored override. Its key is this surface's own: the editor's gate is deliberately
 * independent of the web app's, since a mutating tool here touches the user's real
 * working tree.
 */
const OVERRIDE = localStorageConfirmationPersistence(AUTO_APPROVE_KEY);

export interface ConfirmationPersistence {
  read(): boolean | undefined;
  write(on: boolean): void;
}

export function autoApprovePersistence(settingOn: boolean): ConfirmationPersistence {
  const mark = settingOn ? '1' : '0';
  return {
    read() {
      if (readStored(AUTO_APPROVE_SETTING_SEEN_KEY) !== mark) {
        // The setting moved since this panel last looked. Adopt it, and record that we
        // did so the adoption happens once rather than on every read — otherwise a
        // hand-flipped switch would be reverted on the next render.
        writeStored(AUTO_APPROVE_SETTING_SEEN_KEY, mark);
        OVERRIDE.write(settingOn);
        return settingOn;
      }
      return OVERRIDE.read();
    },
    write(on) {
      writeStored(AUTO_APPROVE_SETTING_SEEN_KEY, mark);
      OVERRIDE.write(on);
    },
  };
}
