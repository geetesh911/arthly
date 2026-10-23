// SPDX-License-Identifier: AGPL-3.0-only
// Cloudflare Pages Function: GET /api/prices/amfi and /api/prices/exchange. Cloudflare Pages
// runs every file under functions/ next to the app; relay() says what these fetch and why.
import { relay } from '../../../packages/core/src/plugins/prices/relay/server.ts';

interface Context {
  request: Request;
  params: { source?: string | string[] };
  waitUntil(promise: Promise<unknown>): void;
}

export function onRequest(context: Context): Promise<Response> {
  return relay(String(context.params.source), context.request, {
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
    cache: (caches as unknown as { default: Cache }).default,
    waitUntil: (promise) => context.waitUntil(promise),
  });
}
