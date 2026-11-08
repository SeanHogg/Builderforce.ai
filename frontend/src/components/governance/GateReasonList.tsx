import { useTranslations } from 'next-intl';
import { GATE_REASON_CODES, type GateReason } from '@/lib/governanceDevsecopsApi';

/**
 * The security gate's reasons, worded in the viewer's language. The API sends each reason as DATA
 * (`code` plus parameters); the sentence is `pullRequestSecurityGate.reason.<code>`, and the scan type and
 * severity inside it are themselves localized words (`scanType.*`, `severity.*`) - never the API's English or
 * its raw enum. A code this client does not know - the API can gain one before every client does - renders as
 * the generic localized "blocked by security policy" rather than as a raw key or the English log message.
 */
const KNOWN = new Set<string>(GATE_REASON_CODES);
const SCAN_TYPES = new Set(['SECRET', 'SAST', 'SCA', 'REVIEW']);
const SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);

export function GateReasonList({ reasons, style }: { reasons: readonly GateReason[]; style?: React.CSSProperties }) {
  const t = useTranslations('pullRequestSecurityGate');
  if (reasons.length === 0) return null;

  const sentence = (r: GateReason): string => {
    if (!KNOWN.has(r.code)) return t('reasonUnknown');
    const scanType = r.scanType && SCAN_TYPES.has(r.scanType) ? t(`scanType.${r.scanType}`) : (r.scanType ?? '');
    const severity = r.severity && SEVERITIES.has(r.severity) ? t(`severity.${r.severity}`) : (r.severity ?? '');
    return t(`reason.${r.code}`, {
      scanType, severity, count: r.count ?? 0, detail: r.detail ?? '', source: r.source ?? 'scan',
    });
  };

  return (
    <ul style={{ margin: '4px 0 4px 18px', padding: 0, ...style }}>
      {reasons.map((r, i) => (
        <li key={`${r.code}:${r.scanType ?? ''}:${r.detail ?? ''}:${i}`}>{sentence(r)}</li>
      ))}
    </ul>
  );
}
