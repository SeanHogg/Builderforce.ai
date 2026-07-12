/**
 * Step Validation Plugin Entry Point
 *
 * Registers the step-validation plugin service.
 */
'use strict';

import type { BuilderForceAgentsPluginApi } from '../../src/plugins/types.js';
import { stepValidationService } from './src/plugin.js';

export default function register(api: BuilderForceAgentsPluginApi) {
  const sv = stepValidationService(api);
  api.registerService(sv.service);
}