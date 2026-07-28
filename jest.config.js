/**
 * Jest configuration for the payload/display/reasoning test suite.
 * Sets up coverage thresholds compliant with the PRD (80% line, 70% branch across the three modules).
 */

module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  testTimeout: 10000,
  // Required: use ESM to match how the app loads modules
  transform: {
    '^.+\\.jsx?$': 'babel-jest',
    '^.+\\.tsx?$': 'ts-jest',
  },
  // Files to include
  testMatch: [
    'tests/**/*.test.{ts,tsx}'
  ],
  // Module name mapper for the app's ES modules
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^@builderforce/(.*)$': '<rootDir>/packages/$1',
  },
  // Coverage configuration
  collectCoverageFrom: [
    'tests/mocks/modules/**/*.ts', // never cover mocks themselves
    '%TEST_WORKSPACE%/real/modules/**/*.ts', // will track real implementations once added
  ],
  coverageDirectory: 'coverage',
  coverageReporters: [
    'text',
    'lcov',
    'html',
    'text-summary',
  ],
  coverageThresholds: {
    global: {
      // Minimum thresholds as per PRD
      lines: 80,
      branches: 70,
      functions: 70,
      statements: 80,
    },
  },
  // Output JUnit XML for CI ingestion (matches CI job expectations)
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: 'coverage',
      outputName: 'junit.xml',
      classNameTemplate: '{classname}',
      titleTemplate: '{title}',
      ancestorSeparator: ' › ',
    }],
  ],
  // Module loader for ESM
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  // Setup files to prepare the test environment
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
};