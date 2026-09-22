'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';

import { Select } from '@/components/Select';
import { GithubActionsUnavailableReason } from '@/components/repos/githubActionsSurface';
import { useGithubActionsSupported } from '@/lib/useGithubActionsReadiness';
import { useConsumption } from '@/lib/useConsumption';
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
 * TWO CONDITIONAL SURFACES, ONE RULE. `container` is conditional for a different
 * reason than `github_actions`: not "this project cannot run it" but "this plan does
 * not cover it". A container is billable Cloudflare compute held open for the length
 * of a run, so a free workspace runs on the durable (serverless) surface, and the
 * server DEMOTES an explicit `container` it is not entitled to. Offering the option
 * anyway would be the same after-the-fact degrade this component was written to stop.
 * Entitlement comes from the server's resolved feature set, never from the plan name.
 */

/**
 * What the picker offers. `''` is AUTOMATIC — it leaves `ide_agents.runtime_surface`
 * unset, and the server resolves the surface per plan at dispatch time (container on a
 * paid workspace, durable on a free one). It is first and it is the default for a new
 * agent, because the form used to hard-code `'durable'`: every agent created in the UI
 * pinned itself to the shell-less surface forever, which is a large part of why the
 * container surface was never reached. Choosing a concrete surface here still means
 * "this one, always" — including after an upgrade.
 */
export type RuntimeSurfaceChoice = AgentRuntimeSurface | '';

/** Every choice, in the order the picker offers them. */
export const RUNTIME_SURFACE_KEYS: RuntimeSurfaceChoice[] = ['', 'durable', 'container', 'github_actions'];

/**
 * Is the billable container surface covered by this workspace's plan?
 *
 * Tri-state like the Actions readiness above: `null` until the consumption snapshot
 * (which carries the SERVER's resolved entitlements) arrives, so a slow or failed read
 * never locks a configuration the workspace is entitled to. Served from the same cached
 * snapshot the meters and navigation already read — no extra request.
 */
function useContainerRuntimeEntitled(): boolean | null {
  const features = useConsumption()?.features;
  const entitled = features?.entitled?.containerRuntime;
  return entitled ?? null;
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
 * It returns the MESSAGE, not a boolean, because the two refusals are different facts
 * and read differently ("this project cannot run it" vs "your plan does not cover it").
 * Both submit paths were each rebuilding that sentence from the surface key, which meant
 * one generic wording for both — and a new reason would have had to be added twice.
 *
 * Only ever non-null on a hard `false`; unknown never blocks a save.
 */
export function useRuntimeSurfaceRefusal(surface: RuntimeSurfaceChoice | string): string | null {
  const t = useTranslations('cloudAgentForm');
  const supported = useGithubActionsSupported();
  const containerEntitled = useContainerRuntimeEntitled();
  if (surface === 'github_actions' && supported === false) {
    return t('errSurfaceBlocked', { surface: t('surfaceLabel.github_actions') });
  }
  if (surface === 'container' && containerEntitled === false) {
    return t('errSurfaceBlockedPlan', { surface: t('surfaceLabel.container') });
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
  const containerEntitled = useContainerRuntimeEntitled();
  const reasonId = useId();
  const containerReasonId = `${reasonId}-container`;

  /** A surface this project or plan provably cannot run. `null` (unknown) never disables. */
  const unavailable = (surface: RuntimeSurfaceChoice): boolean => {
    if (surface === 'github_actions') return actionsSupported === false;
    if (surface === 'container') return containerEntitled === false;
    return false;
  };

  const containerLocked = unavailable('container');

  return (
    <div>
      <label style={labelStyle} htmlFor={`${reasonId}-select`}>{t('surface')}</label>
      <Select
        id={`${reasonId}-select`}
        style={style}
        value={value}
        // `aria-describedby` only when the description is actually rendered —
        // pointing at a missing id is a worse experience than pointing at nothing.
        aria-describedby={[
          actionsSupported === false ? reasonId : null,
          containerLocked ? containerReasonId : null,
        ].filter(Boolean).join(' ') || undefined}
        onChange={(e) => onChange(e.target.value as AgentRuntimeSurface)}
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
      {containerLocked ? (
        <p id={containerReasonId} role="status" style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--muted)', margin: '6px 0 0' }}>
          {t('surfaceContainerLocked')}
        </p>
      ) : null}
    </div>
  );
}
