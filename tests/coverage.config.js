/**
 * Jest coverage configuration for PRD #678 AC-3/AC-4.
 * - Line coverage: ≥ 80%
 * - Branch coverage: ≥ 70%
 * Generates coverage reports as monochrome, timestamped, CI-friendly artifacts.
 */
module.exports = {
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'html', 'lcov'],
  coverageThreshold: {
    global: {
      lines: 80,
      branches: 70,
      functions: 70,
      statements: 80,
    },
  },
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/tests/',
    '/tests/fixtures/',
  ],
  coverageProvider: 'v8',
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
};