'use client';

import { useTranslations } from 'next-intl';
import type { AttentionState } from '@/lib/builderforceApi';
import { statusColor, type StatusToneMap } from '@/lib/statusTone';

/**
 * The ONE cross-surface status glyph for a session/ticket's live state. Given an
 * {@link AttentionState} it renders a coloured dot (pulsing to draw the eye) with
 * an accessible, localised label — `running` = coral, `awaiting_input` = amber
 * "needs answer". Renders nothing for an idle/absent state so a caller can drop
 * it into any row unconditionally (`<AttentionDot state={attn.chats[id]?.state} />`)
 * and it self-hides. Colours mirror {@link EXECUTION_STATUS_TONE} so the board
 * chips and these dots agree on hue everywhere.
 */
const ATTENTION_TONE: StatusToneMap<AttentionState> = {
  running: 'accent',
  awaiting_input: 'warning',
};

export function AttentionDot({
  state,
  showLabel = false,
  size = 8,
}: {
  state?: AttentionState | null;
  showLabel?: boolean;
  size?: number;
}) {
  const t = useTranslations('attention');
  if (!state) return null;
  const color = statusColor(ATTENTION_TONE, state, 'solid');
  const label = state === 'awaiting_input' ? t('awaiting') : t('running');
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}
      title={label}
      aria-label={label}
      role="status"
    >
      <span
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
          // Both states pulse — `running` because it's live, `awaiting_input`
          // because it's blocking on a person and should be noticed.
          animation: 'agentPulse 1.4s ease-in-out infinite',
        }}
      />
      {showLabel && (
        <span style={{ fontSize: 11, fontWeight: 600, color: statusColor(ATTENTION_TONE, state), whiteSpace: 'nowrap' }}>{label}</span>
      )}
    </span>
  );
}
