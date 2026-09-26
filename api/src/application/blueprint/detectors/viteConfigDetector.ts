/**
 * W2: Vite Configuration Detector
 * 
 * Detects Vite configuration and Vite-based SPA apps.
 */

import type { BlueprintDetector } from '@builderforce/creation-canvas-contract';
import { SERVICE_KINDS } from '@builderforce/creation-canvas-contract';

export const viteConfigDetector: BlueprintDetector = {
  id: 'vite-config',
  name: 'Vite Configuration',
  reads: ['vite.config.ts', 'vite.config.js', 'vite.config.mts'],
  detect: (files: Map<string, string>): any => {
    const result: any = {
      sources: { viteConfig: false },
      services: [],
    };

    // Check for vite.config.ts
    const viteConfigTs = files.get('vite.config.ts');
    const viteConfigJs = files.get('vite.config.js');
    const viteConfigMts = files.get('vite.config.mts');

    if (viteConfigTs || viteConfigJs || viteConfigMts) {
      result.sources.viteConfig = true;

      const configContent = viteConfigTs || viteConfigJs || viteConfigMts || '';

      // Detect the port from config
      let ports = [5173]; // Vite default
      const portMatch = configContent.match(/port\s*:\s*(\d+)/);
      if (portMatch) {
        ports = [parseInt(portMatch[1], 10)];
      }

      // Check if it's React
      const isReact = configContent.includes('@vitejs/plugin-react');
      const isVue = configContent.includes('@vitejs/plugin-vue');
      const isSvelte = configContent.includes('@sveltejs/vite-plugin-svelte');

      // Build the service
      result.services.push({
        id: 'vite',
        kind: SERVICE_KINDS.SPA,
        rootDir: '.',
        packageManager: 'npm',
        installCommand: 'npm install',
        devCommand: 'npm run dev',
        buildCommand: 'npm run build',
        startCommand: 'npm run preview',
        verifyCommand: 'npm run lint',
        outputDir: 'dist',
        ports,
        envVars: ['VITE_'],
        isPrimary: true,
      });
    }

    return result;
  },
};
