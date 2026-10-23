// SPDX-License-Identifier: AGPL-3.0-only
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/',
      '**/build/',
      '**/dist/',
      '**/.svelte-kit/',
      '**/fixtures/',
      '**/test-results/',
      '**/playwright-report/',
      '**/.wrangler/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.svelte'] },
    },
    rules: {
      // Hash routing: links are plain #/ fragments, so resolve() adds nothing.
      'svelte/no-navigation-without-resolve': 'off',
    },
  },
);
