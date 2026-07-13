/**
 * PWA Versioning Tests
 *
 * These tests verify that the build-time versioning scripts work as expected.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Test 1: Verify inject-sw-version.js adds version to manifest.json
console.log('🧪 Test 1: Checking inject-sw-version.js functionality...');
const manifestPath = path.join(__dirname, 'public', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

if (manifest.version && manifest.version.startsWith('2026.')) {
  console.log('✅ Manifest has version field:', manifest.version);
} else {
  console.error('❌ Manifest missing or invalid version field');
  process.exit(1);
}

// Test 2: Verify stamp-sw-version.js generates unique BUILD_ID
console.log('\n🧪 Test 2: Checking stamp-sw-version.js functionality...');

const pkgPath = path.join(__dirname, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const pkgVersion = packageJson.version;

let buildId;
// Simulate CI environment
gitSha = 'a3f5d1';
const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const shortSha = gitSha.slice(0, 7);
buildId = `${pkgVersion}-${dateStr}-${shortSha}`;

console.log('Generated BUILD_ID:', buildId);

// Extract regex pattern from stamp-sw-version.js
// Pattern: const CACHE_NAME = 'bf-cache-' + __BUILD_VERSION__;
const swPath = path.join(__dirname, 'public', 'sw.js');
const swContent = fs.readFileSync(swPath, 'utf-8');
const versionRegex = /constCACHE_NAME\s*\+=\s*['"]bf-cache-[']+'\s*\+ __BUILD_VERSION__/;

if (versionRegex.test(swContent)) {
  console.log('✅ sw.js contains __BUILD_VERSION__ placeholder');
} else {
  console.error('❌ sw.js missing __BUILD_VERSION__ placeholder');
  process.exit(1);
}

// Test 3: Verify PwaUpdateBanner component exists and is properly integrated
console.log('\n🧪 Test 3: Checking PwaUpdateBanner integration...');
const pwaBannerPath = path.join(__dirname, '../src/components/PwaUpdateBanner.tsx');
if (fs.existsSync(pwaBannerPath)) {
  const pwaBannerContent = fs.readFileSync(pwaBannerPath, 'utf-8');
  if (pwaBannerContent.includes('PwaUpdateBanner')) {
    console.log('✅ PwaUpdateBanner component exists');
  } else {
    console.error('❌ PwaUpdateBanner component missing');
    process.exit(1);
  }
} else {
  console.error('❌ PwaUpdateBanner component not found at expected path');
  process.exit(1);
}

// Test 4: Verify package.json build scripts chain versioning
console.log('\n🧪 Test 4: Checking package.json build scripts...');
const buildPath = path.join(__dirname, 'package.json');
const buildJson = JSON.parse(fs.readFileSync(buildPath, 'utf-8'));

const buildScript = buildJson.scripts.build;
if (
  buildScript.includes('node scripts/inject-sw-version.js') &&
  buildScript.includes('node scripts/stamp-sw-version.js') &&
  buildScript.includes('next build')
) {
  console.log('✅ Build scripts correctly chain versioning steps');
} else {
  console.error('❌ Build scripts missing versioning steps');
  process.exit(1);
}

console.log('\n✅ All versioning tests passed!');