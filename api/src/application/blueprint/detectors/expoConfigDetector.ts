/**
 * W2: Expo Configuration Detector
 * 
 * Detects Expo/React Native configuration.
 */

import type { BlueprintDetector } from '@builderforce/creation-canvas-contract';
import { SERVICE_KINDS } from '@builderforce/creation-canvas-contract';

export const expoConfigDetector: BlueprintDetector = {
  id: 'expo-config',
  name: 'Expo Configuration',
  reads: ['app.json', 'app.config.js', 'app.config.ts', 'expo.js', 'expo.ts'],
  detect: (files: Map<string, string>): any => {
    const result: any = {
      sources: { expoConfig: false },
      services: [],
    };

    const appJson = files.get('app.json');
    const appConfigJs = files.get('app.config.js');
    const appConfigTs = files.get('app.config.ts');

    if (appJson || appConfigJs || appConfigTs) {
      result.sources.expoConfig = true;

      const configContent = appJson || appConfigJs || appConfigTs || '';

      // Try to parse app.json for more details
      let config: any = {};
      try {
        if (appJson) {
          config = JSON.parse(appJson);
        }
      } catch {
        // Ignore parse errors
      }

      // Detect the scheme for deep linking
      const scheme = config.expo?.scheme || config.scheme || 'myapp';

      // Build the service
      result.services.push({
        id: 'expo',
        kind: SERVICE_KINDS.MOBILE_EXPO,
        rootDir: '.',
        packageManager: 'npm',
        installCommand: 'npm install',
        devCommand: 'npx expo start',
        buildCommand: 'npx expo prebuild',
        startCommand: 'npx expo start',
        verifyCommand: null,
        outputDir: 'android/app/build/outputs' as any, // or ios
        ports: [8081], // Metro default
        envVars: ['EXPO_PUBLIC_'],
        isPrimary: true,
      });

      // Add vars for the scheme
      result.vars = result.vars || [];
      result.vars.push({
        name: 'EXPO_SCHEME',
        defaultValue: scheme,
        description: 'Deep linking scheme for the app',
      });
    }

    return result;
  },
};
