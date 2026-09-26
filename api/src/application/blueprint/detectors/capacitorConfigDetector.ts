/**
 * W2: Capacitor Configuration Detector
 * 
 * Detects Capacitor/Ionic configuration for mobile apps.
 */

import type { BlueprintDetector } from '@builderforce/creation-canvas-contract';
import { SERVICE_KINDS } from '@builderforce/creation-canvas-contract';

export const capacitorConfigDetector: BlueprintDetector = {
  id: 'capacitor-config',
  name: 'Capacitor Configuration',
  reads: ['capacitor.config.ts', 'capacitor.config.js', 'capacitor.config.json'],
  detect: (files: Map<string, string>): any => {
    const result: any = {
      sources: { capacitorConfig: false },
      services: [],
    };

    const capacitorConfigTs = files.get('capacitor.config.ts');
    const capacitorConfigJs = files.get('capacitor.config.js');
    const capacitorConfigJson = files.get('capacitor.config.json');

    if (capacitorConfigTs || capacitorConfigJs || capacitorConfigJson) {
      result.sources.capacitorConfig = true;

      const configContent = capacitorConfigTs || capacitorConfigJs || capacitorConfigJson || '';

      // Try to parse JSON config for more details
      let config: any = {};
      try {
        if (capacitorConfigJson) {
          config = JSON.parse(capacitorConfigJson);
        }
      } catch {
        // Ignore parse errors
      }

      // Build the service
      result.services.push({
        id: 'capacitor',
        kind: SERVICE_KINDS.MOBILE_CAPACITOR,
        rootDir: '.',
        packageManager: 'npm',
        installCommand: 'npm install',
        devCommand: 'npx cap run',
        buildCommand: 'npx cap sync',
        startCommand: 'npx cap open',
        verifyCommand: null,
        outputDir: 'android/app/build/outputs',
        ports: [3000],
        envVars: [],
        isPrimary: true,
      });
    }

    return result;
  },
};
