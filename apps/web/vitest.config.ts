// SPDX-License-Identifier: AGPL-3.0-only
// Unit tests of the worker's logic run in Node, without SvelteKit.
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['src/**/*.test.ts'], environment: 'node' } });
