/**
 * Build-time version injection for PWA manifest.
 *
 * This script reads package.json and adds a version field to manifest.json.
 * The manifest version helps browser UI identify the app version.
 *
 * The service worker versioning (which triggers update notifications) is handled
 * by stamp-sw-version.js, which creates unique BUILD_ID tokens for sw.js.
 */

const fs = require('fs');
const path = require('path');

// Read package.json to get the version
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const version = packageJson.version;

console.log(`📦 Adding version to manifest: ${version}`);

// -----------------------------------------------------------------------
// Update manifest.json: add version field (first time if missing)
// -----------------------------------------------------------------------

const manifestPath = path.join(__dirname, '..', 'public', 'manifest.json');
let manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

if (!manifest.version) {
  manifest.version = version;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  console.log(`✓ Updated ${manifestPath}: added version = '${version}'`);
} else {
  console.log(`ℹ ${manifestPath}: version field already exists ( '${manifest.version}' )`);
}

console.log(`\nCHECKED manifest.json version (${version})`);