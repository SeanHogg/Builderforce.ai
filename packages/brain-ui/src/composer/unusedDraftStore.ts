import { createComposerDraftStore } from '@seanhogg/builderforce-brain-embedded';
import type { ComposerDraftStore } from '@seanhogg/builderforce-brain-embedded';

/**
 * The ONE stand-in draft store for a host that controls the text itself.
 *
 * `useDraftText` / `useDraftIsEmpty` / `useDraftSelector` cannot be skipped, so a
 * component that receives its text as a controlled `value`/`onChange` pair still
 * needs A store to subscribe to. It is never written — only read while the host
 * owns the text. Shared by `ComposerTextBox`, `BrainComposer` and
 * `useRecipientChoice`; one module-level instance keeps their behaviour identical.
 */
export const UNUSED_STORE: ComposerDraftStore = createComposerDraftStore();
