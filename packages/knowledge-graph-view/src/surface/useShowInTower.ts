/**
 * Show in Tower, once: which camera to go to (the WebGL 3D, else the Map with its towers look on;
 * none ⇒ the button is disabled), the highlight an anti-pattern lights there, and its end of life:
 * it is cleared when the person leaves both tower pictures (`surface/useSurface.ts` clears it on a
 * new question, family or graph).
 */

import { useCallback, useContext, useEffect } from 'react';
import type { ViewMode } from '../types';
import type { AntiPatternGroup } from './drawers/antiPatternGroups';
import type { PanelProps } from './registry';
import { highlightFor, towerCameraOf, type TowerHighlight } from './towerHighlight';
import { FlatViewContext } from './useFlatView';

/** Files per group handed to the scene's focus (the highlight itself covers every finding). */
export const TOWER_FOCUS = 40;

/**
 * Goes to the tower picture: the 3D view as it is, the Map in 3D. The Map's towers ARE the 3D / Flat switch (the view
 * derives them from it), so with the view's `setFlat` the switch is the one thing set; without it (a panel outside a
 * view) the towers look is set directly.
 */
export function goToTowers(camera: '3d' | 'transit' | null, setTowers: (on: boolean) => void, onCamera: ((mode: ViewMode) => void) | undefined, setFlat?: ((flat: boolean) => void) | null): void {
    if (!camera) return;
    if (camera === 'transit') { if (setFlat) setFlat(false); else setTowers(true); }
    onCamera?.(camera);
}

export function useShowInTower({ surface, onShow, onCamera, cameras }: Pick<PanelProps, 'surface' | 'onShow' | 'onCamera' | 'cameras'>): { canShow: boolean; show(groups: readonly AntiPatternGroup[]): void } {
    const camera = towerCameraOf(cameras);
    const { setHighlight, setTowers } = surface;
    const setFlat = useContext(FlatViewContext);
    const show = useCallback((groups: readonly AntiPatternGroup[]) => {
        setHighlight(highlightFor(groups.flatMap((g) => g.findings)));
        onShow([...new Set(groups.flatMap((g) => g.files.slice(0, TOWER_FOCUS)))]);
        goToTowers(camera, setTowers, onCamera, setFlat);
    }, [setHighlight, setTowers, onShow, onCamera, camera, setFlat]);
    return { canShow: camera !== null, show };
}

/** Whether the camera on show draws the highlight: the 3D view, or the Map with its towers look. */
export const showsTowers = (mode: ViewMode, towers: boolean): boolean => mode === '3d' || (mode === 'transit' && towers);

/** The highlight belongs to the two tower pictures: leaving them (another camera, or the Map's flat look) ends it. */
export function useClearHighlightOutsideTower(mode: ViewMode, towers: boolean, setHighlight: (h: TowerHighlight | null) => void): void {
    useEffect(() => { if (!showsTowers(mode, towers)) setHighlight(null); }, [mode, towers, setHighlight]);
}
