// SPDX-License-Identifier: AGPL-3.0-only
// The price relay, run as a Cloudflare Pages Function (functions/api/prices/[source].ts). AMFI,
// NSE, BSE and the fund houses don't let web pages read their files, so the relay fetches them
// for the app: AMFI's NAVs and stock categorisation, a closing-price file, NSE's index lists,
// NSE's and BSE's daily all-index files, and the monthly portfolio lists and workbooks of the AMCs
// in fund-holdings/sources.ts. It only ever fetches whole public files, so it learns nothing about
// what anyone holds, and it can't be used to reach any other site.
import { fromMs, type ISODate, weekdaysBack } from '../../../util/dates.ts';
import { capped } from '../../../util/http.ts';
import { fetchAmfiCaps } from '../caps/caps.ts';
import {
  fetchFundDisclosureIndex,
  fetchFundWorkbook,
  isFundWorkbookUrl,
} from '../fund-holdings/sources.ts';
import { fetchIndexData } from '../indices/data.ts';
import { fetchNseReference } from '../reference.ts';

export interface RelayEnv {
  fetch: typeof fetch;
  now: () => Date;
  /** Cloudflare's cache; answers are kept for MAX_AGE. */
  cache?: Pick<Cache, 'match' | 'put'> | undefined;
  /** Lets a cache write finish after the answer is sent. */
  waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
}

/** Each answer is reused for 3 hours, so pressing Refresh again doesn't refetch. */
export const MAX_AGE = 3 * 3600;

export const AMFI_URL = 'https://portal.amfiindia.com/spages/NAVAll.txt';
export const nseUrl = (day: ISODate) =>
  `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${day.replaceAll('-', '')}_F_0000.csv.zip`;
export const bseUrl = (day: ISODate) =>
  `https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_${day.replaceAll('-', '')}_F_0000.CSV`;

// The exchanges turn away requests that don't look like a browser.
const HEADERS = { 'user-agent': 'Mozilla/5.0 (compatible; arthly price relay)' };
// Each NSE index list and each exchange's daily index file is under 100 KB.
const MAX_LIST_BYTES = 2 * 1024 * 1024;

/** Today's date in India. */
const indiaToday = (now: Date): ISODate => fromMs(now.getTime() + 5.5 * 3600_000);

/** Weekdays from today in India back, since the exchanges publish nothing at weekends. */
export const recentWeekdays = (now: Date, count: number): ISODate[] =>
  weekdaysBack(indiaToday(now), count);

/**
 * The file, or why not: "missing" when there's none for that day, "refused" when the site
 * turned the request away or didn't answer, so trying it for other days is pointless.
 */
async function get(env: RelayEnv, url: string): Promise<Response | 'missing' | 'refused'> {
  try {
    const res = await env.fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
    // BSE answers a day with no file with its home page, not a 404.
    const page = res.headers.get('content-type')?.startsWith('text/html');

    if (res.ok && !page) {
      return res;
    }

    await res.body?.cancel();

    return res.status === 404 || page ? 'missing' : 'refused';
  } catch {
    return 'refused';
  }
}

/** An answer to pass on; `keep` false stops it being cached, so the next request tries again. */
function answer(res: Response, type: string, source: string, keep = true): Response {
  return new Response(res.body, {
    headers: {
      'content-type': type,
      'cache-control': keep ? `public, max-age=${MAX_AGE}` : 'no-store',
      'x-relay-source': source,
    },
  });
}

async function fetchSource(source: string, env: RelayEnv): Promise<Response> {
  if (source === 'fund-disclosures') {
    const index = await fetchFundDisclosureIndex(env.fetch, indiaToday(env.now()));

    if (!index.files.length) {
      return Response.json(index, { status: 502, headers: { 'cache-control': 'no-store' } });
    }

    return answer(Response.json(index), 'application/json', 'fund-disclosures');
  }

  if (source === 'nse-reference') {
    try {
      const data = await fetchNseReference(async (url) => {
        const res = await get(env, url);

        if (!(res instanceof Response)) {
          throw new Error('NSE list unavailable');
        }

        return capped(res, MAX_LIST_BYTES).text();
      }, indiaToday(env.now()));

      return answer(Response.json(data), 'application/json', 'nse-reference');
    } catch {
      return new Response('NSE classification lists are unavailable', { status: 502 });
    }
  }

  if (source === 'index-data') {
    try {
      const data = await fetchIndexData(async (url) => {
        const res = await get(env, url);

        if (res === 'missing') {
          return undefined;
        }

        if (res === 'refused') {
          throw new Error('The site refused the request');
        }

        return capped(res, MAX_LIST_BYTES).text();
      }, indiaToday(env.now()));
      // While one exchange is down, don't keep the answer for hours.
      const whole = data.sources.every((s) => !s.failure);

      return answer(Response.json(data), 'application/json', 'index-data', whole);
    } catch (error) {
      return new Response((error as Error).message, { status: 502 });
    }
  }

  if (source === 'amfi-caps') {
    // The workbook itself: parsing it is too much work for a Cloudflare request, so the app does.
    try {
      const { url, response } = await fetchAmfiCaps(env.fetch, indiaToday(env.now()));
      const res = answer(
        response,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'amfi-caps',
      );

      res.headers.set('x-source-url', url);

      return res;
    } catch (error) {
      return new Response((error as Error).message, { status: 502 });
    }
  }

  if (source === 'amfi') {
    const res = await get(env, AMFI_URL);

    if (res instanceof Response) {
      return answer(res, 'text/plain; charset=utf-8', 'amfi');
    }

    return new Response("AMFI didn't send its NAV file", { status: 502 });
  }

  if (source === 'exchange') {
    // Today's file appears in the evening, and holidays have none, so go back up to a week.
    const sites = [
      { url: nseUrl, type: 'application/zip', name: 'nse', open: true },
      { url: bseUrl, type: 'text/csv; charset=utf-8', name: 'bse', open: true },
    ];

    for (const day of recentWeekdays(env.now(), 5)) {
      for (const site of sites.filter((s) => s.open)) {
        const res = await get(env, site.url(day));

        if (res instanceof Response) {
          return answer(res, site.type, site.name);
        }

        if (res === 'refused') {
          site.open = false;
        }
      }

      if (!sites.some((s) => s.open)) {
        break;
      }
    }

    return new Response("NSE and BSE didn't send a closing-price file", { status: 502 });
  }

  return new Response('Not found', { status: 404 });
}

/**
 * Answers GET /api/prices/<source>, where source is "amfi", "amfi-caps", "exchange",
 * "nse-reference", "index-data", "fund-disclosures", or "fund-workbook?url=<a workbook listed by
 * fund-disclosures>".
 */
export async function relay(source: string, request: Request, env: RelayEnv): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(request.url);
  let workbook: string | undefined;

  if (source === 'fund-workbook') {
    const asked = url.searchParams.get('url');

    if (!asked || !isFundWorkbookUrl(asked)) {
      return new Response('Unapproved portfolio URL', { status: 400 });
    }

    workbook = new URL(asked).href;
  }

  // One cache entry per source, and per workbook however its URL was written; any other query
  // string is ignored.
  const key = new Request(
    `${url.origin}${url.pathname}${workbook ? `?url=${encodeURIComponent(workbook)}` : ''}`,
  );
  const hit = await env.cache?.match(key).catch(() => undefined);

  if (hit) {
    return hit;
  }

  let res: Response;

  if (workbook) {
    try {
      res = answer(
        await fetchFundWorkbook(env.fetch, workbook),
        'application/octet-stream',
        'fund-workbook',
      );
    } catch {
      res = new Response('The fund portfolio workbook is unavailable', { status: 502 });
    }
  } else {
    res = await fetchSource(source, env);
  }

  if (res.ok && env.cache && res.headers.get('cache-control') !== 'no-store') {
    const put = env.cache.put(key, res.clone()).catch(() => undefined);

    if (env.waitUntil) {
      env.waitUntil(put);
    } else {
      await put;
    }
  }

  return res;
}
