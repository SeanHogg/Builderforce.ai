/**
 * The stage host's renderer port (PRD 43 B3 `StageRenderer` port, B8 No WebGL): what renders the stage on this host.
 * The default asks for WebGL and DECLINES (null) without it, which sends every stage camera to the List. The package's
 * test setup replaces this module with the no-op renderer (jsdom has no WebGL), so the a11y proxies, captions, cards
 * and picking still mount and work; a host may also provide its own through `StageFactoryContext`.
 */

import { hasWebGL } from '../../environment';
import { createWebGLStage, type StageRenderer } from '../renderer';

/** Creates the stage's renderer; null = this host cannot draw the stage (the List is shown instead). */
export type StageFactory = () => StageRenderer | null;

export const createStage: StageFactory = () => (hasWebGL() ? createWebGLStage() : null);
