'use client';

/**
 * "Play it somewhere real" — the panel behind a game object's Ship button.
 *
 * A generated game is playable on the canvas the moment it exists (see
 * `GameBody`). This panel is about the other four answers: the phone, the two
 * app stores, and Roblox. It renders whatever target catalogue the server sends
 * rather than a list declared here, so a sixth target is an adapter and no
 * frontend change.
 *
 * Two deliberate shapes:
 *
 *  - The phone target leads, and once published it shows a QR CODE. Typing an
 *    address into a phone keyboard is where this flow actually dies; a code you
 *    point a camera at is the difference between "it works" and "he is playing
 *    it". Everything else in the panel is secondary to that.
 *
 *  - Blocking setup steps are shown as work still to do, never hidden. A target
 *    that says it is ready when it needs an Apple certificate or a Roblox
 *    experience that does not exist yet is worse than one that says nothing.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { qrSvg } from '@/lib/qrCode';
import {
  GAME_DEVICE_ICON,
  gameApi,
  type GamePayload,
  type GameTargetKey,
  type GameTargetState,
  type GameTargetsView,
} from '@/lib/gameTargets';
import styles from './CreationCanvas.module.css';

export interface CanvasGamePanelProps {
  open: boolean;
  onClose: () => void;
  /** Null when the game object is not connected to a project — see the notice. */
  projectId: number | null;
  game: GamePayload | null;
  /** Surfaced through the canvas's own notice bar, so messaging stays in one place. */
  onNotice: (message: string) => void;
}

type Busy = GameTargetKey | 'publish' | 'roblox' | null;

export function CanvasGamePanel({ open, onClose, projectId, game, onNotice }: CanvasGamePanelProps) {
  const t = useTranslations('creationCanvas.game');
  const [view, setView] = useState<GameTargetsView | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [universeId, setUniverseId] = useState('');
  const [placeId, setPlaceId] = useState('');

  const load = useCallback(async () => {
    if (projectId == null) return;
    try {
      const next = await gameApi.get(projectId);
      setView(next);
      const roblox = next.states.find((state) => state.target === 'roblox');
      if (roblox?.robloxUniverseId) setUniverseId(roblox.robloxUniverseId);
      if (roblox?.robloxPlaceId) setPlaceId(roblox.robloxPlaceId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [projectId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const stateFor = useMemo(() => {
    const bySlug = new Map<GameTargetKey, GameTargetState>();
    for (const state of view?.states ?? []) {
      if (!game || state.slug === slugOf(game.title)) bySlug.set(state.target, state);
    }
    return bySlug;
  }, [view, game]);

  const run = useCallback(
    async (key: Busy, work: () => Promise<string>) => {
      setBusy(key);
      setError(null);
      try {
        onNotice(await work());
        await load();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(null);
      }
    },
    [load, onNotice],
  );

  const published = stateFor.get('pwa')?.playUrl ?? null;
  const qr = useMemo(
    () => (published ? qrSvg(published, { size: 176 }) : null),
    [published],
  );

  return <SlideOutPanel open={open} onClose={onClose} title={t('title')} width="min(620px, 96vw)">
    <div className={styles.gamePanel}>
      {projectId == null && <p className={styles.gamePanelNotice}>{t('needProject')}</p>}
      {!game && <p className={styles.gamePanelNotice}>{t('needGame')}</p>}
      {error && <p className={styles.gamePanelError} role="alert">{error}</p>}

      {/* The phone lead — a published game and the code that gets it onto a device. */}
      {projectId != null && game && <section className={styles.gamePhoneLead}>
        <div>
          <h3>{t('phoneTitle')}</h3>
          <p>{published ? t('phoneScan') : t('phoneIntro')}</p>
          {published && <a href={published} target="_blank" rel="noopener noreferrer">{published}</a>}
          <div className={styles.gamePanelActions}>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => run('publish', async () => {
                const result = await gameApi.publish(projectId, game);
                return t('published', { url: result.url });
              })}
            >{busy === 'publish' ? t('publishing') : published ? t('republish') : t('publish')}</button>
          </div>
          {published && <ul className={styles.gameInstallHints}>
            <li>{t('installIos')}</li>
            <li>{t('installAndroid')}</li>
          </ul>}
        </div>
        {qr && <div
          className={styles.gameQr}
          // The QR is generated markup from a URL this app just produced, not
          // user input; it is inlined so it scales crisply rather than being
          // resampled through an <img>.
          dangerouslySetInnerHTML={{ __html: qr }}
          aria-label={t('qrAlt')}
        />}
      </section>}

      {/* Every target the server advertises. */}
      <section className={styles.gameTargetList}>
        {(view?.targets ?? []).map((target) => {
          const state = stateFor.get(target.key);
          const blocking = (state?.setupSteps ?? []).filter((step) => step.blocking);
          return <article key={target.key} className={styles.gameTargetCard}>
            <header>
              <span aria-hidden="true">{GAME_DEVICE_ICON[target.device]}</span>
              <div>
                <strong>{target.label}</strong>
                <p>{target.summary}</p>
              </div>
              {target.zeroSetup && <span className={styles.gameZeroSetup}>{t('zeroSetup')}</span>}
            </header>

            {state?.detail && <p className={styles.gameTargetDetail}>{state.detail}</p>}
            {state && <p className={styles.gameTargetFiles}>
              {t('wroteFiles', { count: state.fileCount, directory: state.directory })}
            </p>}

            {blocking.length > 0 && <ul className={styles.gameSetupSteps}>
              {blocking.map((step) => <li key={step.key}>
                <strong>{step.label}</strong>
                <span>{step.detail}</span>
                {step.url && <a href={step.url} target="_blank" rel="noopener noreferrer">{t('openLink')}</a>}
              </li>)}
            </ul>}

            <div className={styles.gamePanelActions}>
              <button
                type="button"
                disabled={busy !== null || projectId == null || !game}
                onClick={() => projectId != null && game && run(target.key, async () => {
                  const result = await gameApi.materialize(projectId, target.key, game);
                  return t('materialized', { label: target.label, count: result.files.length });
                })}
              >{busy === target.key ? t('building') : state ? t('rebuild') : t('build')}</button>
              {state?.playUrl && <a
                className={styles.gamePlayLink}
                href={state.playUrl}
                target="_blank"
                rel="noopener noreferrer"
              >{t('openIt')}</a>}
            </div>

            {/* Roblox needs an experience that already exists — Open Cloud can
                replace a place but cannot create one. The ids say which. */}
            {target.key === 'roblox' && <div className={styles.gameRoblox}>
              <label>
                <span>{t('universeId')}</span>
                <input
                  value={universeId}
                  onChange={(event) => setUniverseId(event.target.value)}
                  inputMode="numeric"
                  placeholder="0000000000"
                />
              </label>
              <label>
                <span>{t('placeId')}</span>
                <input
                  value={placeId}
                  onChange={(event) => setPlaceId(event.target.value)}
                  inputMode="numeric"
                  placeholder="0000000000"
                />
              </label>
              <p className={styles.gameTargetFiles}>{t('robloxIdsHint')}</p>
              {(view?.credentials.roblox ?? []).filter((credential) => !credential.present).map((credential) =>
                <p key={credential.name} className={styles.gamePanelNotice}>
                  {credential.label}
                  {credential.url && <> — <a href={credential.url} target="_blank" rel="noopener noreferrer">{t('openLink')}</a></>}
                </p>)}
              <div className={styles.gamePanelActions}>
                <button
                  type="button"
                  disabled={busy !== null || projectId == null || !game || !universeId.trim() || !placeId.trim()}
                  onClick={() => projectId != null && game && run('roblox', async () => {
                    const result = await gameApi.publishToRoblox(projectId, game, universeId.trim(), placeId.trim());
                    return t('robloxPublished', { version: result.versionNumber });
                  })}
                >{busy === 'roblox' ? t('publishing') : t('publishRoblox')}</button>
              </div>
            </div>}
          </article>;
        })}
      </section>
    </div>
  </SlideOutPanel>;
}

/** Mirrors the server's slug rule, so a state row matches the game on screen. */
function slugOf(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'builderforce-game'
  );
}
