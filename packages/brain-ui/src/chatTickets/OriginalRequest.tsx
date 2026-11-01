import { S } from './panelStyles';
import type { ChatTicketsLabels } from './types';

/**
 * The chat's ORIGINAL request, kept verbatim (migration 1245): read-only history, not an editable field - it is what
 * the person asked on turn one, and the auto-title is only a ~60-char derivation of it. Hidden when absent so a chat
 * without one renders exactly as before.
 *
 * ONE component for both rails that show it: the linked-ticket rail (`ChatTicketsPanel`) and a chat only on this
 * machine, which has no platform rail but still has a first prompt.
 */
export function OriginalRequest({ text, labels }: {
  text: string | null | undefined;
  labels: Pick<ChatTicketsLabels, 'originalRequest' | 'originalRequestText'>;
}) {
  if (!text?.trim()) return null;
  return (
    <div style={S.originalRequest}>
      <span style={S.originalRequestLabel}>{labels.originalRequest}</span>
      <span style={S.originalRequestText} title={labels.originalRequestText(text)}>{text}</span>
    </div>
  );
}
