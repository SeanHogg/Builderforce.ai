/**
 * Inside the ONE canvas: hands the camera's projection to the stage bus once per rendered frame (after the rig moved it),
 * so picking, the a11y proxies and the card anchors follow pan, zoom, tilt and orbit without a React commit. ONE
 * {@link CameraProjector} is reused for the canvas's life: a frame rewrites its scratch matrices and its key changes
 * only when a view number does. Also gives the bus the canvas's `invalidate`, so a hover change (the overlay ring) asks
 * for one frame on the demand frame loop.
 */

import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CameraProjector } from '../projector';
import type { StageBus } from './stageBus';

export function StageFrameTap({ bus }: { bus: StageBus }) {
    const camera = useThree((s) => s.camera);
    const size = useThree((s) => s.size);
    const invalidate = useThree((s) => s.invalidate);
    const projector = useMemo(() => new CameraProjector(), []);
    useEffect(() => {
        bus.invalidate = invalidate;
        return () => { bus.invalidate = () => {}; };
    }, [bus, invalidate]);
    useFrame(() => {
        camera.updateMatrixWorld();
        projector.update(camera, size.width, size.height);
        bus.frame(projector);
    });
    return null;
}
