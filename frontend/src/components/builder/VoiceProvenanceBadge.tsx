/**
 * VoiceProvenanceBadge — the "this clip is signed" mark under a generated voice.
 *
 * The server signs a manifest for every clip and the audio carries an inaudible
 * watermark; this badge says so and links to the public verification endpoint,
 * which anyone holding the clip can open. It is data-driven: whether the audio
 * could be watermarked selects the label and the colour family from one table,
 * so a clip the server could only sign (a codec it cannot decode) is shown
 * honestly as such instead of borrowing the stronger claim.
 *
 * Not `DerivedProvenance`: that file answers "what was this canvas number computed
 * from" with canvas-node styles; this answers "who made this audio", a different
 * fact with a different source.
 */

import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { verifyPagePath, type VoiceClipProvenance } from '@/lib/voiceClipProvenance';

/** Label key + semantic colour family, keyed by "was the audio watermarked". */
const VARIANT = {
  true: { label: 'signedWatermarked', tone: 'success' },
  false: { label: 'signedOnly', tone: 'warning' },
} as const;

export function VoiceProvenanceBadge({ provenance }: { provenance: VoiceClipProvenance }) {
  const t = useTranslations('voice.provenance');
  const format = useFormatter();
  const variant = VARIANT[String(provenance.watermarked) as keyof typeof VARIANT];
  const { manifest } = provenance;

  return (
    <div
      data-testid="voice-provenance-badge"
      title={t('details', {
        engine: manifest.model,
        date: format.dateTime(new Date(manifest.createdAt), { dateStyle: 'medium', timeStyle: 'short' }),
        consent: manifest.consentTextVersion,
      })}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        margin: '0 0 16px',
        padding: '6px 10px',
        borderRadius: 'var(--radius-md)',
        border: `1px solid var(--${variant.tone}-border)`,
        background: `var(--${variant.tone}-bg)`,
        color: `var(--${variant.tone}-text)`,
        fontSize: 'var(--font-size-small)',
      }}
    >
      <strong>{t(variant.label)}</strong>
      <Link
        href={verifyPagePath(provenance)}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: 'inherit', textDecoration: 'underline' }}
      >
        {t('verify')}
      </Link>
    </div>
  );
}
