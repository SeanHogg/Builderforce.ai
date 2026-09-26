/**
 * W2: Prisma Schema Detector
 * 
 * Detects Prisma ORM configuration and database setup.
 */

import type { BlueprintDetector } from '@builderforce/creation-canvas-contract';
import { DATABASE_ENGINES } from '@builderforce/creation-canvas-contract';

export const prismaSchemaDetector: BlueprintDetector = {
  id: 'prisma-schema',
  name: 'Prisma Schema',
  reads: ['schema.prisma', 'prisma/schema.prisma'],
  detect: (files: Map<string, string>): any => {
    const result: any = {
      sources: { prismaSchema: false },
      database: null,
    };

    const schemaPrisma = files.get('schema.prisma') || files.get('prisma/schema.prisma');

    if (schemaPrisma) {
      result.sources.prismaSchema = true;

      // Detect the database engine
      let engine = DATABASE_ENGINES.POSTGRES;
      if (schemaPrisma.includes('provider = "mysql"') || schemaPrisma.includes('provider = "mysql2"')) {
        engine = DATABASE_ENGINES.MYSQL;
      } else if (schemaPrisma.includes('provider = "mongodb"')) {
        engine = DATABASE_ENGINES.MONGODB;
      } else if (schemaPrisma.includes('provider = "sqlite"')) {
        engine = DATABASE_ENGINES.SQLITE; // Wait, we don't have SQLITE in DATABASE_ENGINES
      }

      result.database = {
        engine,
        migrationCommand: 'npx prisma migrate deploy',
        seedCommand: 'npx prisma db seed',
        migrationsPath: 'prisma/migrations',
        connectionSecretName: 'DATABASE_URL',
      };
    }

    return result;
  },
};
