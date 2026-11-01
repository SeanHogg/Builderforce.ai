/** Every parity scenario, in the order the suite runs them. */
import type { Scenario } from '../types';
import { coreScenarios } from './core';

export const scenarios: Scenario[] = [...coreScenarios];
