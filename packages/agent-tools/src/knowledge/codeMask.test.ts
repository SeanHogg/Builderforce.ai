import { describe, expect, it } from 'vitest';
import { codeLanguageOf, maskSource } from './codeMask.js';

describe('maskSource', () => {
  it('keeps length and line breaks, blanking comments in both copies and strings only in `bare`', () => {
    const text = "const s = 'if (a)'; // if (b)\n/* for */ x();\n";
    const { code, bare } = maskSource(text, 'js');
    const noComments = text.replace('// if (b)', ' '.repeat(9)).replace('/* for */', ' '.repeat(9));
    expect(code).toBe(noComments);
    expect(bare).toBe(noComments.replace('if (a)', ' '.repeat(6)));
  });

  it('does not open a string or a comment inside a regex literal', () => {
    const text = "const r = /[`'\"]/g; const q = /\\/*x/; if (a) {}\nafter();";
    const { bare } = maskSource(text, 'js');
    expect(bare).toContain('if (a) {}');
    expect(bare).toContain('after();');
  });

  it('keeps a division a division: a string after it is still a string', () => {
    const { bare } = maskSource("const x = a / b + 'if (q)' + c / d;", 'js');
    expect(bare).not.toContain('if (q)');
  });

  it('reads a Rust lifetime as a lifetime, not a char literal', () => {
    const text = "let r: &'a str = if c { 1 } else { 2 }; let q: &'b str = 3;";
    expect(maskSource(text, 'rust').bare).toContain('if c');
    expect(maskSource("let c = 'a'; if z {}", 'rust').bare).toContain("let c = ' '; if z {}");
  });

  it('a quote with no partner on its line is plain text (a JSX apostrophe)', () => {
    expect(maskSource("<p>don't stop</p> if (a) {}\n", 'js').bare).toContain('if (a) {}');
    expect(maskSource("<p>don't</p>\nconst s = 'if (b)';", 'js').bare).not.toContain('if (b)');
  });

  it('blanks hash comments and triple-quoted strings for hash-family languages', () => {
    const text = "x = 1  # if (a)\ndoc = '''\nif (b)\n'''\ny = 2\n";
    const { bare } = maskSource(text, 'python');
    expect(bare).not.toContain('if (a)');
    expect(bare).not.toContain('if (b)');
    expect(bare).toContain('y = 2');
  });

  it('reads powershell as its own language, and a script as code', () => {
    expect(codeLanguageOf('build.ps1')).toBe('powershell');
    expect(codeLanguageOf('build.sh')).toBe('shell');
    expect(codeLanguageOf('a.css')).toBeUndefined();
  });
});
