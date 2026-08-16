'use client';

/**
 * A diagnostic's reference page (PRD 21 §11.4.5).
 *
 * It used to mount a whole `CreationCanvas` on a public marketing URL, with the
 * tool as the single object on an invisible local board. That was wrong twice
 * over: a tool is a REFERENCE page — signed out an ordinary indexable page,
 * signed in the same component in a panel over a board that stays mounted —
 * and a canvas mounted here was a SECOND board fighting the one the session
 * already had. The canvas is where you *use* the capability
 * (`canvas_add_diagnostic`), not where you read about it.
 *
 * Layout is the house marketing kit via `components/reference/ReferencePage`,
 * the same vocabulary `/soc2` and `/integrations` render through.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import RelatedArticles from '@/components/blog/RelatedArticles';
import { canvasIntentHref } from '@/lib/canvasIntent';
import {
  ReferenceCard, ReferenceCta, ReferenceGrid, ReferenceHero, ReferencePage, ReferenceSection,
} from '@/components/reference/ReferencePage';
import ToolRunner from '@/components/tools/ToolRunner';
import { ReturningVisitorBanner } from '@/components/tools/ReturningVisitorBanner';
import { Icon } from '@/components/ui/Icon';
import type { ToolDefinition } from '@/lib/tools';

/** The panel's index rail — these ids, in the order they are rendered below. */
const SECTION_IDS = ['assess', 'how', 'canvas'] as const;

export default function ToolReferenceClient({ toolId, fallbackName }: { toolId: string; fallbackName: string }) {
  const t = useTranslations('tools');
  const tRef = useTranslations('toolReference');
  const [def, setDef] = useState<ToolDefinition | null>(null);

  const name = def?.name ?? fallbackName;
  // Every kind counts the things a person has to fill in before it will run —
  // an analyzer's are documents to paste rather than questions to answer.
  const questionCount = def == null ? 0
    : def.kind === 'calculator' ? def.inputs.length
    : def.kind === 'quiz' ? def.questions.length
    : def.kind === 'analyzer' ? def.fields.length
    : def.sections.reduce((total, section) => total + section.questions.length, 0);
  const canvasPrompt = tRef('canvas.prompt', { name });

  return (
    // The catalog owns the tool's name, so the panel header is told it rather
    // than the registry guessing "Diagnostics" for all five. Until the
    // definition loads the fallback is the humanized slug, which is also what
    // the crawler and the first paint get.
    <ReferencePage
      title={name}
      sections={SECTION_IDS.map((id) => ({ id, label: tRef(`section.${id}`) }))}
    >
      <ReferenceHero
        eyebrow={t('freeNoLogin')}
        {...(def ? { mark: <Icon source={def.icon} size={34} /> } : {})}
        title={name}
        lede={def?.about ?? def?.tagline ?? tRef('lede')}
        actions={[
          { href: '#assess', label: `${t('run')} →` },
          { href: '/tools', label: t('allTools'), variant: 'ghost' },
        ]}
      />

      {/* Run it. `assess` / `how` / `canvas` are the anchors published to
          `ShellPanel` above, so renaming one here changes both. */}
      <ReferenceSection id="assess">
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <ReturningVisitorBanner toolId={toolId} />
          <ToolRunner toolId={toolId} surface="reference" onDefinitionLoad={setDef} />
        </div>
      </ReferenceSection>

      <ReferenceSection id="how" tint title={tRef('how.title')} sub={tRef('how.sub')}>
        <ReferenceGrid>
          <ReferenceCard mark={1} title={tRef('how.answer.title')}>
            {questionCount > 0
              ? tRef('how.answer.bodyCounted', { count: questionCount, kind: t(`kind.${def!.kind}`) })
              : tRef('how.answer.body')}
          </ReferenceCard>
          <ReferenceCard mark={2} title={tRef('how.score.title')}>{tRef('how.score.body')}</ReferenceCard>
          <ReferenceCard mark={3} title={tRef('how.track.title')}>
            {def?.hasDataDriven ? tRef('how.track.bodyData') : tRef('how.track.body')}
          </ReferenceCard>
        </ReferenceGrid>
      </ReferenceSection>

      <div id="canvas">
        <ReferenceCta
          title={tRef('canvas.title')}
          body={tRef('canvas.body')}
          actions={[{ href: canvasIntentHref(canvasPrompt), label: `${tRef('canvas.cta')} →` }]}
        >
          <p style={{ marginTop: 'var(--space-4)' }}><span className="mk-code">{canvasPrompt}</span></p>
        </ReferenceCta>
      </div>

      <ReferenceSection>
        <RelatedArticles surface="diagnostics" heading={tRef('relatedHeading')} />
      </ReferenceSection>
    </ReferencePage>
  );
}
