/**
 * Poses the stage's camera from the rig, every frame (PRD 43 B2): the orthographic camera for ground views, the
 * perspective one for orbit and cross-projection tweens. Both are fully specified HERE from the box size — R3F resizes
 * only the store's ACTIVE camera, so the inactive one's frustum would otherwise go stale across a resize (resize in 3D,
 * switch to Map). Mutates the cameras; allocates nothing. Returns the camera to draw with.
 */

import type { OrthographicCamera, PerspectiveCamera } from 'three';
import type { RigPose } from './rig';

export interface AimSize { width: number; height: number }

export function aimCamera(
    pose: Readonly<RigPose>, orbitDistance: number, ortho: OrthographicCamera, persp: PerspectiveCamera, size: AimSize,
): OrthographicCamera | PerspectiveCamera {
    const perspective = pose.projection === 'perspective';
    const camera = perspective ? persp : ortho;
    camera.up.set(pose.up[0], pose.up[1], pose.up[2]);
    camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
    camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
    if (perspective) {
        persp.fov = pose.fov;
        persp.aspect = size.width / Math.max(1, size.height);
        persp.near = Math.max(0.1, orbitDistance / 1000);
        persp.far = orbitDistance * 20;
    } else {
        // The frustum in CSS px (R3F's own convention for an orthographic default camera), set from the CURRENT size.
        ortho.left = -size.width / 2; ortho.right = size.width / 2;
        ortho.top = size.height / 2; ortho.bottom = -size.height / 2;
        ortho.zoom = pose.zoom;
        ortho.near = 1; ortho.far = 3 * pose.position[1] + 4000;
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    return camera;
}
