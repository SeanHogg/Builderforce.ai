import { describe, expect, it } from 'vitest';
import {
  US_1099_NEC_THRESHOLD_CENTS,
  calendarYearBounds,
  evaluateThreshold,
  formTypeFor,
  isReportableYear,
  isUsRecipient,
  recipientTypeFor,
  taxIdLast4,
} from './taxThreshold';

describe('recipientTypeFor', () => {
  it('files a sole proprietor and a single-member LLC as an individual', () => {
    // The single-member LLC is the non-obvious one: a disregarded entity files
    // as its owner, so it must NOT land with the other LLCs.
    expect(recipientTypeFor('sole_proprietor')).toBe('individual');
    expect(recipientTypeFor('single_member_llc')).toBe('individual');
    expect(recipientTypeFor('llc')).toBe('business');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(recipientTypeFor('  Corporation ')).toBe('business');
  });

  it('reports an unknown or missing entity type as unknown rather than guessing', () => {
    expect(recipientTypeFor(null)).toBe('unknown');
    expect(recipientTypeFor('')).toBe('unknown');
    expect(recipientTypeFor('cooperative')).toBe('unknown');
  });
});

describe('isUsRecipient', () => {
  it('treats an absent residency as US', () => {
    // Over-reporting a domestic payee is recoverable; silently dropping one is not.
    expect(isUsRecipient(null)).toBe(true);
    expect(isUsRecipient(undefined)).toBe(true);
    expect(isUsRecipient('  ')).toBe(true);
  });

  it('accepts both ISO spellings of the United States', () => {
    expect(isUsRecipient('us')).toBe(true);
    expect(isUsRecipient('USA')).toBe(true);
  });

  it('recognises a foreign residency', () => {
    expect(isUsRecipient('GB')).toBe(false);
    expect(isUsRecipient('CA')).toBe(false);
  });
});

describe('evaluateThreshold — US recipients', () => {
  it('includes a recipient at EXACTLY $600', () => {
    // The IRS rule is "$600 or more". A `>` here silently drops this filing.
    const v = evaluateThreshold(US_1099_NEC_THRESHOLD_CENTS, 'US');
    expect(v.reportable).toBe(true);
    expect(v.formType).toBe('1099-NEC');
  });

  it('excludes a recipient one cent below the threshold', () => {
    const v = evaluateThreshold(US_1099_NEC_THRESHOLD_CENTS - 1, 'US');
    expect(v.reportable).toBe(false);
    expect(v.reason).toContain('below');
  });

  it('excludes a US recipient paid nothing', () => {
    expect(evaluateThreshold(0, 'US').reportable).toBe(false);
  });

  it('applies the US rule when residency is unstated', () => {
    expect(evaluateThreshold(100, null).formType).toBe('1099-NEC');
    expect(evaluateThreshold(100, null).reportable).toBe(false);
  });
});

describe('evaluateThreshold — non-US recipients', () => {
  it('reports any payment at all, with no de-minimis floor', () => {
    const v = evaluateThreshold(1, 'GB');
    expect(v.reportable).toBe(true);
    expect(v.formType).toBe('1042-S');
  });

  it('does not report a foreign recipient paid nothing', () => {
    expect(evaluateThreshold(0, 'GB').reportable).toBe(false);
  });

  it('does not apply the $600 floor to a foreign recipient', () => {
    // The bug this guards: reusing the US branch would exclude a £3 payment.
    expect(evaluateThreshold(300, 'FR').reportable).toBe(true);
  });
});

describe('formTypeFor', () => {
  it('maps residency to the filing form', () => {
    expect(formTypeFor('US')).toBe('1099-NEC');
    expect(formTypeFor('DE')).toBe('1042-S');
  });
});

describe('calendarYearBounds', () => {
  it('is a half-open UTC range so 31 Dec 23:59:59Z is in and 1 Jan is not', () => {
    const { start, end } = calendarYearBounds(2025);
    expect(start.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('isReportableYear', () => {
  it('accepts a four-digit year in range', () => {
    expect(isReportableYear(2025)).toBe(true);
  });

  it('rejects junk, floats and out-of-range years', () => {
    expect(isReportableYear('2025')).toBe(false);
    expect(isReportableYear(2025.5)).toBe(false);
    expect(isReportableYear(NaN)).toBe(false);
    expect(isReportableYear(1999)).toBe(false);
    expect(isReportableYear(2101)).toBe(false);
  });
});

describe('taxIdLast4', () => {
  it('strips formatting before taking the last four', () => {
    expect(taxIdLast4('123-45-6789')).toBe('6789');
    expect(taxIdLast4('12-3456789')).toBe('6789');
  });

  it('keeps letters, which a foreign tax id may carry', () => {
    expect(taxIdLast4('GB 1234 56X7')).toBe('56X7');
  });

  it('does not pad or throw on a short value', () => {
    expect(taxIdLast4('12')).toBe('12');
    expect(taxIdLast4('')).toBe('');
  });
});
