/**
 * "MAKE THIS A PROJECT" — the one click the whole *project IS the app* decision
 * rests on, which until now existed only on the server.
 *
 * ── WHAT WAS MISSING ─────────────────────────────────────────────────────────
 * `POST /api/creation-sessions/:id/convert-to-app` and
 * `GET /api/creation-sessions/address-available` have been live and called by
 * NOTHING. A person who had just designed something on a board had no action
 * that turned it into a project, so everything a project already carries — a
 * kanban board, tickets, the agent workforce, a manager, an address, releases
 * with rollback — was unreachable from the surface where every idea starts.
 *
 * ── WHY IT MOUNTS ITSELF ─────────────────────────────────────────────────────
 * This takes a `sessionId` and NOTHING ELSE. It does not take a `canConvert`
 * boolean, because every input to that decision — has this board already become
 * an app, may this reader convert it — is server state this component can read
 * for itself, and a prop would put the rule in the caller where the next caller
 * would get it wrong. It renders `null` for a board with no server session
 * (a local, signed-out canvas has nothing to convert) and for a reader who
 * cannot convert and has no app to look at.
 *
 * ── WHY THE ADDRESS IS CHOSEN HERE AND NOT AT PUBLISH ────────────────────────
 * The name used to be derived from the project name during `publishStaticSite`,
 * so a creator found out what their app was called by shipping it. Conversion
 * claims it up front, which is only honest if the creator gets to type it — so
 * the field is on this panel, validated live, before the button is pressed.
 *
 * A slide-out rather than a modal: this is a form, and centred dialogs are
 * reserved for terminal destructive approvals.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import {
  canConvertSession,
  embeddedAppsApi,
  type AddressAvailability,
  type SessionAppState,
} from '@/lib/embeddedApps';
import { AppAddressField } from './AppAddressField';
import { AppAddress, AppStatement } from './AppStatement';
import styles from './appPanels.module.css';

export interface CanvasAppPanelProps {
  /**
   * The SERVER session id. A local board passes null/undefined and this renders
   * nothing — which is the correct answer, not an error state.
   */
  sessionId: string | null | undefined;
}

export function CanvasAppPanel({ sessionId }: CanvasAppPanelProps) {
  const t = useTranslations('canvas.app');
  const [state, setState] = useState<SessionAppState | null>(null);
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState('');
  const [availability, setAvailability] = useState<AddressAvailability | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) { setState(null); return; }
    let live = true;
    embeddedAppsApi.sessionAppState(sessionId)
      .then((next) => { if (live) setState(next); })
      // A board this reader cannot read at all is not this component's problem
      // to report — it simply has nothing to say about it.
      .catch(() => { if (live) setState(null); });
    return () => { live = false; };
  }, [sessionId]);

  // ONE source for the address, whether it was claimed a second ago or a month
  // ago: the site row's server-built URL. The session read carries the label and
  // cannot carry the hosting apex, so concatenating one here would be a second
  // copy of a deployment constant.
  const projectId = state?.app?.projectId;
  useEffect(() => {
    if (projectId === undefined) { setUrl(null); return; }
    let live = true;
    embeddedAppsApi.appAddress(projectId).then((next) => { if (live) setUrl(next); });
    return () => { live = false; };
  }, [projectId]);

  // The address defaults to the board's own title, which is what the server
  // would have used anyway — the field starts pre-filled rather than empty so
  // the common case is one click, not one click and a name.
  useEffect(() => {
    if (open && state && !state.app) setAddress((current) => current || state.title);
  }, [open, state]);

  const convert = useCallback(async () => {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      await embeddedAppsApi.convertToApp(sessionId, address);
      // Re-read rather than patch local state: the conversion already
      // invalidated both cache keys, so this is the same one round-trip the
      // next mount would make and there is no second version of the truth.
      setState(await embeddedAppsApi.sessionAppState(sessionId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [sessionId, address]);

  if (!sessionId || !state) return null;

  const app = state.app;
  const mayConvert = canConvertSession(state.role);
  // Nothing to offer and nothing to report: a viewer on a board that is still
  // just a board. Deciding this here is the whole point of self-mounting.
  if (!app && !mayConvert) return null;

  // The label is known the moment the board is an app; the URL arrives with the
  // site read. Showing the label while that is in flight beats an empty box.
  const hasAddress = !!(url ?? app?.subdomain);
  const addressUsable = !!availability?.label && availability.available;

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span aria-hidden="true">{app ? '◆' : '+'}</span>
        <span className={styles.triggerLabel}>
          {app ? t('triggerOpen', { name: app.name }) : t('triggerConvert')}
        </span>
      </button>

      <SlideOutPanel
        open={open}
        onClose={() => setOpen(false)}
        crumb={t('crumb')}
        title={app ? t('titleConverted') : t('titleConvert')}
        width="sheet"
        widthStorageKey="canvas-app"
      >
        <div className={styles.panel}>
          {error && <p className={styles.error} role="alert">{error}</p>}

          {app ? (
            <>
              <p className={styles.lede}>{t('convertedLede', { name: app.name })}</p>

              <AppStatement
                title={t('sectionAddress')}
                statement={hasAddress ? t('addressIs') : t('addressPending')}
                badge={hasAddress
                  ? { label: t('badgeReserved'), tone: 'ok' }
                  : { label: t('badgeNoAddress'), tone: 'pending' }}
              >
                <AppAddress url={url} fallback={app.subdomain} />
              </AppStatement>

              <AppStatement
                title={t('sectionRuntime')}
                statement={t('runtimeStatement')}
                detail={t('runtimeNoChoice')}
              />

              <AppStatement
                title={t('sectionOwn')}
                statement={t('ownStatement')}
                detail={t('ownDetail')}
              />

              <div className={styles.actions}>
                <a className={styles.primary} href={`/projects/${app.projectId}`}>
                  {t('openProject')}
                </a>
              </div>
            </>
          ) : (
            <>
              <p className={styles.lede}>{t('convertLede')}</p>

              <AppStatement
                title={t('sectionWhatHappens')}
                statement={t('whatHappensStatement')}
                detail={t('whatHappensDetail')}
              />

              <AppAddressField
                value={address}
                onChange={setAddress}
                onAvailability={setAvailability}
                disabled={busy}
              />

              <AppStatement
                title={t('sectionRuntime')}
                statement={t('runtimeStatement')}
                detail={t('runtimeNoChoice')}
              />

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => void convert()}
                  disabled={busy || !addressUsable}
                >
                  {busy ? t('converting') : t('convertAction')}
                </button>
              </div>
              <p className={styles.hint}>{t('convertReversibleHint')}</p>
            </>
          )}
        </div>
      </SlideOutPanel>
    </>
  );
}
