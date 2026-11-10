/**
 * Inside the ONE canvas: hands the camera's projection to the stage bus once per rendered frame (after the rig moved it),
 * so picking, the a11y proxies and the card anchors follow pan, zoom, tilt and orbit without a React commit. Also gives
 * the bus the canvas's `invalidate`, so a hover change (the overlay ring) asks for one frame on the demand frame loop.
 */

import { useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { cameraProjector } from '../pick';
import type { StageBus } from './stageBus';

export function StageFrameTap({ bus }: { bus: StageBus }) {
    const camera = useThree((s) => s.camera);
    const size = useThree((s) => s.size);
    const invalidate = useThree((s) => s.invalidate);
    useEffect(() => {
        bus.invalidate = invalidate;
        return () => { bus.invalidate = () => {}; };
    }, [bus, invalidate]);
    useFrame(() => {
        camera.updateMatrixWorld();
        bus.frame(cameraProjector(camera, size.width, size.height));
    });
    return null;
}
