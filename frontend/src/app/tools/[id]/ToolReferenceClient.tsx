'use client';

/**
 * A diagnostic's reference page (PRD 21 §11.4.5).
 *
 * It used to mount a whole `CreationCanvas` on a public marketing URL, with the
 * tool as the single object on an invisible local board. That was wrong twice
 * over: a tool is a REFERENCE page — signed out an ordinary indexable page,
 * signed in the same component in a panel over a board that stays mounted — and
 * a canvas mounted here was a SECOND board fighting the one the session already
 * had. The canvas is where you *use* the capability (`canvas_add_diagnostic`),
 * not where you read about it.
 *
 * Same full-bleed band layout as `/soc2`, because `ShellPanel` gives a reference
 * page no padding of its own; the sections' `id`s are the panel's index rail.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import RelatedArticles from '@/components/blog/RelatedArticles';
import ToolRunner from '@/components/tools/ToolRunner';
import { ReturningVisitorBanner } from '@/components/tools/ReturningVisitorBanner';
import { Icon } from '@/components/ui/Icon';
import { usePublishReferenceChrome } from '@/lib/referenceChrome';
import type { ToolDefinition } from '@/lib/tools';

/** The panel's index rail — the ids below, in the order they are rendered. */
const SECTION_IDS = ['assess', 'how', 'canvas'] as const;

export default function ToolReferenceClient({ toolId, fallbackName }: { toolId: string; fallbackName: string }) {
  const t = useTranslations('tools');
  const tRef = useTranslations('toolReference');
  const [def, setDef] = useState<ToolDefinition | null>(null);

  // The catalog owns the tool's name, so the panel header is told it rather than
  // the registry guessing "Diagnostics" for all five. Null until it loads, which
  // is the registry row's cue to keep supplying the header.
  usePublishReferenceChrome(def
    ? { title: def.name, sections: SECTION_IDS.map((id) => ({ id, label: tRef(`section.${id}`) })) }
    : null);

  const name = def?.name ?? fallbackName;
  const questionCount = def == null ? 0
    : def.kind === 'calculator' ? def.inputs.length
    : def.kind === 'quiz' ? def.questions.length
    : def.sections.reduce((total, section) => total + section.questions.length, 0);

  return (
    <>
      <style>{`
        .tref { color: var(--text-primary); }
        /* THE marketing column (globals.css) — same measure as the header. */
        .tref-wrap { max-width: var(--marketing-max); margin: 0 auto; padding-inline: var(--marketing-gutter); }
        .tref-hero { text-align: center; padding: clamp(36px, 6vw, 72px) 20px clamp(20px, 4vw, 36px); }
        .tref-eyebrow {
          display: inline-flex; align-items: center; gap: 8px; font-size: var(--font-size-eyebrow); font-weight: 700;
          letter-spacing: 0.14em; text-transform: uppercase; color: var(--coral-bright);
          border: 1px solid var(--border-accent, var(--border-subtle)); border-radius: var(--radius-full); padding: 5px 14px; margin-bottom: 18px;
        }
        .tref-title { font-weight: 800; letter-spacing: -0.03em; line-height: 1.08; font-size: var(--font-size-page-title); margin: 0 auto 14px; max-width: 18ch; }
        .tref-icon { display: block; margin: 0 auto 12px; }
        .tref-sub { font-size: var(--font-size-lede); color: var(--text-secondary); line-height: 1.65; margin: 0 auto 24px; max-width: 62ch; }
        .tref-actions { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
        .tref-btn-primary { display: inline-flex; align-items: center; gap: 8px; padding: 12px 24px; border-radius: var(--radius-lg); background: linear-gradient(135deg, var(--coral-bright), var(--coral-dark)); color: var(--text-on-accent); font-weight: 600; font-size: var(--font-size-body); text-decoration: none; }
        .tref-btn-secondary { display: inline-flex; align-items: center; gap: 8px; padding: 12px 24px; border-radius: var(--radius-lg); border: 1px solid var(--border-subtle); background: var(--surface-card, var(--bg-elevated)); color: var(--text-primary); font-weight: 600; font-size: var(--font-size-body); text-decoration: none; }
        .tref-section { padding: clamp(28px, 5vw, 52px) 0; }
        .tref-section-title { font-weight: 700; font-size: var(--font-size-section); letter-spacing: -0.02em; text-align: center; margin: 0 0 8px; }
        .tref-section-sub { text-align: center; color: var(--text-secondary); font-size: var(--font-size-card-title); max-width: 60ch; margin: 0 auto 28px; line-height: 1.6; }
        .tref-runner { max-width: 820px; margin: 0 auto; }
        .tref-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
        .tref-card { background: var(--surface-card, var(--bg-elevated)); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 18px; }
        .tref-step-n { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: var(--radius-md); background: var(--bg-elevated); border: 1px solid var(--border-subtle); color: var(--coral-bright); font-weight: 800; margin-bottom: 10px; }
        .tref-card h3 { font-weight: 700; font-size: var(--font-size-card-title); margin: 0 0 4px; }
        .tref-card p { color: var(--text-secondary); font-size: var(--font-size-body); line-height: 1.5; margin: 0; }
        .tref-cta { text-align: center; background: var(--surface-card, var(--bg-elevated)); border: 1px solid var(--border-subtle); border-radius: var(--radius-xl); padding: clamp(24px, 4vw, 40px) 24px; }
        .tref-cta h2 { font-size: var(--font-size-section); font-weight: 700; margin: 0 0 10px; }
        .tref-cta p { color: var(--text-secondary); margin: 0 auto 20px; max-width: 56ch; line-height: 1.6; }
        .tref-code { display: inline-block; font-family: var(--font-mono, monospace); font-size: var(--font-size-small); background: var(--bg-base); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 2px 8px; color: var(--text-strong); }
      `}</style>

      <div className="tref">
        <section className="tref-hero">
          <div className="tref-wrap">
            <span className="tref-eyebrow">{t('freeNoLogin')}</span>
            {def && <span className="tref-icon"><Icon source={def.icon} size={34} /></span>}
            <h1 className="tref-title">{name}</h1>
            <p className="tref-sub">{def?.about ?? def?.tagline ?? tRef('lede')}</p>
            <div className="tref-actions">
              <a href="#assess" className="tref-btn-primary">{t('run')} →</a>
              <Link href="/tools" className="tref-btn-secondary">{t('allTools')}</Link>
            </div>
          </div>
        </section>

        {/* Run it. The `id`s from here down are the panel's index rail — they are
            published to `ShellPanel` above, so renaming one here changes both. */}
        <section id="assess" className="tref-section" style={{ paddingTop: 0 }}>
          <div className="tref-wrap">
            <div className="tref-runner">
              <ReturningVisitorBanner toolId={toolId} />
              <ToolRunner toolId={toolId} surface="reference" onDefinitionLoad={setDef} />
            </div>
          </div>
        </section>

        {/* How it is scored */}
        <section id="how" className="tref-section">
          <div className="tref-wrap">
            <h2 className="tref-section-title">{tRef('how.title')}</h2>
            <p className="tref-section-sub">{tRef('how.sub')}</p>
            <div className="tref-grid">
              <div className="tref-card">
                <span className="tref-step-n">1</span>
                <h3>{tRef('how.answer.title')}</h3>
                <p>{questionCount > 0
                  ? tRef('how.answer.bodyCounted', { count: questionCount, kind: t(`kind.${def!.kind}`) })
                  : tRef('how.answer.body')}</p>
              </div>
              <div className="tref-card">
                <span className="tref-step-n">2</span>
                <h3>{tRef('how.score.title')}</h3>
                <p>{tRef('how.score.body')}</p>
              </div>
              <div className="tref-card">
                <span className="tref-step-n">3</span>
                <h3>{tRef('how.track.title')}</h3>
                <p>{def?.hasDataDriven ? tRef('how.track.bodyData') : tRef('how.track.body')}</p>
              </div>
            </div>
          </div>
        </section>

        {/* The same capability, on the board */}
        <section id="canvas" className="tref-section">
          <div className="tref-wrap">
            <div className="tref-cta">
              <h2>{tRef('canvas.title')}</h2>
              <p>{tRef('canvas.body')}</p>
              <p style={{ marginBottom: 22 }}>
                <span className="tref-code">{tRef('canvas.prompt', { name })}</span>
              </p>
              <Link href={`/create/new?prompt=${encodeURIComponent(tRef('canvas.prompt', { name }))}`} className="tref-btn-primary">
                {tRef('canvas.cta')} →
              </Link>
            </div>
            <RelatedArticles surface="diagnostics" heading={tRef('relatedHeading')} />
          </div>
        </section>
      </div>
    </>
  );
}
