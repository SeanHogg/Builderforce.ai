import { describe, expect, it } from 'vitest';
import { bareAddress, isE164, splitAddressList } from './contactAddress';

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
