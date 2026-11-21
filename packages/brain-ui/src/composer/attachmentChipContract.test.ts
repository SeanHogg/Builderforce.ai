import { describe, expectTypeOf, it } from 'vitest';
import type { ComposerAttachmentChip } from '@seanhogg/builderforce-brain-embedded';
import type { ComposerAttachment } from './AttachmentChips';

/**
 * The conversation's chips (`useComposerAttachments().chips`, brain-embedded) are handed
 * straight to the composer (`ComposerAttachment`, here). Two declarations of one shape:
 * this holds them equal, so a field added on one side fails the typecheck, not a user.
 */
describe('the composer chip contract', () => {
  it('brain-embedded ComposerAttachmentChip is exactly brain-ui ComposerAttachment', () => {
    expectTypeOf<ComposerAttachmentChip>().toEqualTypeOf<ComposerAttachment>();
  });
});
