import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { addProp, emptyCanvasWorldScene, type CanvasWorldProp, type CanvasWorldScene } from '@builderforce/creation-canvas-contract';
import { useWorldPlay } from './world3d/useWorldPlay';

/**
 * The rules that make walking a level PLAYING it.
 *
 * Testable without a WebGL context on purpose: the arithmetic of a run is state,
 * not rendering, so it lives in a hook and the renderer only draws what it says.
 */

function level(): { scene: CanvasWorldScene; coin: CanvasWorldProp; goal: CanvasWorldProp; spike: CanvasWorldProp } {
  let scene = emptyCanvasWorldScene();
  const first = addProp(scene, { kind: 'collectible', position: [0, 1, 0] });
  scene = first.scene;
  const second = addProp(scene, { kind: 'goal', position: [5, 1, 0] });
  scene = second.scene;
  const third = addProp(scene, { kind: 'hazard', position: [-5, 1, 0] });
  scene = third.scene;
  return { scene, coin: first.prop, goal: second.prop, spike: third.prop };
}

describe('playing a level', () => {
  it('scores a collectible once, however many frames the player overlaps it', () => {
    // Rapier fires an intersection every frame of contact. Without the settled
    // ref inside the hook, one coin would be worth a dozen.
    const { scene, coin } = level();
    const { result } = renderHook(() => useWorldPlay(scene, true));
    act(() => { result.current.onPlayerEnter(coin); result.current.onPlayerEnter(coin); });
    expect(result.current.state.collected).toEqual([coin.id]);
    expect(result.current.state.total).toBe(1);
  });

  it('takes a collected prop out of the scene the renderer draws', () => {
    const { scene, coin } = level();
    const { result } = renderHook(() => useWorldPlay(scene, true));
    act(() => result.current.onPlayerEnter(coin));
    expect(result.current.scene.props.some((prop) => prop.id === coin.id)).toBe(false);
  });

  it('respawns the walker on a hazard, once per touch', () => {
    const { scene, spike } = level();
    const { result } = renderHook(() => useWorldPlay(scene, true));
    const before = result.current.respawnNonce;
    act(() => { result.current.onPlayerEnter(spike); result.current.onPlayerEnter(spike); });
    expect(result.current.state.hits).toBe(1);
    expect(result.current.respawnNonce).toBe(before + 1);
  });

  it('does not hand the goal to a player who left a collectible behind', () => {
    const { scene, coin, goal } = level();
    const { result } = renderHook(() => useWorldPlay(scene, true));
    act(() => result.current.onPlayerEnter(goal));
    expect(result.current.state.won).toBe(false);
    act(() => result.current.onPlayerEnter(coin));
    act(() => result.current.onPlayerEnter(goal));
    expect(result.current.state.won).toBe(true);
  });

  it('says a sandbox has nothing to win, so no scoreboard is drawn over it', () => {
    // The scene is built OUTSIDE the render callback deliberately: the hook
    // treats a new scene as a new level and resets the run, so constructing one
    // per render is an infinite loop — the same trap any consumer can fall into.
    const sandbox = addProp(emptyCanvasWorldScene(), { kind: 'block' }).scene;
    const { result } = renderHook(() => useWorldPlay(sandbox, true));
    expect(result.current.state.playable).toBe(false);
  });

  it('gives a builder their collectibles back when they leave walk mode', () => {
    // The 3D space walks the SAME level it edits. A builder who tested a jump
    // and went back to Build must not find their pickups deleted.
    const { scene, coin } = level();
    const { result, rerender } = renderHook(({ active }) => useWorldPlay(scene, active), { initialProps: { active: true } });
    act(() => result.current.onPlayerEnter(coin));
    expect(result.current.scene.props).toHaveLength(2);
    rerender({ active: false });
    expect(result.current.scene.props).toHaveLength(3);
    expect(result.current.state.collected).toEqual([]);
  });

  it('scores nothing at all while the level is being authored', () => {
    const { scene, coin } = level();
    const { result } = renderHook(() => useWorldPlay(scene, false));
    act(() => result.current.onPlayerEnter(coin));
    expect(result.current.state.collected).toEqual([]);
  });

  it('restarts a run without reloading the level', () => {
    const { scene, coin } = level();
    const { result } = renderHook(() => useWorldPlay(scene, true));
    act(() => result.current.onPlayerEnter(coin));
    act(() => result.current.restart());
    expect(result.current.state.collected).toEqual([]);
    expect(result.current.scene.props).toHaveLength(3);
  });
});
