import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/infrastructure/database/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    // Used only locally for generating migrations.
    // Set NEON_DATABASE_URL in .env (not committed).
    url: process.env['NEON_DATABASE_URL'] ?? '',
  },
});
