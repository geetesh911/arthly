// SPDX-License-Identifier: AGPL-3.0-only
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { execSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';

// SvelteKit's offline file list leaves out the data worker's own chunks. The app's build records
// them and the service worker, built after it, imports the list as 'virtual:worker-files'.
function workerFiles(): Plugin {
  const id = 'virtual:worker-files';
  const files: string[] = [];

  return {
    name: 'worker-files',
    writeBundle(_, bundle) {
      if (this.environment.name !== 'client') {
        return;
      }

      files.push(...Object.keys(bundle).filter((f) => f.includes('/immutable/workers/')));
    },
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load: (key) => (key === `\0${id}` ? `export default ${JSON.stringify(files)};` : undefined),
  };
}

function buildName(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
}

// The price feed's origin; self-hosters with their own feed set PUBLIC_FEED_ORIGIN.
const feedOrigins = (process.env.PUBLIC_FEED_ORIGIN ?? 'https://*.github.io').split(
  /\s+/,
) as `${string}://${string}.${string}`[];

export default defineConfig({
  plugins: [
    workerFiles(),
    tailwindcss(),
    sveltekit({
      adapter: adapter({ pages: 'build', assets: 'build', strict: true }),
      router: { type: 'hash' },
      version: { name: buildName() },
      csp: {
        mode: 'hash',
        directives: {
          'default-src': ['self'],
          'script-src': ['self', 'wasm-unsafe-eval'],
          'worker-src': ['self', 'blob:'],
          // The relay is on the app's own origin; Frankfurter gives the USD rate.
          'connect-src': ['self', 'https://api.frankfurter.dev', ...feedOrigins],
          'img-src': ['self', 'data:', 'blob:'],
          'style-src': ['self', 'unsafe-inline'],
          'font-src': ['self'],
          'object-src': ['none'],
          'base-uri': ['none'],
          'form-action': ['self'],
        },
      },
    }),
  ],
  worker: { format: 'es' },
});
