/**
 * RENDERING A LAUNCH — the one component that turns a launch payload into pixels.
 *
 * ── WHY IT IS HERE AND NOT IN THE LISTING PAGE ───────────────────────────────────
 * Three surfaces show the same thing and must not diverge:
 *
 *   the marketplace listing page   a stranger running a published creation
 *   the creator's landing page     the second shop window onto the same product
 *   Stage, in the canvas           the SELLER seeing their staged candidate as a
 *                                  buyer would, before it goes on sale
 *
 * The third is the reason this moved. Stage listed every version, ran the harness and
 * refused the publish on a blocker — so a seller read a verdict about their own
 * product without ever seeing it. Fixing that with a second renderer would have made
 * the preview a thing that AGREES WITH the product rather than a thing that IS it,
 * and the whole claim of the surface is "this is what the buyer gets". So the server
 * returns one payload shape from one function and this renders it, whoever asked.
 *
 * ── THE ONE SECURITY INVARIANT ───────────────────────────────────────────────────
 * A game's document is HTML a language model wrote from a free-text brief, and it is
 * about to execute in a visitor's browser on our origin's page. The frame is
 * `sandbox="allow-scripts"` and NEVER `allow-same-origin`, and it is fed by `srcDoc`
 * rather than a blob URL. Either relaxation lets that code reach the app's session —
 * the same invariant `gameNode.test.tsx` pins on the canvas, and it holds here too
 * because this is the surface where the code belongs to a stranger.
 *
 * No `'use client'` of its own: every consumer already declares the boundary, and a
 * directive on a module that is only ever imported by client modules buys nothing.
 */

import { useTranslations } from 'next-intl';
import type { StageCheck } from '@builderforce/creation-canvas-contract';
import type { HostedListingStatus, LaunchPayload } from './creationListings';

/**
 * The styles all three surfaces share.
 *
 * Inline rather than a module because two of the three consumers are route-level
 * pages that already carry their own `<style>` block, and every value is a theme
 * token so the whole thing reads in light and dark without a second palette.
 */
export const LAUNCH_STAGE_CSS = `
  .cl-stage { border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);
              background: var(--surface-card); overflow: hidden; }
  .cl-frame { display: block; width: 100%; height: min(70vh, 640px); border: 0;
              background: var(--bg-base); }
  .cl-objects { display: grid; gap: 10px; padding: 16px;
                grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); }
  .cl-object { border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
               padding: 12px 14px; background: var(--bg-base); min-width: 0; }
  .cl-object h3 { margin: 0 0 4px; font-size: var(--font-size-small); color: var(--text-primary); }
  .cl-object pre { margin: 0; font-size: var(--font-size-eyebrow); color: var(--text-secondary);
                   white-space: pre-wrap; word-break: break-word; max-height: 140px;
                   overflow: auto; }
  .cl-note { margin: 0; font-size: var(--font-size-small); color: var(--text-secondary); }
  .cl-limits { border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);
               padding: 14px 16px; background: var(--surface-card); display: grid; gap: 8px; }
  .cl-limits h3 { margin: 0; font-size: var(--font-size-small); font-weight: 600;
                  color: var(--text-primary); }
  .cl-limit { display: flex; gap: 10px; align-items: flex-start;
              font-size: var(--font-size-small); color: var(--text-secondary); }
  .cl-limit b { color: var(--text-primary); font-weight: 600; }
  .cl-limit span[aria-hidden] { color: var(--tone-warning-mark, var(--text-secondary));
                                font-weight: 700; line-height: 1.5; }
  .cl-hosted { border-radius: var(--radius-lg); padding: 12px 16px;
               font-size: var(--font-size-small); border-left: 3px solid transparent; }
  .cl-hosted[data-state="grace"] { background: var(--tone-warning-bg);
    color: var(--tone-warning-ink); border-left-color: var(--tone-warning-mark); }
  .cl-hosted[data-state="readOnly"], .cl-hosted[data-state="released"] {
    background: var(--tone-danger-bg); color: var(--tone-danger-ink);
    border-left-color: var(--tone-danger-mark); }
`;

/**
 * One renderer per launch mode.
 *
 * `mode` arrives from the server, derived from the listing's kind in the shared
 * registry. Five modes, five renderers, and a sixth sellable kind adds a registry
 * entry rather than a case here.
 */
export function LaunchStage({ launch, name }: { launch: LaunchPayload; name: string }) {
  const t = useTranslations('commerce.stage');

  if (launch.mode === 'play' && launch.document) {
    return (
      <div className="cl-stage">
        {/* allow-scripts and NOTHING else. `allow-same-origin` beside it would give
            model-authored code from a stranger's brief the run of this origin — the
            session included. */}
        <iframe
          className="cl-frame"
          title={t('playFrameTitle', { name })}
          sandbox="allow-scripts"
          srcDoc={launch.document}
        />
      </div>
    );
  }

  if (launch.mode === 'open' && launch.url) {
    return (
      <div className="cl-stage">
        <iframe
          className="cl-frame"
          title={t('siteFrameTitle', { name })}
          sandbox="allow-scripts allow-forms allow-popups"
          src={launch.url}
        />
      </div>
    );
  }

  if (launch.objects?.length) {
    return (
      <div className="cl-stage">
        <div className="cl-objects">
          {launch.objects.slice(0, 12).map((object) => (
            <article key={object.id} className="cl-object">
              <h3>{object.kind}</h3>
              <pre>{summarise(object.canvasData)}</pre>
            </article>
          ))}
        </div>
      </div>
    );
  }

  return <p className="cl-note">{t('nothingToShow')}</p>;
}

/**
 * WHAT THE SELLER WAS TOLD, WHERE THE BUYER CAN READ IT.
 *
 * The rule made visible: a limitation a seller learns in Stage is DECLARED on the
 * listing rather than discovered afterwards. Renders nothing when there is nothing to
 * declare — a "Known limits" heading over an empty list reads as a missing feature —
 * so it decides its own visibility and takes no `show` prop the caller could get
 * wrong.
 */
export function DeclaredLimits({ checks }: { checks?: readonly StageCheck[] }) {
  const t = useTranslations('commerce.stage');
  if (!checks?.length) return null;
  return (
    <section className="cl-limits" aria-label={t('declaredHead')}>
      <h3>{t('declaredHead')}</h3>
      {checks.map((check) => (
        <p key={check.code} className="cl-limit">
          <span aria-hidden="true">!</span>
          <span><b>{check.label}</b>{check.detail ? ` — ${check.detail}` : ''}</span>
        </p>
      ))}
    </section>
  );
}

/**
 * WHETHER THE THING YOU SUBSCRIBE TO IS STILL RUNNING.
 *
 * Silent while it is `operating`, which is the overwhelming majority of the time and
 * the only state a banner would be noise in. Every other state is something the
 * person reading it can act on: wait, export, or take the build.
 */
export function HostedStatusNote({ hosted }: { hosted?: HostedListingStatus | null }) {
  const t = useTranslations('commerce.stage');
  if (!hosted || hosted.state === 'operating') return null;
  return (
    <p className="cl-hosted" data-state={hosted.state} role="status">
      {t(`hosted.${hosted.state}`, { days: hosted.daysUntilNextState ?? 0 })}
    </p>
  );
}

/** A short, readable digest of a canvas card for the preview grid. Bounded on
 *  purpose — this is a shop window, not a data dump. */
function summarise(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const entries = Object.entries(data as Record<string, unknown>)
    .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
    .slice(0, 6);
  return entries.map(([key, value]) => `${key}: ${String(value).slice(0, 80)}`).join('\n');
}
