// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import type { useVoiceStudio } from '@/lib/voiceStudio';

/**
 * Voice's one action — render the lines in the selected voice — in the header.
 * Voice is the only project type with an explicit run: a live preview starts by
 * itself, a voice line is generated on demand.
 */
export function VoiceGenerateButton({ voice, label }: { voice: ReturnType<typeof useVoiceStudio>; label: string }) {
  const t = useTranslations('ide.workspace');
  const noClone = !voice.selectedCloneId;
  return (
    <Button
      type="button"
      variant="primary"
      size="sm"
      onClick={() => void voice.synth()}
      disabled={voice.busy || noClone}
      title={noClone ? t('voiceNeedsClone') : undefined}
    >
      {voice.busy ? t('generating') : label}
    </Button>
  );
}
