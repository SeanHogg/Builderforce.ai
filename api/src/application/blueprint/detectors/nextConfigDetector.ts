/**
 * W2: Next.js Configuration Detector
 * 
 * Detects Next.js configuration and Next.js apps.
 */

import type { BlueprintDetector } from '@builderforce/creation-canvas-contract';
import { SERVICE_KINDS } from '@builderforce/creation-canvas-contract';

export const nextConfigDetector: BlueprintDetector = {
  id: 'next-config',
  name: 'Next.js Configuration',
  reads: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
  detect: (files: Map<string, string>): any => {
    const result: any = {
      sources: { nextConfig: false },
      services: [],
    };

    const nextConfigJs = files.get('next.config.js');
    const nextConfigMjs = files.get('next.config.mjs');
    const nextConfigTs = files.get('next.config.ts');

    if (nextConfigJs || nextConfigMjs || nextConfigTs) {
      result.sources.nextConfig = true;

      const configContent = nextConfigJs || nextConfigMjs || nextConfigTs || '';

      // Detect port
      let ports = [3000]; // Next.js default

      // Detect if it's using auth
      const hasAuth = configContent.includes('next-auth') || 
                      configContent.includes('Clerk') ||
                      configContent.includes('@kinde-oss');

      // Check for API routes
      const hasApiRoutes = configContent.includes('api/');

      // Build the service
      result.services.push({
        id: 'next',
        kind: SERVICE_KINDS.SPA,
        rootDir: '.',
        packageManager: 'npm',
        installCommand: 'npm install',
        devCommand: 'npm run dev',
        buildCommand: 'npm run build',
        startCommand: 'npm start',
        verifyCommand: 'npm run lint',
        outputDir: '.next',
        ports,
        envVars: ['NEXT_PUBLIC_'],
        isPrimary: true,
      });

      // Add bindings for auth if detected
      if (hasAuth) {
        result.bindings = result.bindings || [];
        result.bindings.push({
          name: 'AUTH',
          kind: 'auth' as any,
          required: false,
        });
      }
    }

    return result;
  },
};
