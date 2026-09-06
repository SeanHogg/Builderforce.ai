import { describe, expect, it } from 'vitest';
import { extractJsonObject, extractJsonPayload } from './json';

describe('extractJsonPayload — the one model-output reader', () => {
  it('parses a bare JSON document (the strict response_format happy path)', () => {
    expect(extractJsonPayload('{"a":1}')).toEqual({ a: 1 });
    expect(extractJsonPayload('[1,2]')).toEqual([1, 2]);
  });

  it('strips every fence flavour the six private helpers disagreed on', () => {
    for (const lang of ['', 'json', 'ts', 'typescript', 'JSON', 'javascript']) {
      expect(extractJsonPayload(`Here:\n\`\`\`${lang}\n{"lang":"${lang}"}\n\`\`\`\nDone.`)).toEqual({ lang });
    }
  });

  it('slices the outermost object or array out of surrounding prose', () => {
    expect(extractJsonPayload('Sure! {"x": {"y": 2}} — hope that helps')).toEqual({ x: { y: 2 } });
    expect(extractJsonPayload('Result: [{"id":1},{"id":2}].')).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('returns null — never throws — for empty, prose-only and broken replies', () => {
    expect(extractJsonPayload('')).toBeNull();
    expect(extractJsonPayload('   ')).toBeNull();
    expect(extractJsonPayload('I cannot help with that.')).toBeNull();
    expect(extractJsonPayload('{"a": }')).toBeNull();
    expect(extractJsonPayload('```json\n```')).toBeNull();
  });

  it('extractJsonObject refuses arrays and scalars', () => {
    expect(extractJsonObject('[1]')).toBeNull();
    expect(extractJsonObject('42')).toBeNull();
    expect(extractJsonObject('{"ok":true}')).toEqual({ ok: true });
  });
});
