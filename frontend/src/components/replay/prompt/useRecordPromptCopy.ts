/**
 * Copying an improvement prompt is applying the fixes by hand (PRD 33 §5.2): each
 * fix in it that still offers `copy-prompt` is recorded through that action (the API
 * marks it `applied` / manual, and the next release is measured against it).
 *
 * The write is MANAGER (`insights.actOnFixes`); anyone else may still copy the text,
 * nothing is recorded, and no request is sent that the API would refuse.
 */

import type { ImprovementAudience, ReplayPrescriptionDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { usePermission } from '@/lib/rbac';

type Fix = Pick<ReplayPrescriptionDto, 'id' | 'next'>;

/** Record a copied prompt on every fix in it that still offers `copy-prompt`. */
export async function recordPromptCopy(siteId: string, fixes: readonly Fix[], audience: ImprovementAudience): Promise<void> {
  const open = fixes.filter((p) => p.next.includes('copy-prompt'));
  await Promise.all(open.map((p) => replayApi.actOnPrescription(siteId, p.id, 'copy-prompt', { audience })));
}

/** `onCopied` for a `PromptBox` over these fixes — undefined when there is nothing the reader may record. */
export function useRecordPromptCopy(siteId: string): (fixes: readonly Fix[], audience: ImprovementAudience) => (() => Promise<void>) | undefined {
  const { allowed } = usePermission('insights.actOnFixes');
  return (fixes, audience) => (allowed && fixes.some((p) => p.next.includes('copy-prompt'))
    ? () => recordPromptCopy(siteId, fixes, audience)
    : undefined);
}
