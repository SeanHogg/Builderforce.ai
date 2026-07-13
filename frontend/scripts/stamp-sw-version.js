/**
 * Build-time version stamping for PWA service worker.
 *
 * BEFORE DEPLOYMENT:
 *   This script reads package.json, extracts build metadata (version, git SHA, date),
 *   and replaces __BUILD_VERSION__ in public/sw.js with a unique per-build token:
 *
 *   Format: {package-version}-{YYYYMMDD}-{short-commit-sha}
 *   Example: 2026.05.31-20260629-a3f5d1
 *
 * WHY THIS MATTERS:
 *   - static assets copied from public/ to .vercel/output/static/ are otherwise byte-for-byte identical
 *   - without a changing service worker, browsers never surface a "waiting for update" state
 *   - PwaUpdateBanner only fires when sw.js bytes change, so users never see "Update now"
 *
 * INTEGRATION:
 *   Next.js build scripts invoke this BEFORE running "next build":
 *     pnpm run build → inject-sw-version.js (build time) → node scripts/stamp-sw-version.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// -----------------------------------------------------------------------
// 1. Read package.json to get the version and build metadata
// -----------------------------------------------------------------------

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const pkgVersion = packageJson.version;

// -----------------------------------------------------------------------
// 2. Determine build ID based on environment
// -----------------------------------------------------------------------

// Prefer GitHub Actions SHA (set by the CI workflow)
const gitSha = process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA;

// If we're not in CI and don't have a SHA, generate a deterministic hash from the package version
// This still ensures each build increment gets a unique token, even locally
let buildId;
if (gitSha && gitSha !== 'unknown') {
  // GitHub Actions: use short SHA + date
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const shortSha = gitSha.slice(0, 7);
  buildId = `${pkgVersion}-${dateStr}-${shortSha}`;
} else {
  // Local development: hash based on package version + timestamp
  const timestamp = Date.now();
  const hash = crypto.createHash('sha256').update(pkgVersion + timestamp).digest('hex').slice(0, 8);
  buildId = `${pkgVersion}-${timestamp}-${hash}`;
}

console.log(`📦 Injecting PWA version: ${buildId}`);

// -----------------------------------------------------------------------
// 3. Update sw.js: replace __BUILD_VERSION__ placeholder
// -----------------------------------------------------------------------

const swPath = path.join(__dirname, '..', 'public', 'sw.js');
const swContent = fs.readFileSync(swPath, 'utf-8');

// Improved regex to handle whitespace flexibility
const regex = /const\s+CACHE_NAME\s*=\s*'bf-cache-'\s*\+\s*__BUILD_VERSION__(?:\s+)?;/m;
if (!regex.test(swContent)) {
  console.error(`❌ Could not find CACHE_NAME using __BUILD_VERSION__ in ${swPath}`);
  process.exit(1);
}

const newSwContent = swContent.replace(regex, `const CACHE_NAME = 'bf-cache-' + '${buildId}';`);

fs.writeFileSync(swPath, newSwContent, 'utf-8');
console.log(`✓ Updated ${swPath}: CACHE_NAME = 'bf-cache-${buildId}'`);

// -----------------------------------------------------------------------
// 4. Output BUILD_ID for CI (consumed by Cloudflare Pages deploy)
// -----------------------------------------------------------------------

console.log(`\nBUILD_ID=${buildId}`);

// Export as environment variable for Canvaskit (optional preview feature)
if (process.env.CANVASKIT_VERSION) {
  console.log(`CANVASKIT_VERSION=${buildId}`);
}