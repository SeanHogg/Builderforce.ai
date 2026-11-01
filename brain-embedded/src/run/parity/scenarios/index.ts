/** Every parity scenario, in the order the suite runs them. */
import type { Scenario } from '../types';
import { childScenarios } from './children';
import { coreScenarios } from './core';
import { endScenarios } from './ends';
import { foldScenarios } from './fold';
import { toolScenarios } from './tools';
import { turnScenarios } from './turn';

export const scenarios: Scenario[] = [...coreScenarios, ...turnScenarios, ...foldScenarios, ...endScenarios, ...toolScenarios, ...childScenarios];
