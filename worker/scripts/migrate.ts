import { neon } from '@neondatabase/serverless';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

async function migrate() {
    const connectionString = process.env.NEON_DATABASE_URL;
    if (!connectionString) {
        console.error('NEON_DATABASE_URL environment variable is not set.');
        process.exit(1);
    }

    const sql = neon(connectionString);
    const schemaPath = path.join(__dirname, '..', 'schema.sql');
    const schemaStr = fs.readFileSync(schemaPath, 'utf-8');

    // Basic split by statement (this assumes a simple schema without complex semicolons)
    const statements = schemaStr
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

    console.log(`Executing ${statements.length} migration statements...`);

    for (let i = 0; i < statements.length; i++) {
        try {
            await sql(statements[i]);
            console.log(`✅ Statement ${i + 1} succeeded`);
        } catch (e) {
            console.error(`❌ Statement ${i + 1} failed:`);
            console.error(statements[i]);
            console.error(e);
            process.exit(1);
        }
    }

    console.log('✅ Migration complete!');
}

migrate().catch(err => {
    console.error(err);
    process.exit(1);
});
