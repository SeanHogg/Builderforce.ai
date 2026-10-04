/** ONE door in front of everything that needs an account or a connected account. */
import { useViewerSession } from '@/lib/viewerSession';
import { type Dispatch, type SetStateAction, useCallback, useState } from 'react';
import { trackActivity } from '@/lib/activity/tracker';
import { canvasSurface } from '@/lib/canvasHost';
import { getStoredTenantToken } from '@/lib/auth';
import { accountGateResult } from '../actions/accountGate';
import type { AccountGate } from '../canvasBoardTypes';
import type { useTranslations } from 'next-intl';

export interface UseCanvasAccountGateDeps {
  sessionId: string;
  setAccountGate: Dispatch<SetStateAction<AccountGate | null>>;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
}

export function useCanvasAccountGate({ sessionId, setAccountGate, t }: UseCanvasAccountGateDeps) {
  // "IS THIS BOARD SAVED?" AND "DOES THIS PERSON HAVE AN ACCOUNT?" ARE DIFFERENT
  // QUESTIONS, AND `persistence` ONLY ANSWERS THE FIRST.
  //
  // It is derived from the session id alone (`isLocalCreationSession` — a `local-…`
  // prefix), so a SIGNED-IN user working on an unsaved board reads as anonymous. Used
  // as a stand-in for "no account" it told a paying user to create an account before
  // they could generate an image, when their own credentials would have authorized the
  // call: image generation posts to `/llm/v1/images/generations` with the tenant token
  // and never touches the session row.
  //
  // Keep the two separate at the source. `persistence` still gates anything that needs
  // a SAVED SESSION to point at (durable object actions, branches, comparisons); this
  // answers only "will a tenant request from this browser authenticate?".
  //
  // Answered by `useViewerSession`, which falls back to the token store rather than
  // requiring `useAuth`, for two reasons: it is the exact value `apiRequest`
  // authorizes with (so it cannot disagree with the call it is predicting), and the
  // canvas mounts in surfaces that have no AuthProvider above them — the VS Code
  // webview, the embed, and the component tests, where `useAuth()` throws.
  const hasAccount = useViewerSession().hasTenant;
  const [claimingDraft, setClaimingDraft] = useState(false);
  const requireAccount = useCallback((action: string, title: string, description: string) => {
    setAccountGate({ action, title, description });
    trackActivity('creation_account_gate_shown', { sessionId, metadata: { clientSurface: canvasSurface(), action } });
  }, [sessionId]);
  /**
   * ONE door in front of everything that reads a CONNECTED ACCOUNT.
   *
   * Cloud storage, Miro, social and paid media all call the API with the tenant
   * token. A signed-out visitor has none, so opening any of them used to fire a
   * request that came back 401 "Missing or malformed Authorization header" — and
   * because the canvas reports API failures as support tickets, a guest tapping
   * along the rail filed five of them in ninety seconds. The condition is the
   * same for every one of these surfaces, so the check, the copy and the
   * sign-up prompt are one function rather than a rule each panel remembers.
   *
   * ── THE IMPERATIVE SIBLING OF `<SessionGate action="connectIntegration">` ────
   * Same question, same answer, two shapes — and the shapes are genuinely
   * different rather than a duplicate: `SessionGate` WRAPS a control, which is
   * what a button in a list needs, while this is called from inside an
   * `onClick` and from the model's own tool handlers, where there is no element
   * to wrap. What must never differ is the CONDITION, so both read "is there a
   * readable workspace behind this screen": the component through
   * `useSampleWorkspace`, which is reactive because it renders, and this
   * through the stored tenant token, which is what an event handler can see.
   *
   * Returns true when the caller may proceed.
   */
  const connectedAccountGate = useCallback((source: string) => {
    if (getStoredTenantToken()) return true;
    requireAccount('connected_account', t('connectedGateTitle', { source }), t('connectedGateBody', { source }));
    return false;
  }, [requireAccount, t]);
  /**
   * ONE door for a guest-GATED canvas TOOL — the model half of `connectedAccountGate`.
   *
   * `accountGateResult` builds the shape the model reads, and every gate string in the
   * contract ends with "The account prompt is now open" — but the builder is a plain
   * function and CANNOT open anything. `canvas_read_attachment` returned it directly, so
   * that sentence was false there: the model told the user a prompt was waiting and no
   * prompt had been raised. The two halves are one call here precisely so the claim and
   * the prompt cannot drift apart again.
   *
   * The CONDITION stays with the caller because it genuinely differs: a corpus needs
   * CREDENTIALS (a signed-in user promotes from an unsaved board), while reading a scan
   * needs a SAVED canvas for the bytes to have been stored at all. Folding both into one
   * predicate would gate each tool on something it does not actually need. What must
   * never differ is this: the prompt opens whenever the gate shape is returned.
   *
   * Returns the gate result to hand straight back to the model.
   */
  const openAccountGate = useCallback((
    tool: string, action: string, title: string, description: string, reason: string,
  ): { requiresAccount: true; tool: string; error: string } => {
    requireAccount(action, title, description);
    return accountGateResult(tool, reason);
  }, [requireAccount]);
  return { connectedAccountGate, requireAccount, openAccountGate, hasAccount, claimingDraft, setClaimingDraft };
}
