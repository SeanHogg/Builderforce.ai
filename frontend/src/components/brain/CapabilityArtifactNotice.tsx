'use client';

/**
 * "This reply didn't produce the artifact" — the honest answer to a stub.
 *
 * A weak or rate-limited model answers a Data Visualization request with a title
 * line and no chart. Rendered as markdown that is a near-empty bubble, so the
 * user sees a click that "did nothing". This says what is missing and offers a
 * retry that re-asks for the artifact explicitly.
 *
 * Self-gating: renders nothing when there is no capability, when the reply DID
 * deliver its artifact, or while a turn is still streaming (an incomplete reply
 * is not a failed one).
 */

import { useTranslations } from 'next-intl';
import { getBrainCapability, replyHasArtifact } from '@/lib/brain';

export interface CapabilityArtifactNoticeProps {
  capability?: string | null;
  /** The assistant reply being judged. */
  content: string;
  /** True while any turn is streaming — suppresses the verdict. */
  streaming?: boolean;
  /** Only the newest assistant turn is worth retrying. */
  isLatest?: boolean;
  /** Re-ask for the artifact. Omit to render the notice without a retry. */
  onRetry?: (prompt: string) => void;
}

export function CapabilityArtifactNotice({
  capability,
  content,
  streaming,
  isLatest,
  onRetry,
}: CapabilityArtifactNoticeProps) {
  const t = useTranslations('brain.capabilities');
  const def = getBrainCapability(capability);
  if (!def || streaming || !isLatest) return null;
  if (replyHasArtifact(capability, content)) return null;

  const label = t(`${def.id}.label`);
  return (
    <div
      role="status"
      style={{
        flexBasis: '100%',
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 6,
        padding: '6px 10px',
        borderRadius: 8,
        border: '1px solid var(--warning-border, rgba(234,179,8,0.3))',
        background: 'var(--warning-bg, rgba(234,179,8,0.12))',
        color: 'var(--warning-text, #b45309)',
        fontSize: 12,
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>{t('missing.body', { capability: label })}</span>
      {onRetry && (
        <button
          type="button"
          onClick={() => onRetry(t('missing.retryPrompt', { capability: label }))}
          style={{
            flex: '0 0 auto',
            padding: '4px 10px',
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 6,
            border: '1px solid currentColor',
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
          }}
        >
          {t('missing.retry')}
        </button>
      )}
    </div>
  );
}
