// packages/integration-tests/jest.config.cjs
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  moduleNameMapper: {
    '^@nexus/shared$': '<rootDir>/../shared/src',
    '^@nexus/database$': '<rootDir>/../database/src'
  }
};
