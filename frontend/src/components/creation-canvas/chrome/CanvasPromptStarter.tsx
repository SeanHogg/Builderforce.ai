import { memo, useId, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PromptUseCaseCatalog } from '@/components/PromptUseCasePicker';
import { Icon } from '@/components/ui/Icon';
import { applyTemplateEntry } from '@/lib/templates/apply';
import type { CreationTemplate } from '@/lib/templates/creationTemplates';
import { useDismissOnOutsidePress } from '@/lib/useDismissable';
import styles from '../CreationCanvas.module.css';

export interface CanvasPromptStarterProps {
  /** Whether the catalogue is open. The host owns it: the `+` menu opens it too. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The conversation already has turns. The trigger then stands down — the way in is
   * the `+` menu's "Starting points" row — because a starter offered under a running
   * conversation reads as a second, competing action.
   */
  conversationStarted: boolean;
  /** Seed the composer with a prompt entry's text. */
  onPrompt: (prompt: string) => void;
  /** The Twilio journey was picked — the vendor setup prompt joins the bar. */
  onTwilioJourney: (selected: boolean) => void;
  /** Land an object pack on the board. */
  onPack: (template: CreationTemplate) => void;
}

/**
 * THE COMPOSER'S STARTING POINTS, inside the composer card.
 *
 * It used to be `PromptUseCasePicker`'s floating tab — a half-bordered "Choose a starting
 * point ^" right-aligned ABOVE the composer, belonging to nothing, with its catalogue
 * opening further up as an overlay. Now the trigger is a button in the card's top row,
 * beside the intent segment, and the catalogue opens INSIDE the card above that row,
 * sharing its border.
 *
 * The wrapper is `display: contents`, so the catalogue and the trigger are grid items of
 * the composer card itself (`.composerCard` places them by area) while this component
 * still owns both, and the wrapper's DOM node still contains both for the outside-press
 * test. Drawn only inside the composer, which is never drawn while presenting — so it
 * needs no gate of its own.
 */
export const CanvasPromptStarter = memo(function CanvasPromptStarter({
  open, onOpenChange, conversationStarted, onPrompt, onTwilioJourney, onPack,
}: CanvasPromptStarterProps) {
  const t = useTranslations('creationCanvas');
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const catalogId = useId();
  useDismissOnOutsidePress(rootRef, open, () => onOpenChange(false));

  return <div ref={rootRef} className={styles.promptStarter} data-tour="creation-prompt-starter" data-open={open ? 'true' : 'false'}>
    {/* One menu, every source. A prompt seeds the composer, a pack lands on the
        board, and an installable template opens its guided setup — dispatched by
        `applyTemplateEntry` so this surface never branches on where an entry
        came from. */}
    <PromptUseCaseCatalog
      open={open}
      id={catalogId}
      variant="inline"
      className={styles.promptStarterCatalog}
      onSelect={(entry) => {
        onOpenChange(false);
        applyTemplateEntry(entry, {
          onPrompt: (nextPrompt) => {
            onPrompt(nextPrompt);
            if (entry.id === 'twilio-ai-journey') onTwilioJourney(true);
          },
          onPack: (template) => onPack(template),
          onInstall: (key) => router.push(`/templates?open=${encodeURIComponent(key)}`),
        });
      }}
    />
    {(!conversationStarted || open) && <button
      type="button"
      className={styles.promptStarterTrigger}
      data-testid="canvas-prompt-starter-trigger"
      aria-expanded={open}
      aria-controls={catalogId}
      onClick={() => onOpenChange(!open)}
    >
      <Icon name="template" size={14} />
      {t('startingPoints')}
    </button>}
  </div>;
});
