import { useId } from 'react';
import { useTranslations } from 'next-intl';

import { Select } from '@/components/Select';
import { GithubActionsUnavailableReason } from '@/components/repos/githubActionsSurface';
import { useGithubActionsSupported } from '@/lib/useGithubActionsReadiness';
import type { AgentRuntimeSurface } from '@/lib/api';

/**
 * The cloud execution-surface picker — the ONE place a surface is chosen.
 *
 * WHY THIS IS A COMPONENT AND NOT A `<Select>` IN A FORM
 * `github_actions` is only runnable on a project whose repo carries the agent
 * workflow. The picker used to offer it unconditionally and warn underneath when
 * it was not runnable, which meant the form could still be submitted: dispatch
 * then quietly degraded to the durable executor and explained itself in the run
 * timeline, after the fact. A warning that does not stop the thing it warns about
 * is a slower way to reach the same wrong outcome.
 *
 * Hard-disabling it needs the readiness answer INSIDE the option, and the obvious
 * ways to get it there are both wrong: a `canUseActions` prop drilled from every
 * parent duplicates the rule at each call site (and goes stale), while a second
 * readiness hook per consumer means N requests for one fact. So the option owns
 * its own readiness — `useGithubActionsSupported` — and the browser's
 * read-through cache collapses every consumer's ask into ONE in-flight request.
 * Source-control settings, this picker, and {@link useRuntimeSurfaceBlocked} all
 * read it independently and all share that single call.
 *
 * ACCESSIBILITY — a disabled option is silent about why. So the option's own
 * label carries the short reason (screen readers announce option text, not
 * sibling prose), the full explanation renders as a live region whenever the
 * surface is unavailable rather than only once it is selected, and the select
 * points at that explanation with `aria-describedby`.
 *
 * UNKNOWN IS NOT NO. Readiness is tri-state: `true`, `false`, and `null` for "no
 * project in scope / still loading / the read failed". Only a hard `false`
 * disables anything — disabling on an unknown would make a perfectly good
 * configuration unreachable whenever an unrelated endpoint has a bad minute.
 *
 * ONE CLOUD RUNTIME. There is no separate "container" surface to choose any more:
 * every cloud run, on every plan, runs the same engine, and it gets a real shell and a
 * clone of the repo whenever the platform can provide one. The plan decides only what
 * the run is charged against (the monthly cloud-run allowance), never where it runs —
 * so nothing here is plan-gated. The one conditional choice left is `github_actions`.
 */

/**
 * What the picker offers. `''` is AUTOMATIC — it leaves `ide_agents.runtime_surface`
 * unset, and the server runs the agent on the cloud runtime (or the repo's GitHub Actions
 * runners when it was set up for them). `'durable'` pins the cloud runtime explicitly.
 */
export type RuntimeSurfaceChoice = Exclude<AgentRuntimeSurface, 'container'> | '';

/** Every choice, in the order the picker offers them. */
export const RUNTIME_SURFACE_KEYS: RuntimeSurfaceChoice[] = ['', 'durable', 'github_actions'];

/**
 * A stored surface as a picker choice. `'container'` is a LEGACY value from when the
 * container was a separate, paid surface; the server runs it on the one cloud runtime,
 * so it reads (and re-saves) as that choice.
 */
export function runtimeSurfaceChoice(stored: string | null | undefined): RuntimeSurfaceChoice {
  if (stored === 'container' || stored === 'durable') return 'durable';
  if (stored === 'github_actions') return 'github_actions';
  return '';
}

/**
 * Why this surface selection is refused, localized — or null when it is fine.
 *
 * Exported so a form's SUBMIT can refuse the combination rather than merely
 * discouraging it. It reads the same cached readiness and entitlement the picker
 * disables on, so using it costs no extra request and cannot disagree with what the
 * picker rendered — which is exactly what a `canX` boolean passed down from a parent
 * could not promise.
 *
 * It returns the MESSAGE, not a boolean, so both submit paths show the one wording
 * instead of each rebuilding it from the surface key.
 *
 * Only ever non-null on a hard `false`; unknown never blocks a save.
 */
export function useRuntimeSurfaceRefusal(surface: RuntimeSurfaceChoice | string): string | null {
  const t = useTranslations('cloudAgentForm');
  const supported = useGithubActionsSupported();
  if (surface === 'github_actions' && supported === false) {
    return t('errSurfaceBlocked', { surface: t('surfaceLabel.github_actions') });
  }
  return null;
}

/** Boolean form of {@link useRuntimeSurfaceRefusal}, for a disabled state with no copy. */
export function useRuntimeSurfaceBlocked(surface: RuntimeSurfaceChoice | string): boolean {
  return useRuntimeSurfaceRefusal(surface) !== null;
}

export interface RuntimeSurfaceSelectProps {
  value: RuntimeSurfaceChoice;
  onChange: (surface: RuntimeSurfaceChoice) => void;
  /** Styling for the underlying control, so the picker inherits its form's look. */
  style?: React.CSSProperties;
  /** Styling for the field label. */
  labelStyle?: React.CSSProperties;
}

export function RuntimeSurfaceSelect({ value, onChange, style, labelStyle }: RuntimeSurfaceSelectProps) {
  const t = useTranslations('cloudAgentForm');
  const actionsSupported = useGithubActionsSupported();
  const reasonId = useId();

  /** A surface this project provably cannot run. `null` (unknown) never disables. */
  const unavailable = (surface: RuntimeSurfaceChoice): boolean =>
    surface === 'github_actions' && actionsSupported === false;

  return (
    <div>
      <label style={labelStyle} htmlFor={`${reasonId}-select`}>{t('surface')}</label>
      <Select
        id={`${reasonId}-select`}
        style={style}
        value={value}
        // `aria-describedby` only when the description is actually rendered —
        // pointing at a missing id is a worse experience than pointing at nothing.
        aria-describedby={actionsSupported === false ? reasonId : undefined}
        onChange={(e) => onChange(runtimeSurfaceChoice(e.target.value))}
      >
        {RUNTIME_SURFACE_KEYS.map((rs) => (
          <option key={rs || 'auto'} value={rs} disabled={unavailable(rs)}>
            {/* The short reason rides in the option's own text: a screen reader
                announces the option, never the prose beside the select. */}
            {rs === ''
              ? t('surfaceLabel.auto')
              : unavailable(rs) ? t('surfaceUnavailableOption', { surface: t(`surfaceLabel.${rs}`) }) : t(`surfaceLabel.${rs}`)}
          </option>
        ))}
      </Select>
      <p style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--muted)', margin: '6px 0 0' }}>{t('surfaceHelp')}</p>
      {/* Self-gating: renders only on a positive "not enabled", and says which of
          the two fixes applies (connect a GitHub repo vs commit the workflow). */}
      <GithubActionsUnavailableReason id={reasonId} />
    </div>
  );
}
