/**
 * W2: Dockerfile Detector
 * 
 * Detects Dockerfile and container configuration.
 */

import type { BlueprintDetector } from '@builderforce/creation-canvas-contract';
import { SERVICE_KINDS } from '@builderforce/creation-canvas-contract';

export const dockerfileDetector: BlueprintDetector = {
  id: 'dockerfile',
  name: 'Dockerfile',
  reads: ['Dockerfile', 'Dockerfile.dev', 'Dockerfile.prod'],
  detect: (files: Map<string, string>): any => {
    const result: any = {
      sources: { dockerfile: false },
    };

    const dockerfile = files.get('Dockerfile');
    const dockerfileDev = files.get('Dockerfile.dev');
    const dockerfileProd = files.get('Dockerfile.prod');

    if (dockerfile || dockerfileDev || dockerfileProd) {
      result.sources.dockerfile = true;

      const content = dockerfile || dockerfileDev || dockerfileProd || '';

      // Detect if there's a Node.js app
      const isNode = content.includes('node') || content.includes('npm');
      
      // Detect the port
      const portMatch = content.match(/EXPOSE\s+(\d+)/);
      const port = portMatch && portMatch[1] ? parseInt(portMatch[1], 10) : 3000;

      if (isNode) {
        result.services = result.services || [];
        result.services.push({
          id: 'container',
          kind: SERVICE_KINDS.CONTAINER,
          rootDir: '.',
          packageManager: 'npm',
          installCommand: 'npm install',
          devCommand: 'npm run dev',
          buildCommand: 'docker build -t app .',
          startCommand: 'docker run -p 3000:3000 app',
          verifyCommand: null,
          outputDir: 'dist',
          ports: [port],
          envVars: [],
          isPrimary: true,
        });
      }
    }

    return result;
  },
};
