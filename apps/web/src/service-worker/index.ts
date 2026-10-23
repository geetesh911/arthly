// SPDX-License-Identifier: AGPL-3.0-only
// Keeps the app working offline, and receives files shared from other apps on Android.
// Only the app's own files are cached here; prices live in the encrypted store.
import { version } from '$app/env';
import { assets, immutable, prerendered } from '$app/manifest';
import { self as sw } from '$app/service-worker';
import workerFiles from 'virtual:worker-files';

const CACHE = `app-${version}`;
const SHARED = 'shared-files';
const scope = new URL(sw.registration.scope).pathname;
// _headers is Cloudflare's configuration, not a page file: the relay won't serve it, and one
// missing file stops the whole install. The Set drops the worker entry listed twice.
const ASSETS = [
  ...new Set(
    [...immutable, ...assets, ...prerendered]
      .map((f) => f.path.replace(/^\//, ''))
      .concat(workerFiles)
      .filter((path) => path !== '_headers'),
  ),
].map((path) => `${scope}${path}`);
if (!ASSETS.includes(scope)) ASSETS.push(scope);

sw.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE && k !== SHARED).map((k) => caches.delete(k))),
      ),
  );
});

sw.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void sw.skipWaiting();
});

async function receiveShare(request: Request): Promise<Response> {
  const form = await request.formData();
  const cache = await caches.open(SHARED);
  let n = 0;
  for (const value of form.getAll('files')) {
    if (typeof value === 'string') continue;
    await cache.put(
      `/shared/${n++}`,
      new Response(value, { headers: { 'x-name': encodeURIComponent(value.name) } }),
    );
  }
  return Response.redirect(`${scope}#/add?shared=${n}`, 303);
}

sw.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname.endsWith('/share')) {
    event.respondWith(receiveShare(event.request));
    return;
  }
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  // The price relay (functions/api/prices) always goes to the network.
  if (url.pathname.startsWith(`${scope}api/`)) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit =
        (await cache.match(url.pathname)) ??
        (url.pathname.endsWith('/') ? await cache.match(`${url.pathname}index.html`) : undefined);
      return hit ?? fetch(event.request);
    }),
  );
});
