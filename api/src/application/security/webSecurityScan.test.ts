import { describe, it, expect } from 'vitest';
import { selectResolvedTicketIds } from './webSecurityScan';
import { webMarker } from './WebSecurityScanner';
import { stageOfCheckId } from './webScanStages';

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

  // Findings now arrive from TWO runtimes. The Worker pass CANNOT raise a `tls-*` or
  // `cve-*` finding at all - the container does, minutes later - so to the Worker they
  // always look resolved. Closing them would churn each ticket closed/reopened on
  // every scan, losing its comments and assignee each time.
  it('never closes a container stage finding on a Worker-side re-scan', () => {
    const open = [ticket(1, 'tls-cert-expiring'), ticket(2, 'cve-nginx'), ticket(3, 'hsts-missing')];
    expect(selectResolvedTicketIds(open, ORIGIN, new Set())).toEqual([3]);
  });

  it('lets a stage close its OWN resolved findings and nothing else', () => {
    const open = [ticket(1, 'tls-cert-expiring'), ticket(2, 'cve-nginx'), ticket(3, 'hsts-missing')];
    const ownsTls = (checkId: string) => stageOfCheckId(checkId) === 'tls';
    expect(selectResolvedTicketIds(open, ORIGIN, new Set(), ownsTls)).toEqual([1]);
  });

  it('keeps a stage finding open while the stage still raises it', () => {
    const open = [ticket(1, 'tls-cert-expiring')];
    const still = new Set([webMarker('tls-cert-expiring', ORIGIN).toLowerCase()]);
    expect(selectResolvedTicketIds(open, ORIGIN, still, () => true)).toEqual([]);
  });
});

describe('stageOfCheckId (which runtime owns a check)', () => {
  it('attributes a stage-prefixed check to its stage', () => {
    expect(stageOfCheckId('tls-cert-expired')).toBe('tls');
    expect(stageOfCheckId('cve-lookup-not-performed')).toBe('cve');
  });

  it('leaves every Worker-side check unowned by a stage', () => {
    for (const id of ['hsts-missing', 'csp-missing', 'cookie-insecure', 'exposed-dotenv']) {
      expect(stageOfCheckId(id)).toBeNull();
    }
  });
});
