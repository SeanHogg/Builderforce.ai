/** The ONE place the bundled analyzers' versions are pinned (a tiny module, so a test can read the real values cheaply). */
export const TYPESCRIPT_PIN = 'typescript@5.6.3';
export const ANALYZER_VERSIONS = {
  'dependency-cruiser': '16.10.4',
  jscpd: '4.0.5',
  knip: '5.30.0',
} as const;
