import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GateReasonList } from './GateReasonList';
import { GATE_REASON_CODES } from '@/lib/governanceDevsecopsApi';
import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import de from '@/i18n/messages/de.json';

/**
 * The gate's reasons arrive as DATA and are worded here. Pinned: each known code renders its localized
 * key (never the English log `message`); a code this client does not know renders the generic localized
 * "blocked by security policy" instead of a raw key; and EVERY code has a translation in all five catalogs.
 * Copy is the passthrough key under the global next-intl mock.
 */
describe('GateReasonList', () => {
  it('words a known code through its localized key, not through the English message', () => {
    render(<GateReasonList reasons={[{ code: 'scan_failed', scanType: 'SAST', message: 'SAST scan failed' }]} />);
    expect(screen.getByText('pullRequestSecurityGate.reason.scan_failed')).toBeTruthy();
    expect(screen.queryByText('SAST scan failed')).toBeNull();
  });

  it('falls back to the generic localized text for a code it does not know', () => {
    render(<GateReasonList reasons={[{ code: 'a_future_code', message: 'English log text' }]} />);
    expect(screen.getByText('pullRequestSecurityGate.reasonUnknown')).toBeTruthy();
    expect(screen.queryByText('English log text')).toBeNull();
  });

  it('renders nothing for no reasons', () => {
    const { container } = render(<GateReasonList reasons={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it.each([['en', en], ['zh', zh], ['es', es], ['fr', fr], ['de', de]])('%s has a translation for every reason code and the fallback', (_l, catalog) => {
    const ns = (catalog as {
      pullRequestSecurityGate: { reason: Record<string, string>; reasonUnknown: string; scanType: Record<string, string>; severity: Record<string, string> };
    }).pullRequestSecurityGate;
    for (const code of GATE_REASON_CODES) expect(ns.reason[code], `${_l}: ${code}`).toBeTruthy();
    expect(ns.reasonUnknown).toBeTruthy();
    // the scan type and severity INSIDE a sentence are localized words too, never the raw enum
    for (const k of ['SECRET', 'SAST', 'SCA', 'REVIEW']) expect(ns.scanType[k], `${_l}: scanType.${k}`).toBeTruthy();
    for (const k of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) expect(ns.severity[k], `${_l}: severity.${k}`).toBeTruthy();
    // no catalog carries a key for a code the API no longer emits
    expect(Object.keys(ns.reason).sort()).toEqual([...GATE_REASON_CODES].sort());
  });

  it('the dead stale_head code is gone from the client list', () => {
    expect((GATE_REASON_CODES as readonly string[]).includes('stale_head')).toBe(false);
    expect((GATE_REASON_CODES as readonly string[]).includes('ci_not_on_head')).toBe(true);
  });
});
