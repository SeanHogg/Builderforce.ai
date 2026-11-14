/**
 * AppBlueprint — a declarative description of what an app IS.
 *
 * Detected once per project + commit, then read by:
 * - Run loop (W1): dev commands, ports, env
 * - Provision (W4): bindings, database, secrets
 * - Deploy (W6): build commands, output dir
 * - Marketplace (W7): listing metadata
 *
 * This is the "one blueprint, many targets" principle from PRD 31.
 */
/** The kind of runtime service detected in the project. */
export const SERVICE_KINDS = {
    WORKER: 'worker', // Cloudflare Worker (Hono, Fastify, etc.)
    SPA: 'spa', // Vite/Next.js SPA
    NODE: 'node', // Node.js server (Express, etc.)
    CONTAINER: 'container', // Docker container
    MOBILE_EXPO: 'mobile-expo', // Expo React Native
    MOBILE_CAPACITOR: 'mobile-capacitor', // Capacitor (Ionic, etc.)
    // Framework-specific kinds (map to runtime kinds internally)
    NEXTJS: 'nextjs', // Next.js (SSR or static)
    VITE_REACT: 'vite-react', // Vite + React
    VITE_VUE: 'vite-vue', // Vite + Vue
    SVELTEKIT: 'sveltekit', // SvelteKit
    REMIX: 'remix', // Remix
    ASTRO: 'astro', // Astro
};
/** Cloudflare binding types. */
export const BINDING_KINDS = {
    DURABLE_OBJECT: 'durableObject',
    R2: 'r2',
    KV: 'kv',
    D1: 'd1',
    QUEUE: 'queue',
    CRON: 'cron',
    AI: 'ai',
    VECTORIZE: 'vectorize',
    BROWSER: 'browser',
};
/** Database engine types. */
export const DATABASE_ENGINES = {
    NEON: 'neon',
    D1: 'd1',
    TURSO: 'turso',
    POSTGRES: 'postgres',
    MYSQL: 'mysql',
    MONGODB: 'mongodb',
    SQLITE: 'sqlite',
};
//# sourceMappingURL=appBlueprint.js.map