import { describe, expect, it } from 'vitest';
import { isNativeCanvasRoute, shouldRenderRouteAsCanvasArtifact } from './routeCanvasPolicy';

describe('route canvas policy', () => {
  it.each(['/create', '/create/local-1', '/projects', '/brainstorm', '/workflows/builder'])(
    'does not nest the native canvas route %s',
    (pathname) => expect(isNativeCanvasRoute(pathname)).toBe(true),
  );

  it.each(['/dashboard', '/workforce', '/insights/delivery', '/knowledge/12', '/settings', '/ide/12', '/projects/12', '/projects/rfp/9'])(
    'migrates the dedicated route %s to a canvas artifact',
    (pathname) => expect(shouldRenderRouteAsCanvasArtifact(pathname)).toBe(true),
  );
});
