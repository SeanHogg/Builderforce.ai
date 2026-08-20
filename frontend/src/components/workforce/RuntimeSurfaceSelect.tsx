'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';

import { Select } from '@/components/Select';
import {
  GithubActionsUnavailableReason,
  useGithubActionsSupported,
} from '@/components/repos/githubActionsSurface';
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
 */

/** Every cloud surface, in the order the picker offers them. */
export const RUNTIME_SURFACE_KEYS: AgentRuntimeSurface[] = ['durable', 'container', 'github_actions'];

/** Surfaces whose availability is a fact about the project, not a constant. */
const CONDITIONAL_SURFACES = new Set<AgentRuntimeSurface>(['github_actions']);

/**
 * Is this surface selection blocked for the project in scope?
 *
 * Exported so a form's SUBMIT can refuse the combination rather than merely
 * discouraging it. It reads the same cached readiness the picker does, so using
 * it costs no extra request and cannot disagree with what the picker rendered —
 * which is exactly what a `canX` boolean passed down from a parent could not
 * promise.
 *
 * Only ever true on a hard `false` readiness; unknown never blocks a save.
 */
export function useRuntimeSurfaceBlocked(surface: AgentRuntimeSurface | string): boolean {
  const supported = useGithubActionsSupported();
  if (!CONDITIONAL_SURFACES.has(surface as AgentRuntimeSurface)) return false;
  return supported === false;
}

export interface RuntimeSurfaceSelectProps {
  value: AgentRuntimeSurface;
  onChange: (surface: AgentRuntimeSurface) => void;
  /** Styling for the underlying control, so the picker inherits its form's look. */
  style?: React.CSSProperties;
  /** Styling for the field label. */
  labelStyle?: React.CSSProperties;
}

export function RuntimeSurfaceSelect({ value, onChange, style, labelStyle }: RuntimeSurfaceSelectProps) {
  const t = useTranslations('cloudAgentForm');
  const actionsSupported = useGithubActionsSupported();
  const reasonId = useId();

  /** A surface the project provably cannot run. `null` (unknown) never disables. */
  const unavailable = (surface: AgentRuntimeSurface): boolean =>
    CONDITIONAL_SURFACES.has(surface) && actionsSupported === false;

  const anyUnavailable = RUNTIME_SURFACE_KEYS.some(unavailable);

  return (
    <div>
      <label style={labelStyle} htmlFor={`${reasonId}-select`}>{t('surface')}</label>
      <Select
        id={`${reasonId}-select`}
        style={style}
        value={value}
        // `aria-describedby` only when the description is actually rendered —
        // pointing at a missing id is a worse experience than pointing at nothing.
        aria-describedby={anyUnavailable ? reasonId : undefined}
        onChange={(e) => onChange(e.target.value as AgentRuntimeSurface)}
      >
        {RUNTIME_SURFACE_KEYS.map((rs) => (
          <option key={rs} value={rs} disabled={unavailable(rs)}>
            {/* The short reason rides in the option's own text: a screen reader
                announces the option, never the prose beside the select. */}
            {unavailable(rs) ? t('surfaceUnavailableOption', { surface: t(`surfaceLabel.${rs}`) }) : t(`surfaceLabel.${rs}`)}
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
