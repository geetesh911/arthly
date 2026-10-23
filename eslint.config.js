// SPDX-License-Identifier: AGPL-3.0-only
import js from '@eslint/js';
import prettier from 'eslint-plugin-prettier/recommended';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import svelte from 'eslint-plugin-svelte';
import unusedImports from 'eslint-plugin-unused-imports';
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
  prettier,
  ...svelte.configs['flat/prettier'],
  {
    plugins: {
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
    },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // Prettier's config turns `curly` off, so these come after it.
      curly: ['error', 'all'],
      'padded-blocks': ['error', 'never'],
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: 'return' },
        { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
        { blankLine: 'any', prev: ['const', 'let', 'var'], next: ['const', 'let', 'var'] },
        { blankLine: 'always', prev: ['case', 'default'], next: '*' },
        { blankLine: 'always', prev: 'block-like', next: '*' },
        { blankLine: 'always', prev: '*', next: 'block-like' },
        // Lets grouped labels (`case 'a':` `case 'b':`) stay together; a gap there trips no-fallthrough.
        { blankLine: 'any', prev: ['case', 'default'], next: ['case', 'default'] },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-extra-boolean-cast': 'error',
      '@typescript-eslint/no-unused-expressions': [
        'error',
        { allowShortCircuit: true, allowTernary: true },
      ],
      // unused-imports reports unused symbols instead, so unused imports are autofixable.
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'error',
        { vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' },
      ],
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            // Side effect imports.
            ['^\\u0000'],
            // Packages. Svelte and SvelteKit come first.
            ['^svelte', '^@sveltejs/', '^\\$app/', '^@?\\w'],
            // The `#lib` subpath import.
            ['^#lib'],
            // Parent imports. Put `..` last.
            ['^\\.\\.(?!/?$)', '^\\.\\./?$'],
            // Other relative imports. Put same-folder imports and `.` last.
            ['^\\./(?=.*/)(?!/?$)', '^\\.(?!/?$)', '^\\./?$'],
          ],
        },
      ],
      'simple-import-sort/exports': 'error',
      // Formatting options come from the root `.prettierrc.json`.
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
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
      // Rune-aware replacement for the core rule.
      'prefer-const': 'off',
      'svelte/prefer-const': 'error',
      'svelte/block-lang': ['error', { script: 'ts' }],
      'svelte/button-has-type': 'error',
      'svelte/no-target-blank': 'error',
      'svelte/no-add-event-listener': 'error',
      'svelte/no-bind-value-on-checkable-inputs': 'error',
      'svelte/no-nested-style-tag': 'error',
      'svelte/valid-style-parse': 'error',
      'svelte/prefer-derived-over-derived-by': 'error',
      'svelte/prefer-style-directive': 'error',
      'svelte/spaced-html-comment': 'error',
    },
  },
  {
    // CLIs that print their output.
    files: ['scripts/**', 'packages/core/scripts/**', 'apps/price-feed/src/main.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
