/**
 * The ONE "copy this lead" control — used by the row action and by the recording
 * panel header, so a capture is identical wherever it was taken from.
 *
 * The prompt history is NOT on the session row (the table would be a join per
 * visitor), so it is fetched on click. That is also what makes the capture
 * honest: fetching on render would stamp a report "now" while carrying rows
 * loaded minutes earlier. A failed fetch degrades to a report that SAYS the
 * history could not be loaded rather than to one that silently reads as
 * "this visitor typed nothing".
 */

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, type AdminGuestSession } from '@/lib/adminApi';
import { CopyButton } from '@/components/CopyButton';
import { captureDiagnosticsContext } from '@/lib/diagnosticsCapture';
import { buildGuestSessionReport } from '@/lib/guestSessionDiagnostics';

export function GuestSessionCopyButton({ session, compact }: { session: AdminGuestSession; compact?: boolean }) {
  const t = useTranslations('admin.sessions');

  const buildReport = useCallback(async (): Promise<string> => {
    const prompts = await adminApi.guestPrompts(session.visitorId).catch(() => null);
    return buildGuestSessionReport(
      {
        session,
        prompts,
        promptsError: prompts === null ? 'the prompt history could not be loaded' : null,
      },
      await captureDiagnosticsContext(),
    );
  }, [session]);

  return (
    <CopyButton
      getText={buildReport}
      ariaLabel={t('copyAria', { visitor: session.visitorId })}
      compact={compact}
    />
  );
}
