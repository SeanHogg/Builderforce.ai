/**
 * W2: Drizzle ORM Configuration Detector
 * 
 * Detects Drizzle ORM configuration and database setup.
 */

import type { BlueprintDetector } from '@builderforce/creation-canvas-contract';
import { DATABASE_ENGINES } from '@builderforce/creation-canvas-contract';

export const drizzleConfigDetector: BlueprintDetector = {
  id: 'drizzle-config',
  name: 'Drizzle ORM Configuration',
  reads: ['drizzle.config.ts', 'drizzle.config.js', 'drizzle.config.mts'],
  detect: (files: Map<string, string>): any => {
    const result: any = {
      sources: { drizzleConfig: false },
      database: null,
    };

    const drizzleConfigTs = files.get('drizzle.config.ts');
    const drizzleConfigJs = files.get('drizzle.config.js');
    const drizzleConfigMts = files.get('drizzle.config.mts');

    if (drizzleConfigTs || drizzleConfigJs || drizzleConfigMts) {
      result.sources.drizzleConfig = true;

      const configContent = drizzleConfigTs || drizzleConfigJs || drizzleConfigMts || '';

      // Detect the database engine
      let engine = DATABASE_ENGINES.POSTGRES;
      if (configContent.includes('neon') || configContent.includes('@neondatabase')) {
        engine = DATABASE_ENGINES.NEON;
      } else if (configContent.includes('@libsql') || configContent.includes('turso')) {
        engine = DATABASE_ENGINES.TURSO;
      } else if (configContent.includes('mysql2') || configContent.includes('mysql')) {
        engine = DATABASE_ENGINES.MYSQL;
      }

      // Detect migrations path
      let migrationsPath = 'drizzle';
      const schemaMatch = configContent.match(/schema:\s*['"`]([^'"`]+)['"`]/);
      const outMatch = configContent.match(/out:\s*['"`]([^'"`]+)['"`]/);
      
      if (outMatch) {
        migrationsPath = outMatch[1];
      }

      result.database = {
        engine,
        migrationCommand: 'npx drizzle-kit push',
        seedCommand: 'npx drizzle-kit seed',
        migrationsPath,
        connectionSecretName: 'DATABASE_URL',
      };
    }

    return result;
  },
};
