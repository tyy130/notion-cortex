const tsParser = require('@typescript-eslint/parser');

module.exports = [
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
  {
    files: ['**/src/**/*.ts', '**/tests/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {},
  },
];
