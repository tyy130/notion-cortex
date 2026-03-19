import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    // Required for NodeNext ESM: vitest must honour the same conditions
    // as the Node.js runtime when resolving conditional exports in packages.
    conditions: ['node', 'import', 'module'],
  },
});
