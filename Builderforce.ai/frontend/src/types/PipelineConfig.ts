/**
 * Pipeline configuration that controls file classification and gate logic.
 *
 * This shape corresponds to pipeline.config.yaml referenced in FR-1
 * and FR-8. It is stored in a workspace-scoped file so board users can
 * edit source/doc patterns without touching code.
 *
 * Source/doc patterns support micromatch syntax (glob-stars supported).
 * The schema below is the canonical TypeScript representation.
 */

export interface PipelineConfig {
  /** Recognized source directories for implementation signals. */
  sourceDirs: string[];

  /** Glob patterns for test files (e.g., **/*.test.ts). */
  testPatterns: string[];

  /** Glob patterns for documentation-only files. */
  docPatterns: string[];
}

/**
 * Default workspace configuration.
 * Serves as the starting point when pipeline.config.yaml is missing or empty.
 */
export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  sourceDirs: ['src/', 'lib/', 'app/', 'packages/', 'components/', 'api/'],
  testPatterns: ['**/*.test.*', '**/*.spec.*', '**/tests/**', '**/__tests__/**'],
  docPatterns: [
    '**/*.md',
    '**/docs/**',
    '**/*.rst',
    '**/*.txt',
    'CHANGELOG',
    'LICENSE',
    'NOTICE',
    'README*',
  ],
};

/**
 * Schema for pipeline.config.yaml frontmatter comment.
 * This string is written to the top of pipeline.config.yaml during version upgrades,
 * where the file is effectively a mapping of YAML to this interface.
 */
export const PIPELINE_CONFIG_YAML_COMMENT = `# BuilderForce Pipeline Configuration
# Edit this file to customize source/dir patterns without touching code.
# Matches are evaluated using micromatch (glob-star supported).
#
# Remember:
#   - sourceDirs: paths for implementation and core code
#   - testPatterns: patterns for test files
#   - docPatterns: patterns for documentation-only files (excluded from progress)
#
# Example:
#   sourceDirs:
#     - src/
#     - lib/
#   testPatterns:
#     - "**/*.{test,spec}.{ts,js}"
#   docPatterns:
#     - "**/*.md"
#     - "docs/**/*"
`;