import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js'],   // browser ES modules
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: globals.browser },
  },
  {
    files: ['scripts/**/*.js', '*.config.js'],   // node
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: globals.node },
  },
  {
    // Tests run in node but use window/document inside page.evaluate() callbacks.
    files: ['tests/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Unused symbols are common in this iterative codebase (helpers kept for symmetry,
    // WIP); warn rather than fail the lint.
    rules: { 'no-unused-vars': 'warn' },
  },
  { ignores: ['node_modules/', 'test-results/', 'playwright-report/'] },
];
