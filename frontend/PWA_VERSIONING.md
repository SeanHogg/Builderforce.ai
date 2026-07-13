# PWA Versioning Implementation

## Overview

This document describes the PWA versioning system that ensures users are notified when a new version of Builderforce.ai is deployed.

## Problem

Without proper PWA versioning:
- Users were not notified about new deployments
- Browser service workers didn't change consistently
- No reliable way to trigger update notifications

## Solution

A build-time versioning system that:

1. **Injects version into manifest.json** via `inject-sw-version.js`
2. **Embeds unique BUILD_ID into sw.js** via `stamp-sw-version.js`
3. **Triggers browser update notifications** when sw.js bytes change

## Files Changed

### 1. `frontend/public/sw.js`
- Added `__BUILD_VERSION__` placeholder in CACHE_NAME
- Updated with build-time stamping documentation
- The placeholder is replaced by `stamp-sw-version.js` before deployment

Build format per deployment:
```
bf-cache-{package-version}-{YYYYMMDD}-{short-commit-sha}
```

Example: `bf-cache-2026.05.31-20260629-a3f5d1`

### 2. `frontend/scripts/stamp-sw-version.js` (NEW)
Replaces `__BUILD_VERSION__` with a unique token based on:
- Package version from `package.json`
- Current date (YYYYMMDD)
- Git commit SHA (from GitHub Actions or Vercel)

If in CI:
```
BUILD_ID=2026.05.31-20260629-a3f5d1
```

If local development (no git SHA):
```
BUILD_ID=2026.05.31-{timestamp}-{sha256hash}
```

### 3. `frontend/scripts/inject-sw-version.js`
Refactored to only update manifest.json:
- Adds `version` field to manifest.json using package.json version
- The service worker versioning is handled separately by `stamp-sw-version.js`

### 4. `frontend/package.json`
Updated build scripts to chain versioning scripts:
```json
"build": "node scripts/inject-sw-version.js && node scripts/stamp-sw-version.js && next build"
"dev": "node scripts/inject-sw-version.js && node scripts/stamp-sw-version.js && next dev"
"start": "node scripts/inject-sw-version.js && node scripts/stamp-sw-version.js && next start"
```

## How It Works

### Build Time (CI or Local)
1. `inject-sw-version.js` → reads package.json version, adds to manifest.json
2. `stamp-sw-version.js` → generates unique BUILD_ID, replaces placeholder in sw.js
3. Next.js copies `public/` to `.vercel/output/static/` during build

### Browser Runtime
1. Service worker registers at `/sw.js`
2. Polls for updates every 60 seconds via `navigator.serviceWorker.update()`
3. Detects that sw.js bytes have changed (new BUILD_ID in CACHE_NAME)
4. Service worker enters `installed` state, waiting for activation
5. **PwaUpdateBanner** detects waiting SW → shows "Update now" toast
6. User clicks button → calls `waitingSw.postMessage('SKIP_WAITING')`
7. Service worker activates → caches refresh → page reloads

## Requirements Met

✅ PWA versioning system updates version number in app manifest
✅ PWA notification triggered when new version deployed
✅ Version uniquely identifies each deployment (git SHA + timestamp)
✅ Automatic update notifications for all users

## Performance Impact

- **Minimal**: Service worker polling only runs once per minute
- **Zero impact on API**: API calls continue to use network-first strategy
- **Efficient caching**: Old caches deleted on activation

## Testing Checklist

Before merging:
- [ ] CI pipeline passes (including frontend build)
- [ ] Local development `pnpm run build` succeeds
- [ ] `sw.js` contains unique BUILD_ID after stamp-sw-version.js
- [ ] `manifest.json` contains version field after inject-sw-version.js
- [ ] PwaUpdateBanner component shows correctly in the app
- [ ] Dashboard test verifies update banner appears when SW updates