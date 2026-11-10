/** Which renderer the stage host creates (`stageFactory.ts`); the default is WebGL, declining without it. */

import { createContext } from 'react';
import { createStage, type StageFactory } from './stageFactory';

export const StageFactoryContext = createContext<StageFactory>(createStage);
