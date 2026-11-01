import { describe, expect, it } from 'vitest';
import { angleGroupCount, bareAddress, canonicalAddress, hasControlCharacter, isAmbiguousMailbox, isE164, splitAddressList } from './contactAddress';

describe('splitAddressList', () => {
  it('splits a comma or semicolon list into trimmed entries', () => {
    expect(splitAddressList('a@x.com')).toEqual(['a@x.com']);
    expect(splitAddressList('a@x.com, Jane <b@x.com> ;c@x.com')).toEqual(['a@x.com', 'Jane <b@x.com>', 'c@x.com']);
  });

  it('does not split inside a quoted display name, an angle group or a comment', () => {
    expect(splitAddressList('"Doe, Jane" <j@x.com>, b@x.com')).toEqual(['"Doe, Jane" <j@x.com>', 'b@x.com']);
    expect(splitAddressList('"He said \\"a, b\\"" <j@x.com>')).toEqual(['"He said \\"a, b\\"" <j@x.com>']);
    expect(splitAddressList('Jane <a@x.com> (Sales, EMEA), b@x.com')).toEqual(['Jane <a@x.com> (Sales, EMEA)', 'b@x.com']);
  });

  it('reads the members of an RFC 5322 group, and drops empty entries', () => {
    expect(splitAddressList('Team: a@x.com, b@x.com;')).toEqual(['Team', 'a@x.com', 'b@x.com']);
    expect(splitAddressList(' , ;; ')).toEqual([]);
    expect(splitAddressList('')).toEqual([]);
  });
});

describe('bareAddress', () => {
  it('extracts the address from a display-name mailbox value', () => {
    expect(bareAddress('Jane Doe <jane@x.com>')).toBe('jane@x.com');
    expect(bareAddress('  <jane@x.com> ')).toBe('jane@x.com');
  });

  it('returns a value with no angle brackets trimmed', () => {
    expect(bareAddress('  jane@x.com ')).toBe('jane@x.com');
  });

  it('takes the LAST angle group, so a decoy address in the display name cannot steer a reply', () => {
    // The display name is the sender's own text. The address a reply is delivered to is the
    // trailing group; the first group here is the victim the attacker wants a reply sent to.
    expect(bareAddress('"<victim@x.com>" <attacker@y.com>')).toBe('attacker@y.com');
    expect(bareAddress('Eve <victim@x.com> <attacker@y.com>')).toBe('attacker@y.com');
  });

  it('strips a trailing RFC comment, so the angle group need not end the value', () => {
    expect(bareAddress('<a@x.com> (comment)')).toBe('a@x.com');
    expect(bareAddress('Jane <erased@x.com> (Sales)')).toBe('erased@x.com');
    expect(bareAddress('Jane <erased@x.com> (Sales (EMEA)) ')).toBe('erased@x.com');
    expect(bareAddress('Jane <a@x.com> (see <b@y.com>)')).toBe('a@x.com');
    expect(bareAddress('a@x.com (comment)')).toBe('a@x.com');
  });

  it('still resolves a decoy in the display name to the real address when a comment follows', () => {
    expect(bareAddress('"<victim@x.com>" <attacker@y.com> (hi)')).toBe('attacker@y.com');
  });
});

describe('bareAddress and quoted strings', () => {
  it('never takes a quoted decoy that follows the real address', () => {
    expect(bareAddress('Eve <a@x.com> "<victim@y.com>"')).toBe('a@x.com');
  });

  it('still takes the real address after a quoted decoy', () => {
    expect(bareAddress('"<victim@x.com>" <attacker@y.com>')).toBe('attacker@y.com');
  });

  it('honours backslash escapes inside a quoted string', () => {
    expect(bareAddress('"He said \\"hi\\" <no@x.com>" <real@y.com>')).toBe('real@y.com');
  });

  it('leaves a trailing comment and a bare address as before', () => {
    expect(bareAddress('Jane <a@x.com> (Sales)')).toBe('a@x.com');
    expect(bareAddress('a@x.com')).toBe('a@x.com');
  });
});

describe('isE164', () => {
  it('accepts a plus-prefixed number and nothing else', () => {
    expect(isE164('+14155551234')).toBe(true);
    expect(isE164('415-555-1234')).toBe(false);
    expect(isE164(null)).toBe(false);
  });
});

describe('angleGroupCount', () => {
  it('counts the angle groups outside quoted strings and trailing comments', () => {
    expect(angleGroupCount('a@x.com')).toBe(0);
    expect(angleGroupCount('Jane <a@x.com>')).toBe(1);
    expect(angleGroupCount('Jane <a@x.com> (Sales)')).toBe(1);
    expect(angleGroupCount('"<victim@x.com>" <a@x.com>')).toBe(1);
    expect(angleGroupCount('<erased@y.com> <a@x.com>')).toBe(2);
    expect(angleGroupCount('Jane <a@x.com, erased@y.com')).toBe(0);
  });
});

describe('isAmbiguousMailbox', () => {
  it.each([
    ['an unterminated comment that swallows a comma', 'ok@x.com (, erased@y.com'],
    ['a stray closing parenthesis', 'ok@x.com ), erased@y.com'],
    ['text after the angle group', '<ok@x.com> erased@y.com'],
    ['a quoted string after the angle group', 'Eve <a@x.com> "<victim@y.com>"'],
    ['more than one angle group', '<a@x.com> <b@y.com>'],
  ])('is true for %s', (_name, value) => {
    expect(isAmbiguousMailbox(value)).toBe(true);
  });

  it.each([
    ['a bare address', 'a@x.com'],
    ['a display name and a group', 'Jane <a@x.com>'],
    ['a trailing comment after the group', 'Jane <a@x.com> (Sales)'],
    ['a nested trailing comment', 'Jane <a@x.com> (Sales (EMEA))'],
    ['a comment inside the group', '<a@x.com (c)>'],
    ['a quoted display name holding a bracket and a parenthesis', '"<v@x.com> (" <a@x.com>'],
    ['a leading comment', '(c) a@x.com'],
  ])('is false for %s', (_name, value) => {
    expect(isAmbiguousMailbox(value)).toBe(false);
  });
});

describe('bareAddress keeps a quoted local part inside an angle group', () => {
  it('slices the group from the original text, not from the text with its quoted strings removed', () => {
    expect(bareAddress('Jane <"Erased"@X.com>')).toBe('"Erased"@X.com');
    expect(bareAddress('"<victim@x.com>" <attacker@y.com>')).toBe('attacker@y.com');
  });
});

describe('canonicalAddress', () => {
  it.each([
    ['"erased"@x.com', 'erased@x.com'],
    ['erased(c)@x.com', 'erased@x.com'],
    ['erased@x.com (c)', 'erased@x.com'],
    ['(c) erased@x.com', 'erased@x.com'],
    ['@a.com:erased@x.com', 'erased@x.com'],
    ['@a.com,@b.com:erased@x.com', 'erased@x.com'],
    ['erased@x.com.', 'erased@x.com'],
    ['erased@x.com...', 'erased@x.com'],
    ['erased@x.com', 'erased@x.com'],
  ])('folds %s to %s', (input, expected) => {
    expect(canonicalAddress(input)).toBe(expected);
  });

  it('leaves a quoted local part that needs its quotes, and anything it does not recognise, as written', () => {
    expect(canonicalAddress('"a b"@x.com')).toBe('"a b"@x.com');
    expect(canonicalAddress('"a(b"@x.com')).toBe('"a(b"@x.com');
    expect(canonicalAddress('+14155551234')).toBe('+14155551234');
    expect(canonicalAddress('@handle')).toBe('@handle');
  });
});

describe('hasControlCharacter', () => {
  it.each([
    ['CR', '\r'], ['LF', '\n'], ['CRLF', '\r\n'], ['NUL', '\u0000'], ['tab', '\t'], ['DEL', '\u007f'], ['a C1 control', '\u0085'],
  ])('is true for %s anywhere in the value', (_name, control) => {
    expect(hasControlCharacter(`x@y.com${control}Bcc: erased@x.com`)).toBe(true);
    expect(hasControlCharacter(control)).toBe(true);
  });

  it('is false for ordinary text, including spaces, unicode and the characters an address uses', () => {
    expect(hasControlCharacter('')).toBe(false);
    expect(hasControlCharacter('Jane Doe <jane+tag@x.com>')).toBe(false);
    expect(hasControlCharacter('Quarterly numbers: Q3 — café')).toBe(false);
  });
});
