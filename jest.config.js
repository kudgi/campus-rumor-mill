module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/tests/setup.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/db/migrate.ts'],
  coverageThreshold: {
    global: {
      lines: 30,
      functions: 8,
      branches: 3,
      statements: 30,
    },
  },
};
