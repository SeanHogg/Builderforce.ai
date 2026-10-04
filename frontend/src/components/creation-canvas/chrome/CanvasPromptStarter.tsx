import { memo } from 'react';
import { useRouter } from 'next/navigation';
import { PromptUseCasePicker } from '@/components/PromptUseCasePicker';
import { applyTemplateEntry } from '@/lib/templates/apply';
import type { CreationTemplate } from '@/lib/templates/creationTemplates';
import styles from '../CreationCanvas.module.css';

export interface CanvasPromptStarterProps {
  /** Seed the composer with a prompt entry's text. */
  onPrompt: (prompt: string) => void;
  /** The Twilio journey was picked — the vendor setup prompt joins the bar. */
  onTwilioJourney: (selected: boolean) => void;
  /** Land an object pack on the board. */
  onPack: (template: CreationTemplate) => void;
}

/** The composer's "choose a starting point" picker. Drawn only inside the composer, which
 *  is itself never drawn while presenting — so it needs no gate of its own. */
export const CanvasPromptStarter = memo(function CanvasPromptStarter({ onPrompt, onTwilioJourney, onPack }: CanvasPromptStarterProps) {
  const router = useRouter();
  return <div className={styles.promptStarter} data-tour="creation-prompt-starter">
    {/* One menu, every source. A prompt seeds the composer, a pack lands on the
        board, and an installable template opens its guided setup — dispatched by
        `applyTemplateEntry` so this surface never branches on where an entry
        came from. The executive execution contract now rides on the entry, so
        it no longer has to be re-composed here. */}
    <PromptUseCasePicker placement="top" align="end" onSelect={(entry) => {
      applyTemplateEntry(entry, {
        onPrompt: (nextPrompt) => {
          onPrompt(nextPrompt);
          if (entry.id === 'twilio-ai-journey') onTwilioJourney(true);
        },
        onPack: (template) => onPack(template),
        onInstall: (key) => router.push(`/templates?open=${encodeURIComponent(key)}`),
      });
    }} />
  </div>;
});
