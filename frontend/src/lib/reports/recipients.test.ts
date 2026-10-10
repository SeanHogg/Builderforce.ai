import { describe, expect, it } from 'vitest';
import { formatRecipients, parseRecipientInput } from './recipients';

describe('parseRecipientInput', () => {
  it('accepts commas, semicolons, newlines and spaces as separators', () => {
    expect(parseRecipientInput('a@x.co, b@x.co; c@x.co\nd@x.co e@x.co').valid)
      .toEqual(['a@x.co', 'b@x.co', 'c@x.co', 'd@x.co', 'e@x.co']);
  });

  it('reduces a "Name <address>" entry to its address, display name and all', () => {
    expect(parseRecipientInput('Ann Lee <Ann@Example.com>, bob@example.com')).toEqual({
      valid: ['ann@example.com', 'bob@example.com'],
      invalid: [],
    });
  });

  it('lower-cases and de-duplicates in first-seen order', () => {
    expect(parseRecipientInput('B@x.co\nb@x.co\na@x.co').valid).toEqual(['b@x.co', 'a@x.co']);
  });

  it('names the entries that are not addresses instead of dropping them', () => {
    expect(parseRecipientInput('ok@x.co, not-an-email, @x.co')).toEqual({
      valid: ['ok@x.co'],
      invalid: ['not-an-email', '@x.co'],
    });
  });

  it('treats blank input as no recipients', () => {
    expect(parseRecipientInput('  \n , ')).toEqual({ valid: [], invalid: [] });
  });
});

describe('formatRecipients', () => {
  it('round-trips through the parser', () => {
    const list = ['a@x.co', 'b@x.co'];
    expect(parseRecipientInput(formatRecipients(list)).valid).toEqual(list);
  });
});
