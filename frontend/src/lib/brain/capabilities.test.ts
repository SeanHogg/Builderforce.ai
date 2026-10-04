import { describe, it, expect } from 'vitest';
import { FILE_DELIVERY_RULE } from '@seanhogg/builderforce-brain-embedded';
import { capabilitiesForSurface } from './capabilities';

/**
 * The build capabilities sit beside a file tree and the tools that write to it,
 * yet all five told the model to answer in path-tagged code blocks. They now carry
 * the builder personas' file-delivery rule; the authored (Brain Storm) ones, which
 * have no file tree, do not.
 */
describe('capability prompts and file delivery', () => {
  it.each(capabilitiesForSurface('build').map((c) => [c.id, c] as const))('%s carries the file-delivery rule', (_id, capability) => {
    expect(capability.systemPrompt).toContain(FILE_DELIVERY_RULE);
  });

  it.each(capabilitiesForSurface('build').map((c) => [c.id, c] as const))('%s no longer asks for path-tagged code blocks', (_id, capability) => {
    const ownText = capability.systemPrompt.replace(FILE_DELIVERY_RULE, '');
    expect(ownText).not.toMatch(/path-tagged|code block whose language tag/i);
  });

  it('leaves the Brain Storm capabilities without it', () => {
    for (const capability of capabilitiesForSurface('brainstorm')) {
      expect(capability.systemPrompt).not.toContain(FILE_DELIVERY_RULE);
    }
  });
});
