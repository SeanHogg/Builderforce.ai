import { describe, expect, it } from 'vitest';
import { escapeXml } from './html';

describe('escapeXml', () => {
  it('escapes the five metacharacters, with the XML spelling of the apostrophe', () => {
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });

  it('strips the control characters XML 1.0 forbids but keeps tab, LF and CR', () => {
    expect(escapeXml('a\u0000b\u0008c\u000Bd\u000Ce\u000Ef\u001Fg')).toBe('abcdefg');
    expect(escapeXml('a\tb\nc\rd')).toBe('a\tb\nc\rd');
  });
});
