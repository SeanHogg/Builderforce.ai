/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/...'],
  testMatch: [
    '**/qa-tests/**/*.test.ts',
  ],
  collectCoverageFrom: [
    'qa-tests/**/*.ts',
    '!qa-tests/**/*.d.ts',
    '!qa-tests/coverage/**',
    '!qa-tests/test-harness/**/*.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
  verbose: true,
  testTimeout: 10000,
  maxWorkers: '50%',
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
};