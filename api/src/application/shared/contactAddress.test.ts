import { describe, expect, it } from 'vitest';
import { bareAddress, isE164 } from './contactAddress';

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
});

describe('isE164', () => {
  it('accepts a plus-prefixed number and nothing else', () => {
    expect(isE164('+14155551234')).toBe(true);
    expect(isE164('415-555-1234')).toBe(false);
    expect(isE164(null)).toBe(false);
  });
});
