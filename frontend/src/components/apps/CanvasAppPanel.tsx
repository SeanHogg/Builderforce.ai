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
 *
 * ── WHAT "OPEN THE PROJECT" OPENS ────────────────────────────────────────────
 * The project's own card, on this board. Conversion places that card
 * (`placeCanvasObject`), so `/projects/<id>` — which resolves a project to the
 * board that BECAME it — lands on the card rather than, as it once did, on a
 * brand-new empty board. It is a `<Link>` for that reason: the destination board
 * is the one already on the stage, and a document load would tear it down.
 *
 * ── WHERE THE TRIGGER IS DRAWN ───────────────────────────────────────────────
 * A row in the canvas's ••• sheet, not a worded button in the command bar: a
 * board becomes one project, ONCE, so it does not earn permanent width beside
 * the actions somebody presses all day.
 *
 * It carries no chrome class of its own, which is the same decision
 * `CanvasSessionActions variant="menu"` makes for the session actions it puts in
 * that sheet: the host's own `button` rules dress it, so it reads as one of the
 * sheet's rows rather than as a visitor, and a different host dresses it its own
 * way without this file knowing the host exists. What it DOES declare is
 * `data-wide`, because "this label is a sentence" is a fact about the copy and
 * only the host can act on it.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
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
import { useErrorMessage } from '@/i18n/useErrorMessage';
export interface CanvasAppPanelProps {
  /**
   * The SERVER session id. A local board passes null/undefined and this renders
   * nothing — which is the correct answer, not an error state.
   */
  sessionId: string | null | undefined;
  /**
   * The panel opening and closing, for a host whose own chrome has to react —
   * an overflow sheet closes itself once the drawer it launched is dismissed,
   * rather than being left open behind it. The panel still OWNS the state:
   * this reports it, it does not control it, so a host that does not care
   * passes nothing and nothing changes.
   */
  onOpenChange?: (open: boolean) => void;
}

export function CanvasAppPanel({ sessionId, onOpenChange }: CanvasAppPanelProps) {
  const errorMessage = useErrorMessage();
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
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, [sessionId, address, errorMessage]);

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

  const label = app ? t('triggerOpen', { name: app.name }) : t('triggerConvert');
  const glyph = app ? '◆' : '+';
  const setPanel = (next: boolean) => { setOpen(next); onOpenChange?.(next); };

  return (
    <>
      {/* `data-wide` so a two-column sheet gives this row both of its columns: the
          label is a sentence, not the one or two words the glyph rows beside it
          carry. A host that does not lay out in columns ignores it. */}
      <button
        type="button"
        data-wide="true"
        onClick={() => setPanel(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span aria-hidden="true">{glyph}</span>{label}
      </button>

      <SlideOutPanel
        open={open}
        onClose={() => setPanel(false)}
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
                {/* A CLIENT transition, not a document load. `/projects/<id>` resolves
                    to the project's card on its own board, and that board is the one
                    already mounted on the shell's stage — an `<a>` here tore the whole
                    canvas down and rebuilt it to arrive back where it started. */}
                <Link className={styles.primary} href={`/projects/${app.projectId}`}>
                  {t('openProject')}
                </Link>
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
