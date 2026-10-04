import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { creationObjectDefinition } from '../creationObjectRegistry';
import { Icon } from '@/components/ui/Icon';
import { creativePreviewImageUrl } from '@/lib/creationDeliverables';
import { GAME_FRAME_SANDBOX, gameDocumentFrom, gameRuntimeFor } from '@/lib/gameTargets';
import { controlLabels, readGameControls } from '@/lib/gamePoster';
import type { CreationBodyProps } from './types';
import { useCreationNodeActions } from './nodeActions';
import { AuthoredContent } from './shared';

/**
 * A game object: the game itself, playable on the board.
 *
 * Every other creative kind shows a picture of its artifact because that is the
 * most you can do with a DXF or an MP3 on a canvas. A game is a program, and the
 * only honest preview of a program is running it — so this body IS the game,
 * and "does the thing the model just wrote actually work" is answered by playing
 * it rather than by opening a tab and coming back.
 *
 * ── THE SANDBOX IS LOad-BEARING ─────────────────────────────────────────────
 * The document is model-authored code from a free-text brief. It runs with
 * `allow-scripts` and DELIBERATELY WITHOUT `allow-same-origin`: that combination
 * gives the frame an opaque origin, so the game cannot reach this page's cookies,
 * `localStorage`, session token or DOM. Adding `allow-same-origin` alongside
 * `allow-scripts` would let the frame remove its own sandbox attribute and is
 * equivalent to no sandbox at all.
 *
 * For the same reason the document goes in through `srcDoc` rather than a blob
 * URL — a blob inherits the creating page's origin, which would quietly undo the
 * isolation. `srcDoc` with no `allow-same-origin` cannot.
 *
 * The frame starts inert. It is mounted only once the player asks for it, so a
 * board with a dozen games is not a dozen animation loops competing with the
 * canvas for frames; `nodrag`/`nowheel` keep the pointer inside the game instead
 * of panning the board underneath it.
 */
export function GameBody({ data }: CreationBodyProps) {
  const { openSurface } = useCreationNodeActions();
  const onPlayFull = openSurface ? () => openSurface('play') : undefined;
  const t = useTranslations('creationCanvas.node');
  const [playing, setPlaying] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const document = useMemo(() => gameDocumentFrom(data), [data]);
  const runtime = useMemo(() => gameRuntimeFor(data), [data]);
  const poster = creativePreviewImageUrl(data);
  const controls = useMemo(() => (document ? controlLabels(readGameControls(document)) : []), [document]);

  // Regenerating replaces the artifact; the running frame must be torn down or
  // the board keeps playing the previous game under the new title.
  useEffect(() => { setPlaying(false); setShowDetails(false); }, [runtime, document]);

  if (!runtime) {
    return <div className={styles.creativeStudioBody}>
      {poster
        ? <img src={poster} alt={t('previewAlt', { title: data.title })} width={240} height={118} />
        : <div className={styles.creativeStudioPreview} aria-hidden="true"><span><Icon source={creationObjectDefinition(data.kind).icon} size={24} /></span><i /><i /><i /></div>}
      <AuthoredContent data={data} fallback={t('gameNotGenerated')} />
      <div className={styles.pills}><span>{t('gameGenerateFirst')}</span></div>
    </div>;
  }

  /**
   * A place is played in the 3D runtime, and that does not fit in a card.
   *
   * A `.rbxlx` is a world of positioned parts. The canvas can walk one — but not
   * in 340px through a WebGL context per board object, so the big control here
   * OPENS the play surface rather than mounting an engine in a tile. It is still
   * the same gesture and the same button; only where it lands differs.
   */
  const opensSurface = runtime === 'world';
  const playLabel = opensSurface ? t('gamePlayIn3d') : t('gamePlay');

  const play = () => {
    if (opensSurface) { onPlayFull?.(); return; }
    setPlaying(true);
  };

  return <div className={`${styles.creativeStudioBody} ${styles.gameBody ?? ''}`}>
    <div className={styles.gameStage}>
      {playing && document
        ? <iframe
          className={styles.gameFrame}
          title={t('gamePlayingAlt', { title: String(data.title ?? '') })}
          srcDoc={document}
          // No `allow-same-origin`. See the note above — with `allow-scripts`
          // it would let the frame escape the sandbox entirely.
          sandbox={GAME_FRAME_SANDBOX}
          loading="lazy"
        />
        // THE control on the card, not a badge in the corner of one. A game is a
        // thing you press play on; everything else about it is a detail behind
        // the button, which is why the description moved under a toggle.
        : <button
          type="button"
          className={styles.gamePoster}
          disabled={opensSurface && !onPlayFull}
          onClick={(event) => { event.stopPropagation(); play(); }}
          style={poster ? { backgroundImage: `url("${poster}")` } : undefined}
        >
          <span className={styles.gamePlayBadge} aria-hidden="true"><Icon source="▶" size="1em" /></span>
          <span className={styles.gamePlayLabel}>{playLabel}</span>
        </button>}
    </div>
    <div className={styles.pills}>
      {playing
        ? <button type="button" onClick={(event) => { event.stopPropagation(); setPlaying(false); }}>{t('gameStop')}</button>
        : <button
          type="button"
          aria-expanded={showDetails}
          onClick={(event) => { event.stopPropagation(); setShowDetails((value) => !value); }}
        >{showDetails ? t('gameHideDetails') : t('gameDetails')}</button>}
      {opensSurface
        ? <span>{t('gameRobloxFormat')}</span>
        : controls.map((control) => <span key={control}>{t(control === 'keys' ? 'gameControlKeys' : 'gameControlTouch')}</span>)}
    </div>
    {showDetails && <div className={styles.gameDetails}>
      <AuthoredContent data={data} fallback={opensSurface ? t('gameRobloxReady') : t('gameReady')} />
      {opensSurface && <div className={styles.pills}><span>{t('gameRobloxOpenIn')}</span></div>}
    </div>}
  </div>;
}
