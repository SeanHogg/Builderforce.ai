import { describe, it, expect } from 'vitest';
import { selectResolvedTicketIds } from './webSecurityScan';
import { webMarker } from './WebSecurityScanner';

const ORIGIN = 'https://acme.test';
const otherOrigin = 'https://other.test';

// Helper: an open ticket carrying a web marker for a given check + origin.
const ticket = (id: number, checkId: string, origin = ORIGIN) => ({
  id,
  title: `Some finding title ${webMarker(checkId, origin)}`,
});

describe('selectResolvedTicketIds (auto-close decision)', () => {
  it('closes a ticket whose finding the current scan no longer raises', () => {
    const open = [ticket(1, 'hsts-missing'), ticket(2, 'csp-missing')];
    // Current scan only still raises hsts-missing → csp ticket (2) is resolved.
    const current = new Set([webMarker('hsts-missing', ORIGIN).toLowerCase()]);
    expect(selectResolvedTicketIds(open, ORIGIN, current)).toEqual([2]);
  });

  it('keeps a ticket whose finding is still raised', () => {
    const open = [ticket(1, 'hsts-missing')];
    const current = new Set([webMarker('hsts-missing', ORIGIN).toLowerCase()]);
    expect(selectResolvedTicketIds(open, ORIGIN, current)).toEqual([]);
  });

  it('never touches tickets for a DIFFERENT origin', () => {
    const open = [ticket(1, 'hsts-missing', otherOrigin)];
    // current scan of ORIGIN raises nothing; the other-origin ticket must be left alone.
    expect(selectResolvedTicketIds(open, ORIGIN, new Set())).toEqual([]);
  });

  it('ignores non-web tickets (SOC 2 / GitHub / manual)', () => {
    const open = [
      { id: 5, title: 'CodeQL: sqli [gh:code-scanning:acme/app#42]' },
      { id: 6, title: 'A plain manual ticket with no marker' },
      { id: 7, title: null },
    ];
    expect(selectResolvedTicketIds(open, ORIGIN, new Set())).toEqual([]);
  });

  it('closes ALL of a site\'s findings when a re-scan comes back clean', () => {
    const open = [ticket(1, 'hsts-missing'), ticket(2, 'csp-missing'), ticket(3, 'clickjacking')];
    expect(selectResolvedTicketIds(open, ORIGIN, new Set()).sort()).toEqual([1, 2, 3]);
  });
});
