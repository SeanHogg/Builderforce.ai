/**
 * Show in Tower, once: which camera to go to (the WebGL 3D, else the SVG Tower; none ⇒ the button
 * is disabled), the highlight an anti-pattern lights there, and its end of life: it is cleared
 * when the person leaves both Tower cameras (`surface/useSurface.ts` clears it on a new question,
 * family or graph).
 */

import { useCallback, useEffect } from 'react';
import type { ViewMode } from '../types';
import type { AntiPatternGroup } from './drawers/antiPatternGroups';
import type { PanelProps } from './registry';
import { highlightFor, towerCameraOf, type TowerHighlight } from './towerHighlight';

/** Files per group handed to the scene's focus (the highlight itself covers every finding). */
export const TOWER_FOCUS = 40;

export function useShowInTower({ surface, onShow, onCamera, cameras }: Pick<PanelProps, 'surface' | 'onShow' | 'onCamera' | 'cameras'>): { canShow: boolean; show(groups: readonly AntiPatternGroup[]): void } {
    const camera = towerCameraOf(cameras);
    const { setHighlight } = surface;
    const show = useCallback((groups: readonly AntiPatternGroup[]) => {
        setHighlight(highlightFor(groups.flatMap((g) => g.findings)));
        onShow([...new Set(groups.flatMap((g) => g.files.slice(0, TOWER_FOCUS)))]);
        if (camera) onCamera?.(camera);
    }, [setHighlight, onShow, onCamera, camera]);
    return { canShow: camera !== null, show };
}

/** The highlight belongs to the two Tower cameras: leaving them ends it. */
export function useClearHighlightOutsideTower(mode: ViewMode, setHighlight: (h: TowerHighlight | null) => void): void {
    useEffect(() => { if (mode !== '3d' && mode !== 'tower') setHighlight(null); }, [mode, setHighlight]);
}
