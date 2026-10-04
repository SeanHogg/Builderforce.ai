import { useTranslations } from 'next-intl';
import { BrainPanel } from '@/components/brain/BrainPanel';
import { Icon } from '@/components/ui/Icon';
import type { BrainModality } from '@/lib/brain';

export interface WorkspaceBrainColumnProps {
  projectId: number;
  modality: BrainModality;
  /** The open-file system context shared with the global Brain. */
  extraSystem?: string;
  /** The file open in the editor — what the coding agent is looking at. */
  activeFile?: string | null;
  /** Voice modality: the clone the director speaks with. */
  voiceName?: string | null;
  initialChatId?: number | null;
  initialPrompt?: string;
  initialTicket?: { kind: string; ref: string };
  /** Take the whole row (a narrow screen, where chat and workspace take turns). */
  fill?: boolean;
}

/**
 * The IDE / Studio chat column: the shared `<BrainPanel>` docked beside the editor,
 * with what the agent currently sees (the open file, or the voice director's clone)
 * named in the panel's own header instead of a separate strip stacked above it.
 *
 * Mounting it registers an inline Brain, so the app-wide floating launcher stands
 * down on this page — it only ever opened a second copy of this same chat.
 *
 * Width is fluid (`clamp`) rather than a fixed 340px, so a wide screen gives the
 * conversation room and a narrow one keeps the editor usable.
 */
export function WorkspaceBrainColumn({ projectId, modality, extraSystem, activeFile, voiceName, initialChatId, initialPrompt, initialTicket, fill = false }: WorkspaceBrainColumnProps) {
  const t = useTranslations('ide.brainContext');
  const voice = modality === 'voice';
  const subject = voice ? (voiceName || t('noVoice')) : (activeFile || t('wholeProject'));

  return (
    <div style={{
      width: fill ? 'auto' : 'clamp(300px, 28vw, 420px)', flex: fill ? 1 : '0 0 auto', minWidth: 0,
      borderRight: fill ? 'none' : '1px solid var(--border-subtle)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      background: 'var(--bg-base)',
    }}>
      <BrainPanel
        variant="docked"
        pinnedProjectId={projectId}
        modality={modality}
        extraSystem={extraSystem}
        initialChatId={initialChatId}
        initialPrompt={initialPrompt}
        initialTicket={initialTicket}
        capabilitySurface="build"
        // The workspace header already names the project, its type and the plan.
        composerDensity="compact"
        headerContext={(
          <>
            <span aria-hidden title={t(voice ? 'voiceDirector' : 'codingAgent')} style={{ display: 'inline-flex' }}>
              <Icon source={voice ? '🎙' : '🤖'} size="1em" />
            </span>
            <span style={{ fontWeight: 600, color: 'var(--text-secondary)', flexShrink: 0 }}>{t(voice ? 'voice' : 'context')}</span>
            <span title={subject} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: activeFile && !voice ? 'var(--font-mono, monospace)' : undefined }}>
              {subject}
            </span>
          </>
        )}
      />
    </div>
  );
}
