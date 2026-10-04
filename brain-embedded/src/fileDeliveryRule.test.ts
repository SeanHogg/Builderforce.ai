/**
 * Builder personas deliver code by WRITING it.
 *
 * They used to tell the model to "use a normal code block so the user can apply
 * it", and the mobile personas offered code blocks as the only way to deliver a
 * file — so a build whose writes were failing ended with the agent handing the
 * user CSS to paste beside a live Preview. These pin the replacement.
 */
import { describe, it, expect } from 'vitest';
import { FILE_DELIVERY_RULE, MODALITY_PERSONAS, type PersonaModalityId } from './brainPersona';

const BUILDERS: PersonaModalityId[] = ['designer', 'mobile', 'webmobile'];

describe('builder personas and the file-delivery rule', () => {
  it.each(BUILDERS)('%s carries the shared rule', (id) => {
    expect(MODALITY_PERSONAS[id].prompt).toContain(FILE_DELIVERY_RULE);
  });

  it.each(BUILDERS)('%s no longer invites the user to apply code by hand', (id) => {
    const prompt = MODALITY_PERSONAS[id].prompt;
    expect(prompt).not.toMatch(/so the user can (apply|create)/i);
    expect(prompt).not.toMatch(/use a (normal )?code block/i);
  });

  it('forbids handing code over, and keeps a code-block fallback only for a surface with no file tools', () => {
    expect(FILE_DELIVERY_RULE).toMatch(/NEVER hand the user code/);
    expect(FILE_DELIVERY_RULE).toMatch(/Only if you have NO tool that writes files/);
  });

  it('names no tool — the hosts advertise different ones (the prompt tool-name contract)', () => {
    expect(FILE_DELIVERY_RULE).not.toMatch(/\b(create_file|write_file|canvas_\w+|builtin_\w+)\b/);
    expect(MODALITY_PERSONAS.designer.prompt).not.toMatch(/`create_file`/);
  });

  it('leaves the non-builder personas alone', () => {
    for (const id of ['evermind', 'finetune', 'voice'] as const) {
      expect(MODALITY_PERSONAS[id].prompt).not.toContain(FILE_DELIVERY_RULE);
    }
  });
});
