/**
 * W2: Environment Example Detector
 * 
 * Detects .env.example files and extracts required environment variables.
 */

import type { BlueprintDetector } from '@builderforce/creation-canvas-contract';

export const envExampleDetector: BlueprintDetector = {
  id: 'env-example',
  name: 'Environment Example',
  reads: ['.env.example', '.env.example.local', '.env.example.dev', '.env.example.production'],
  detect: (files: Map<string, string>): any => {
    const result: any = {
      sources: { envExample: false },
      vars: [],
      secrets: [],
    };

    const envExample = files.get('.env.example');
    const envExampleLocal = files.get('.env.example.local');
    const envExampleDev = files.get('.env.example.dev');
    const envExampleProd = files.get('.env.example.production');

    const content = envExample || envExampleLocal || envExampleDev || envExampleProd;

    if (content) {
      result.sources.envExample = true;

      const lines = content.split('\n');
      
      for (const line of lines) {
        // Skip comments and empty lines
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          continue;
        }

        // Parse KEY=VALUE or KEY= (empty value)
        const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (match) {
          const key = match[1];
          const defaultValue = match[2];

          // Check if it's a secret (contains SECRET, KEY, PASSWORD, TOKEN, etc.)
          const isSecret = /SECRET|KEY|PASSWORD|TOKEN|PRIVATE|CREDENTIAL/i.test(key);

          if (isSecret) {
            result.secrets.push({
              name: key,
              required: !defaultValue,
              description: `Detected from .env.example`,
            });
          } else {
            result.vars.push({
              name: key,
              defaultValue: defaultValue || undefined,
              description: `Detected from .env.example`,
            });
          }
        }
      }
    }

    return result;
  },
};
