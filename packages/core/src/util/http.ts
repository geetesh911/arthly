// SPDX-License-Identifier: AGPL-3.0-only
/** The same response, but reading its body fails once it passes `limit` bytes. */
export function capped(
  res: Response,
  limit: number,
  message = 'The response is too large',
): Response {
  if (Number(res.headers.get('content-length')) > limit) {
    void res.body?.cancel();
    throw new Error(message);
  }

  if (!res.body) {
    return res;
  }

  let count = 0;
  // Counting as it streams also catches answers with no Content-Length.
  const body = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        count += chunk.byteLength;

        if (count > limit) {
          throw new Error(message);
        }

        controller.enqueue(chunk);
      },
    }),
  );

  return new Response(body, { status: res.status, headers: res.headers });
}

/**
 * Fetches `url`, following up to three redirects while `allowed` approves each address, with the
 * body capped at `limit` bytes. `noun` names the file in error messages. With `json`, it posts
 * that body instead and follows no redirect.
 */
export async function fetchAllowed(
  fetcher: typeof fetch,
  url: string,
  options: {
    allowed: (url: string) => boolean;
    limit: number;
    headers: Record<string, string>;
    noun: string;
    json?: string;
  },
): Promise<Response> {
  const { allowed, limit, headers, noun, json } = options;
  let current = url;

  for (let attempt = 0; attempt < 4; attempt++) {
    if (!allowed(current)) {
      throw new Error(`Unapproved ${noun} URL`);
    }

    const res = await fetcher(current, {
      ...(json === undefined
        ? { headers }
        : {
            method: 'POST',
            headers: { ...headers, 'content-type': 'application/json; charset=utf-8' },
            body: json,
          }),
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');

      await res.body?.cancel();

      if (json !== undefined) {
        throw new Error(`Unexpected ${noun} redirect`);
      }

      if (!location) {
        throw new Error(`Missing ${noun} redirect`);
      }

      current = new URL(location, current).href;
      continue;
    }

    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`Source returned ${res.status}`);
    }

    const Noun = noun.charAt(0).toUpperCase() + noun.slice(1);
    const bounded = capped(res, limit, `${Noun} response is too large`);

    if (!bounded.body) {
      throw new Error(`Empty ${noun} response`);
    }

    return bounded;
  }

  throw new Error(`Too many ${noun} redirects`);
}
