'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { SPAWN_SCENES } from './spawnScenes';
import styles from './spawn.module.css';

interface Game { id: string; icon: string; label: string; ask: string; reply: string }

/** How long the pretend build "thinks" before the scene appears. */
const BUILD_MS = 900;

/**
 * The hero's toy: tap a game, watch Spawn "build" it. It is the page's answer to
 * "what does it do" for a visitor who will not read one — the ask appears in the
 * chat, Spawn answers, and the blocks pop into the Studio viewport. The games are
 * the `spawn.play.games` catalog array; their scenes are `SPAWN_SCENES`.
 */
export function SpawnPlayground() {
  const t = useTranslations('spawn.play');
  const games = t.raw('games') as Game[];
  const [gameId, setGameId] = useState(games[0]!.id);
  const [building, setBuilding] = useState(false);
  const game = games.find((g) => g.id === gameId) ?? games[0]!;

  useEffect(() => {
    if (!building) return;
    const timer = setTimeout(() => setBuilding(false), BUILD_MS);
    return () => clearTimeout(timer);
  }, [building, gameId]);

  const pick = (id: string) => {
    setGameId(id);
    setBuilding(true);
  };

  return (
    <div className={styles.playground}>
      <div className={styles.window}>
        <div className={styles.windowBar}>
          <span className={styles.windowDots} aria-hidden><i /><i /><i /></span>
          <span className={styles.windowTitle}>Spawn</span>
          <span className={styles.connected}>{t('connected')}</span>
        </div>
        <div className={styles.windowBody}>
          <div className={styles.windowChat} aria-live="polite">
            <span className={styles.bubbleMe}>{game.ask}</span>
            {building
              ? <span className={styles.bubble}><span className={styles.thinking} aria-label={t('thinking')}><i /><i /><i /></span></span>
              : <span className={styles.bubble}>{game.reply}</span>}
          </div>
          <div className={styles.windowScene} role="img" aria-label={t('sceneLabel', { game: game.label })}>
            {!building && (SPAWN_SCENES[game.id] ?? []).map((b, i) => (
              <span
                key={`${game.id}-${i}`}
                className={b.round ? styles.blockRound : styles.block}
                style={{
                  left: `${b.left}%`, bottom: `${b.bottom}%`, width: `${b.width}%`, height: `${b.height}%`,
                  background: b.color, '--i': i,
                } as CSSProperties}
              />
            ))}
          </div>
        </div>
      </div>
      <p className={styles.playHint}>{t('pick')}</p>
      <div className={styles.games} role="group" aria-label={t('pick')}>
        {games.map((g) => (
          <button
            key={g.id}
            type="button"
            className={g.id === gameId ? styles.gameOn : styles.game}
            aria-pressed={g.id === gameId}
            onClick={() => pick(g.id)}
          >
            <span className={styles.gameIcon} aria-hidden>{g.icon}</span>
            {g.label}
          </button>
        ))}
      </div>
    </div>
  );
}
