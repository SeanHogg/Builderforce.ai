/**
 * Build-time version injection for PWA service worker and manifest.
 *
 * Before deployment, this script reads package.json and embeds a unique
 * build version into the service worker (CACHE_NAME) and manifest.json.
 *
 * Build ID format: {package-version}-{YYYYMMDD}-{ short-commit-sha }
 * Example: 2026.05.31-20260629-a3f5d1
 *
 * This guarantees that sw.js changes on every deployment, triggering
 * the PWAUpdateBanner notification for users.
 */

const fs = require('fs');
const path = require('path');

// Read package.json to get the version
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const version = packageJson.version;

// Get current date in YYYYMMDD format
const now = new Date();
const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');

// Get git commit SHA from environment (set by GitHub Actions) or default to timestamp
const gitSha = process.env.GITHUB_SHA || 'unknown-' + Date.now();
const shortSha = gitSha.slice(0, 7); // First 7 characters

// Generate unique build ID
const buildId = `${version}-${dateStr}-${shortSha}`;
const cacheName = `bf-cache-${buildId}`;

console.log(`📦 Injecting PWA version: ${buildId}`);

// -----------------------------------------------------------------------
// 1. Update sw.js: replace CACHE_NAME with embeded version
// -----------------------------------------------------------------------

const swPath = path.join(__dirname, '..', 'public', 'sw.js');
const swContent = fs.readFileSync(swPath, 'utf-8');

const newSwContent = swContent.replace(
  /const CACHE_NAME = '[^']*';/,
  `const CACHE_NAME = '${cacheName}';`
);

fs.writeFileSync(swPath, newSwContent, 'utf-8');
console.log(`✓ Updated ${swPath}: CACHE_NAME = '${cacheName}'`);

// -----------------------------------------------------------------------
// 2. Update manifest.json: add version field (first time if missing)
// -----------------------------------------------------------------------

const manifestPath = path.join(__dirname, '..', 'public', 'manifest.json');
let manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

if (!manifest.version) {
  manifest.version = buildId;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  console.log(`✓ Updated ${manifestPath}: added version = '${buildId}'`);
} else {
  console.log(`ℹ ${manifestPath}: version field already exists ('${manifest.version}')`);
}

// -----------------------------------------------------------------------
// 3. Output for CI to pick up
// -----------------------------------------------------------------------

console.log(`\nBUILD_ID=${buildId}`);