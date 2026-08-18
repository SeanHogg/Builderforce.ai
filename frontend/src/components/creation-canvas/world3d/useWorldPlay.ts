import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasWorldProp, CanvasWorldScene } from '@builderforce/creation-canvas-contract';

/**
 * The rules that turn walking a space into PLAYING it.
 *
 * ── WHY THIS EXISTS AT ALL ────────────────────────────────────────────────
 * `world.ts` deliberately imported the 3D runtime WITHOUT challenges or
 * scoring, because authoring a space does not need them. Playing a game does.
 * A Roblox place read into this runtime arrives with its gameplay parts already
 * marked — `collectible`, `goal`, `hazard` are the three sensor kinds, and they
 * are sensors precisely because they are the parts you are meant to touch — so
 * the level already says what the game is. Without a reader for that, pressing
 * Play on a game gave you a walking tour of the level and no way to win, which
 * is the difference between a preview and a game.
 *
 * ── WHAT IT DOES NOT CLAIM ────────────────────────────────────────────────
 * These are not the place's own rules. A Roblox place's Luau runs on a
 * server-authoritative engine that is not this browser, and pretending
 * otherwise would be the same class of lie as a play button that does nothing.
 * What this runs is the level's own SHAPE: collect what is collectable, avoid
 * what is marked dangerous, reach the goal. The surface says which of the two
 * you are playing, and the place still ships to Roblox with its scripts intact.
 *
 * Kept out of the R3F tree on purpose: it is state and arithmetic, so it is a
 * hook the host owns, and the scene it hands back is what the renderer draws.
 * That is also what makes it testable without a WebGL context.
 */

export interface WorldPlayState {
  /** Collectibles picked up, by prop id. */
  collected: readonly string[];
  /** How many there are to pick up. Zero means this level is not a collect-athon. */
  total: number;
  /** Hazard touches. The walker respawns on each one; nothing is lost but progress. */
  hits: number;
  /** The goal was reached with everything collected. */
  won: boolean;
  /** Whether this level has anything to win at all — a pure sandbox has not. */
  playable: boolean;
}

export interface WorldPlay {
  state: WorldPlayState;
  /** The scene as it should be DRAWN: collected props are gone from it. */
  scene: CanvasWorldScene;
  /** Wired to every sensor prop by the renderer. */
  onPlayerEnter: (prop: CanvasWorldProp) => void;
  /** Bumped by a hazard, and by an explicit restart. */
  respawnNonce: number;
  restart: () => void;
}

const EMPTY: WorldPlayState = { collected: [], total: 0, hits: 0, won: false, playable: false };

/**
 * How long a hazard stays spent after it bites, in milliseconds.
 *
 * "One respawn per touch" is not enough on its own, because a respawn is itself a way
 * back into the hazard: the walker leaves the sensor (a genuine exit), falls from a
 * spawn that sits above or inside the same hazard, and enters it again — a new overlap,
 * a new event, another respawn. That loop is not hypothetical. It counted 2,076 hits on
 * a Roblox place while the player stood still, and because `PlayerController` teleports
 * the walker to spawn and zeroes its velocity on every bump of `respawnNonce`, the
 * player was pinned: no key, WASD or arrow, could move a body that was being put back
 * every frame.
 *
 * A wall-clock cooldown is the guard that holds whatever shape the level is, because it
 * does not depend on the level being well-built. The walker is teleported at most once
 * per window, so it always has time to walk out of whatever bit it.
 */
const HAZARD_COOLDOWN_MS = 1200;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function useWorldPlay(scene: CanvasWorldScene, active: boolean): WorldPlay {
  const total = useMemo(() => scene.props.filter((prop) => prop.kind === 'collectible').length, [scene.props]);
  const hasGoal = useMemo(() => scene.props.some((prop) => prop.kind === 'goal'), [scene.props]);

  const [collected, setCollected] = useState<string[]>([]);
  const [hits, setHits] = useState(0);
  const [won, setWon] = useState(false);
  const [respawnNonce, setRespawnNonce] = useState(0);

  // A rewritten level is a different game, and leaving walk mode ends the run.
  // Without the second dependency a builder who walked past their own
  // collectibles would go back to Build mode and find them gone.
  //
  // A new `scene` IDENTITY is what "different level" means here, so the caller
  // must memoize it — both consumers derive theirs through `useMemo`. Building
  // one inline would reset the run on every render, which is a loop rather than
  // a wrong score.
  useEffect(() => {
    collectedRef.current = new Set();
    hazardAtRef.current = Number.NEGATIVE_INFINITY;
    setCollected([]);
    setHits(0);
    setWon(false);
  }, [scene, active]);

  // Every value `onPlayerEnter` reads lives in a ref, because the callback's IDENTITY
  // is load-bearing: it is handed to each sensor prop as a Rapier collision handler, and
  // a handler that changes re-registers the collider it is attached to. The old callback
  // listed `respawnNonce` in its dependencies, so bumping the nonce rebuilt the callback,
  // which re-registered every sensor, which re-fired the overlap that bumped the nonce.
  // The guard could not stop it either: it was derived from `respawnNonce` too, so it
  // re-armed on the very bump it existed to suppress and only ever deduped within one
  // render generation. One stable callback plus a wall-clock cooldown breaks both halves.
  const collectedRef = useRef<Set<string>>(new Set());
  const hazardAtRef = useRef(Number.NEGATIVE_INFINITY);
  const activeRef = useRef(active);
  const totalRef = useRef(total);
  useEffect(() => { collectedRef.current = new Set(collected); }, [collected]);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { totalRef.current = total; }, [total]);

  const restart = useCallback(() => {
    collectedRef.current = new Set();
    // A deliberate restart earns the same grace a hazard touch does: pressing Respawn
    // while standing in the fire must not be answered by the fire immediately.
    hazardAtRef.current = now();
    setCollected([]);
    setHits(0);
    setWon(false);
    setRespawnNonce((value) => value + 1);
  }, []);

  const onPlayerEnter = useCallback((prop: CanvasWorldProp) => {
    if (!activeRef.current) return;
    if (prop.kind === 'collectible') {
      if (collectedRef.current.has(prop.id)) return;
      collectedRef.current.add(prop.id);
      setCollected((current) => (current.includes(prop.id) ? current : [...current, prop.id]));
      return;
    }
    if (prop.kind === 'hazard') {
      // One respawn per cooldown window — see HAZARD_COOLDOWN_MS for what happens
      // without it on a level whose spawn point sits over its own hazard.
      const at = now();
      if (at - hazardAtRef.current < HAZARD_COOLDOWN_MS) return;
      hazardAtRef.current = at;
      setHits((value) => value + 1);
      setRespawnNonce((value) => value + 1);
      return;
    }
    if (prop.kind === 'goal' && collectedRef.current.size >= totalRef.current) setWon(true);
  }, []);

  const playScene = useMemo<CanvasWorldScene>(
    () => (!active || collected.length === 0
      ? scene
      : { ...scene, props: scene.props.filter((prop) => !collected.includes(prop.id)) }),
    [active, scene, collected],
  );

  return {
    state: active
      ? { collected, total, hits, won, playable: total > 0 || hasGoal }
      : EMPTY,
    scene: playScene,
    onPlayerEnter,
    respawnNonce,
    restart,
  };
}
