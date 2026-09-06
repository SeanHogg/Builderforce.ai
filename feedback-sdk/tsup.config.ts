import { defineConfig } from 'tsup';
import { browserSnippetConfig } from '../scripts/tsup.base.mjs';

// esm/cjs for bundlers + npm; iife (global.js) for the <script> snippet.
export default defineConfig(browserSnippetConfig({
  entry: ['src/index.ts'],
  globalName: 'BuilderforceFeedback',
}));
