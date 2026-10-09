import { describe, expect, it } from 'vitest';
import { importedPackages, packageOfSpecifier, undeclaredDependencies } from './undeclaredDependencies';

const MANIFEST = JSON.stringify({ dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' }, devDependencies: { vite: '^4' } });

describe('packageOfSpecifier', () => {
  it('names the package a specifier installs from, and nothing for local paths', () => {
    expect(packageOfSpecifier('react-dom/client')).toBe('react-dom');
    expect(packageOfSpecifier('@tanstack/react-query/devtools')).toBe('@tanstack/react-query');
    expect(packageOfSpecifier('./Layout')).toBeNull();
    expect(packageOfSpecifier('/src/main.jsx')).toBeNull();
    expect(packageOfSpecifier('node:path')).toBeNull();
    expect(packageOfSpecifier('https://esm.sh/x')).toBeNull();
  });
});

describe('importedPackages', () => {
  it('reads every import form once', () => {
    const source = [
      "import React, { useState } from 'react';",
      "import { BrowserRouter } from \"react-router-dom\";",
      "import './App.css';",
      "export { x } from 'lodash/x';",
      "const m = await import('dayjs');",
      "import 'react';",
    ].join('\n');
    expect(importedPackages(source)).toEqual(['react', 'react-router-dom', 'lodash', 'dayjs']);
  });
});

describe('undeclaredDependencies', () => {
  // Session local-148925cf: App.jsx imported react-router-dom into a React-only starter.
  it('names an imported package the manifest does not declare', () => {
    const app = "import React from 'react';\nimport { BrowserRouter, Routes } from 'react-router-dom';\nimport Layout from './components/Layout';";
    expect(undeclaredDependencies('src/App.jsx', app, MANIFEST)).toEqual(['react-router-dom']);
  });

  it('is quiet for declared packages, non-script files, and a missing or broken manifest', () => {
    expect(undeclaredDependencies('src/main.jsx', "import ReactDOM from 'react-dom/client';", MANIFEST)).toEqual([]);
    expect(undeclaredDependencies('src/App.css', "@import 'normalize.css';", MANIFEST)).toEqual([]);
    expect(undeclaredDependencies('src/App.jsx', "import x from 'zod';", null)).toEqual([]);
    expect(undeclaredDependencies('src/App.jsx', "import x from 'zod';", '{ not json')).toEqual([]);
  });
});
