// SPDX-License-Identifier: AGPL-3.0-only
// The data worker's built files, from the workerFiles plugin in vite.config.ts.
declare module 'virtual:worker-files' {
  const files: string[];
  export default files;
}
