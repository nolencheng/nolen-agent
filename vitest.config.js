import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'text-summary'],
      all: true,
      include: ['workers-site/**/*.js'],
      exclude: [
        'node_modules/',
        'test/',
        'workers-site/index.js',
        '**/*.test.js',
        '**/test-*.js'
      ],
      statements: 80,
      branches: 75,
      functions: 80,
      lines: 80
    }
  }
});
