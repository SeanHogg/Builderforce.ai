'use client';

/**
 * Gate an ACTION on having an account — the third member of a family, written to
 * the contract the other two already set.
 *
 * `RoleGate` gates on a capability: *we do not hide features behind roles — we
 * render them disabled and indicate the role required.* `UpgradeGate` gates on a
 * plan: *inline, not a modal, so the wall reads as "this specific view needs a
 * higher plan".* Both INDICATE the gate and leave the surface standing.
 *
 * Session was the odd one out. It was enforced by replacing the whole screen
 * with a marketing page, so ninety-nine routes showed a visitor an advert
 * instead of the thing the advert was about. This is session joining the other
 * two: the surface renders, the sample workspace fills it, and the wall lands on
 * the ACTIONS that genuinely need an account — invoking an agent, connecting an
 * integration, publishing, inviting, paying. Reads are free; anything that
 * spends money, leaves the browser, or would have to be written to a workspace
 * asks for one.
 *
 *   <SessionGate action="runAgent">
 *     <button onClick={dispatch}>Run</button>
 *   </SessionGate>
 *
 * It decides its own state from {@link useSampleWorkspace} — no consumer passes
 * a `canX` boolean, for the same reason `RoleGate` refuses one: a boolean
 * computed by the caller is a rule with as many copies as there are callers.
 */

import React from 'react';
import { useTranslations } from 'next-intl';
import { useSampleWorkspace } from '@/domains/guest/presentation/useSampleWorkspace';
import { GuestGateNotice } from '@/components/guest/GuestGateNotice';

/**
 * What the visitor was trying to do. A closed union rather than free text: the
 * reason is LOCALIZED (`guest.gate.reason.<action>`), so an arbitrary string
 * would be an English sentence in five catalogs' worth of holes.
 *
 * Add an action by adding the key to all five catalogs — the ratchet in
 * `check-i18n-keys` is what makes that a build failure rather than a surprise in
 * production German.
 */
export type GatedAction =
  /** Dispatch a run to an agent. */
  | 'runAgent'
  /** Produce something with a model — compile, draft, summarise, extract.
   *  Distinct from `runAgent`: no agent is dispatched, but a model is billed,
   *  so every guest-reachable surface that reaches one gates on this. */
  | 'generate'
  /** Connect a repository, a mailbox, an ad account — anything with a token. */
  | 'connectIntegration'
  /** Publish to the marketplace, or share outside the browser. */
  | 'publish'
  /** Invite a person to the workspace. */
  | 'invite'
  /** Anything that spends money. */
  | 'pay'
  /** Persist this work so it is still here tomorrow. */
  | 'save';

export interface SessionGateProps {
  action: GatedAction;
  children: React.ReactNode;
  /** 'inline' (default) wraps one control; 'block' dims a whole panel. */
  variant?: 'inline' | 'block';
  className?: string;
  style?: React.CSSProperties;
}

export function SessionGate({ action, children, variant = 'inline', className, style }: SessionGateProps) {
  const { ready, signedIn } = useSampleWorkspace();
  const t = useTranslations('guest');

  // `signedIn`, NOT `isSample`. The two are different questions and only one of
  // them is this component's: a guest on a local-first canvas is looking at
  // their OWN work rather than the sample workspace — so the notice stays away
  // — but hiring an agent from that board still needs an account. Gating on
  // "the data is sample" would have quietly let every guarded action through on
  // exactly the surface a guest spends the most time on.
  //
  // Until the session has been read, render the control as-is: showing a wall to
  // somebody who turns out to be signed in is worse than one frame of a live
  // button, and every one of these actions is refused server-side regardless.
  if (!ready || signedIn) return <>{children}</>;

  return (
    <GuestGateNotice reason={t(`gate.reason.${action}`)} variant={variant} className={className} style={style}>
      {children}
    </GuestGateNotice>
  );
}
