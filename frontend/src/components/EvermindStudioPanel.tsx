'use client';

/**
 * EvermindStudioPanel — center workspace for the `evermind` project modality.
 *
 * The `evermind` modality grows a LIVING model: you teach it and it learns in
 * place (Write-Through Cognition), rather than training a frozen adapter. This
 * panel is deliberately separate from the `finetune` modality (classic LoRA) —
 * it never shows datasets, training runs, or export.
 *
 * Layout mirrors the other studios: a teach console rail (ProjectEvermindPanel,
 * which runs Teach / Validate) beside the live Knowledge Map + region-filterable
 * Learnings (EvermindStudioCenter). A Validate recall in the console highlights
 * matches across both surfaces, so they share one EvermindValidationProvider.
 *
 * Self-gating per the DRY rule: each child owns its own RBAC / loading / empty
 * states; the host (IDENew) only decides whether the `evermind` modality is active.
 */

import { useTranslations } from 'next-intl';
import { ProjectEvermindPanel } from '@/components/ide/ProjectEvermindPanel';
import { EvermindStudioCenter } from '@/components/ide/EvermindStudioCenter';
import { EvermindValidationProvider } from '@/components/ide/EvermindValidationContext';

export function EvermindStudioPanel({ projectId }: { projectId: number | string }) {
  const t = useTranslations('evermindStudio');
  const pid = Number(projectId);

  return (
    <div className="em-studio-root">
      <style>{EM_STUDIO_CSS}</style>
      {/* The teach console (rail) runs Validate; the Knowledge Map + Learnings (center)
          highlight the matched memories — share that result across both subtrees. */}
      <EvermindValidationProvider>
        <div className="em-studio-row">
          {/* Left rail: intro + the teach/validate console. Scrolls independently so
              the centre Knowledge Map stays put no matter how long the console gets. */}
          <div className="em-studio-rail">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: '1.6rem' }}>🧠</span>
              <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.25rem', margin: 0 }}>
                {t('title')}
              </h1>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.5, marginTop: 0, marginBottom: 20 }}>
              {t('intro')}
            </p>

            {/* The project's Evermind — every project gets a default one on creation, so
                this always renders a real model to teach/validate/edit. Self-gating (RBAC +
                its own loading/empty states), localized, theme-aware. Recently-learned lives
                in the center Learnings panel (region-filterable), so hide it here. */}
            <ProjectEvermindPanel projectId={pid} showRecent={false} />

            <p style={{ color: 'var(--text-muted)', fontSize: '0.72rem', lineHeight: 1.5, marginTop: 20 }}>
              {t('footer')}
            </p>
          </div>

          {/* Center stage: the live Knowledge Map + region-filterable Learnings list. */}
          <div className="em-studio-center">
            <EvermindStudioCenter projectId={pid} />
          </div>
        </div>
      </EvermindValidationProvider>
    </div>
  );
}

/* Two-pane layout: on desktop each column is bounded to the pane height and scrolls
   independently (the Knowledge Map stays centred no matter how long the console gets);
   under 900px they stack and the page scrolls naturally. */
const EM_STUDIO_CSS = `
.em-studio-root { height: 100%; overflow: hidden; background: var(--bg-deep); color: var(--text-primary); padding: 20px 24px; box-sizing: border-box; }
.em-studio-row { display: flex; gap: 20px; height: 100%; align-items: stretch; max-width: 1400px; margin: 0 auto; }
.em-studio-rail { flex: 1 1 340px; max-width: 480px; min-width: 300px; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; padding-right: 6px; }
.em-studio-center { flex: 1.6 1 460px; min-width: 320px; min-height: 0; display: flex; }
@media (max-width: 900px) {
  .em-studio-root { overflow-y: auto; }
  .em-studio-row { flex-wrap: wrap; height: auto; align-items: flex-start; }
  .em-studio-rail { flex-basis: 100%; max-width: none; overflow: visible; padding-right: 0; }
  .em-studio-center { flex-basis: 100%; height: 520px; }
}
`;
