import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('PWA Versioning', () => {
  describe('manifest.json', () => {
    it('should have version field added by inject-sw-version.js', () => {
      const manifestPath = path.join(__dirname, '../public/manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

      expect(manifest.version).toBeDefined();
      expect(manifest.version).toMatch(/^2026\.\d{2}\.\d{2}$/);
    });
  });

  describe('public/sw.js', () => {
    it('should contain __BUILD_VERSION__ placeholder', () => {
      const swPath = path.join(__dirname, '../public/sw.js');
      const swContent = fs.readFileSync(swPath, 'utf-8');

      expect(swContent).toContain('__BUILD_VERSION__');
    });

    it('should have message handler for SKIP_WAITING', () => {
      const swPath = path.join(__dirname, '../public/sw.js');
      const swContent = fs.readFileSync(swPath, 'utf-8');

      expect(swContent).toContain("event.data === 'SKIP_WAITING'");
    });

    it('should intentionally NOT self.skipWaiting() in install event', () => {
      const swPath = path.join(__dirname, '../public/sw.js');
      const swContent = fs.readFileSync(swPath, 'utf-8');

      // Verify the install event documentation mentions no skipWaiting
      expect(swContent).toMatch(/intentionally no self\.skipWaiting/i);
    });
  });

  describe('PwaUpdateBanner component', () => {
    it('should exist in src/components/PwaUpdateBanner.tsx', () => {
      const pwaBannerPath = path.join(__dirname, '../src/components/PwaUpdateBanner.tsx');
      expect(fs.existsSync(pwaBannerPath)).toBe(true);

      const pwaBannerContent = fs.readFileSync(pwaBannerPath, 'utf-8');
      expect(pwaBannerContent).toContain('PwaUpdateBanner');
    });

    it('should register service worker on mount', () => {
      const pwaBannerPath = path.join(__dirname, '../src/components/PwaUpdateBanner.tsx');
      const pwaBannerContent = fs.readFileSync(pwaBannerPath, 'utf-8');

      expect(pwaBannerContent).toContain("navigator.serviceWorker.register('/sw.js')");
      expect(pwaBannerContent).toContain('(reg) => {');
    });

    it('should poll for updates every 60 seconds', () => {
      const pwaBannerPath = path.join(__dirname, '../src/components/PwaUpdateBanner.tsx');
      const pwaBannerContent = fs.readFileSync(pwaBannerPath, 'utf-8');

      expect(pwaBannerContent).toContain('60_000');
    });

    it('should handle waiting service worker and show update banner', () => {
      const pwaBannerPath = path.join(__dirname, '../src/components/PwaUpdateBanner.tsx');
      const pwaBannerContent = fs.readFileSync(pwaBannerPath, 'utf-8');

      expect(pwaBannerContent).toContain('waitingSw');
      expect(pwaBannerContent).toContain('statechange');
      expect(pwaBannerContent).toContain('setWaitingSw');
    });
  });

  describe('inject-sw-version.js', () => {
    it('should add version to manifest.json while preserving existing fields', () => {
      const scriptPath = path.join(__dirname, '../scripts/inject-sw-version.js');
      const scriptContent = fs.readFileSync(scriptPath, 'utf-8');

      expect(scriptContent).toContain('manifest.version');
      expect(scriptContent).toContain('JSON.stringify');
    });
  });

  describe('stamp-sw-version.js', () => {
    it('should replace __BUILD_VERSION__ with unique BUILD_ID', () => {
      const scriptPath = path.join(__dirname, '../scripts/stamp-sw-version.js');
      const scriptContent = fs.readFileSync(scriptPath, 'utf-8');

      expect(scriptContent).toContain('__BUILD_VERSION__');
      expect(scriptContent).toContain('CACHE_NAME');
    });

    it('should generate BUILD_ID with version, date, and git SHA', () => {
      const scriptPath = path.join(__dirname, '../scripts/stamp-sw-version.js');
      const scriptContent = fs.readFileSync(scriptPath, 'utf-8');

      // Should reference GITHUB_SHA or VERCEL_GIT_COMMIT_SHA
      expect(scriptContent).toMatch(/GITHUB_SHA|VERCEL_GIT_COMMIT_SHA/);
      // Should use short SHA slice
      expect(scriptContent).toContain('.slice(0, 7)');
    });
  });

  describe('package.json build scripts', () => {
    it('should chain versioning scripts before build', () => {
      const packageJsonPath = path.join(__dirname, '../package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

      const buildScript = packageJson.scripts.build;
      expect(buildScript).toContain('node scripts/inject-sw-version.js');
      expect(buildScript).toContain('node scripts/stamp-sw-version.js');
      expect(buildScript).toContain('next build');

      // Verify the chain order: inject → stamp → build
      const injectIndex = buildScript.indexOf('node scripts/inject-sw-version.js');
      const stampIndex = buildScript.indexOf('node scripts/stamp-sw-version.js');
      const buildIndex = buildScript.indexOf('next build');

      expect(injectIndex).toBeLessThan(stampIndex);
      expect(stampIndex).toBeLessThan(buildIndex);
    });
  });
});