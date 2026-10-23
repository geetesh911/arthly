// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { AMFI_CAPS_PAGE } from '../caps/caps.ts';
import { FUND_SOURCES, fundListings } from '../fund-holdings/sources.ts';
import { INDEX_SOURCES } from '../indices/data.ts';
import { NSE_LISTS } from '../reference.ts';

import { FX_URL, RelayClient } from './client.ts';
import { AMFI_URL, bseUrl, nseUrl, recentWeekdays, relay, type RelayEnv } from './server.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dirname, '../feed/fixtures', name)));
const capsFixture = (name: string) =>
  readFileSync(join(import.meta.dirname, '../caps/fixtures', name));
const CAPS_PAGE = capsFixture('categorisation-of-stocks.html').toString('utf8');
const CAPS_LIST = new Uint8Array(capsFixture('AverageMarketCapitalization30Jun2026.xlsx'));
const CAPS_URL = 'https://portal.amfiindia.com/spages/AverageMarketCapitalization30Jun2026.xlsx';
const text = (name: string) => new TextDecoder().decode(fixture(name));
const indexFile = (name: string) =>
  readFileSync(join(import.meta.dirname, '../indices/fixtures', name), 'utf8');
const NSE_INDICES = INDEX_SOURCES.nse.url('2026-10-22');
const BSE_INDICES = INDEX_SOURCES.bse.url('2026-10-22');

// Thursday 22 October 2026, 22:00 in India.
const NOW = new Date('2026-10-22T16:30:00Z');
const BASE = 'https://app.test/api/prices/';

/** A fetch that answers from a table of URLs, and records what was asked. */
function sites(table: Record<string, () => Response>) {
  const asked: string[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);

    asked.push(url);

    return table[url]?.() ?? new Response('Not found', { status: 404 });
  }) as typeof globalThis.fetch;

  return { fetch, asked };
}

function memoryCache() {
  const store = new Map<string, Response>();

  return {
    store,
    async match(key: RequestInfo | URL) {
      return store.get(String(key instanceof Request ? key.url : key))?.clone();
    },
    async put(key: RequestInfo | URL, res: Response) {
      store.set(String(key instanceof Request ? key.url : key), res);
    },
  };
}

const get = (source: string, env: RelayEnv) => relay(source, new Request(`${BASE}${source}`), env);

describe('the relay', () => {
  it('serves the whole disclosure index and rejects unapproved workbook destinations', async () => {
    const { fetch, asked } = sites({});
    const index = await get('fund-disclosures', { fetch, now: () => NOW });

    expect(index.status).toBe(502);
    const listings = Object.values(FUND_SOURCES).flatMap((s) =>
      fundListings(s, '2026-10-22').map((r) => r.url),
    );

    expect(asked.sort()).toEqual(listings.sort());
    const bad = new Request(
      `${BASE}fund-workbook?url=${encodeURIComponent('http://127.0.0.1/a.xlsx')}`,
    );

    expect((await relay('fund-workbook', bad, { fetch, now: () => NOW })).status).toBe(400);
    expect(asked).toHaveLength(listings.length);
  });

  it('keeps one cache entry per workbook, however its address is written', async () => {
    const url =
      'https://files.hdfcfund.com/s3fs-public/2026-10/Monthly%20HDFC%20Top%20100%20Fund%20-%2030%20September%202026_0.xlsx?VersionId=abc';
    const { fetch, asked } = sites({ [url]: () => new Response('workbook') });
    const env = { fetch, now: () => NOW, cache: memoryCache() };
    const run = (query: string) =>
      relay('fund-workbook', new Request(`${BASE}fund-workbook?${query}`), env);

    expect((await run(`url=${encodeURIComponent(url)}`)).status).toBe(200);
    expect((await run(`url=${encodeURIComponent(url.replaceAll('%20', ' '))}&x=1`)).status).toBe(
      200,
    );
    expect((await run(`url=${encodeURIComponent(`${url}&cb=2`)}`)).status).toBe(400);
    expect(asked).toEqual([url]);
  });

  it('caches separate approved workbook URLs separately', async () => {
    const first =
      'https://amc.ppfas.com/downloads/portfolio-disclosure/2026/PPFAS_Monthly_Portfolio_Report_August_31_2026.xls';
    const second =
      'https://amc.ppfas.com/downloads/portfolio-disclosure/2026/PPFAS_Monthly_Portfolio_Report_September_30_2026.xls';
    const { fetch, asked } = sites({
      [first]: () => new Response('first'),
      [second]: () => new Response('second'),
    });
    const cache = memoryCache();
    const env = { fetch, now: () => NOW, cache };
    const run = (url: string) =>
      relay(
        'fund-workbook',
        new Request(`${BASE}fund-workbook?url=${encodeURIComponent(url)}`),
        env,
      );

    expect(await (await run(first)).text()).toBe('first');
    expect(await (await run(second)).text()).toBe('second');
    expect(await (await run(first)).text()).toBe('first');
    expect(asked).toEqual([first, second]);
  });

  it('does not cache a completely failed disclosure index', async () => {
    let up = false;
    const url =
      'https://amc.ppfas.com/downloads/portfolio-disclosure/2026/PPFAS_Monthly_Portfolio_Report_September_30_2026.xls';
    const fetch = (async (input: RequestInfo | URL) =>
      up && String(input) === FUND_SOURCES.ppfas.listing
        ? new Response(`<a href="${url}">Consolidated</a>`)
        : new Response('offline', { status: 503 })) as typeof globalThis.fetch;
    const cache = memoryCache();

    expect((await get('fund-disclosures', { fetch, now: () => NOW, cache })).status).toBe(502);
    expect(cache.store.size).toBe(0);
    up = true;
    const response = await get('fund-disclosures', { fetch, now: () => NOW, cache });

    expect(response.status).toBe(200);
    expect(((await response.json()) as { files: unknown[] }).files).toHaveLength(1);
  });
  it('relays only the fixed NSE classification lists', async () => {
    const csv = 'Company Name,Industry,Symbol,Series,ISIN Code\nOne,IT,ONE,EQ,INE001';
    const { fetch, asked } = sites(
      Object.fromEntries(Object.values(NSE_LISTS).map((url) => [url, () => new Response(csv)])),
    );
    const res = await get('nse-reference', { fetch, now: () => NOW });

    expect(res.status).toBe(200);
    expect(asked.sort()).toEqual(Object.values(NSE_LISTS).sort());
    expect(res.headers.get('x-relay-source')).toBe('nse-reference');
    expect(((await res.json()) as { rows: unknown[] }).rows).toHaveLength(1);
  });
  it('stops reading an NSE list that is far too large', async () => {
    const csv = 'Company Name,Industry,Symbol,Series,ISIN Code\nOne,IT,ONE,EQ,INE001';
    const huge = () => new Response(`${csv}\n${'Two,IT,TWO,EQ,INE002\n'.repeat(200_000)}`);
    const { fetch } = sites(
      Object.fromEntries(
        Object.entries(NSE_LISTS).map(([cap, url]) => [
          url,
          cap === 'large' ? huge : () => new Response(csv),
        ]),
      ),
    );
    const res = await get('nse-reference', { fetch, now: () => NOW });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { stale: string[] }).stale).toEqual(['large']);
  });
  it('passes on AMFI’s NAV file', async () => {
    const { fetch, asked } = sites({ [AMFI_URL]: () => new Response(text('NAVAll.txt')) });
    const res = await get('amfi', { fetch, now: () => NOW });

    expect(asked).toEqual([AMFI_URL]);
    expect(res.headers.get('x-relay-source')).toBe('amfi');
    expect(res.headers.get('cache-control')).toBe('public, max-age=10800');
    expect(await res.text()).toContain('Scheme Code');
  });

  it('goes back to the last day NSE has a file for', async () => {
    const zip = () => new Response(fixture('nse-bhavcopy.csv.zip'));
    const { fetch, asked } = sites({ [nseUrl('2026-10-21')]: zip });
    const res = await get('exchange', { fetch, now: () => NOW });

    expect(res.headers.get('x-relay-source')).toBe('nse');
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(asked).toEqual([nseUrl('2026-10-22'), bseUrl('2026-10-22'), nseUrl('2026-10-21')]);
  });

  it('stops asking NSE once it refuses, and takes BSE’s file', async () => {
    const { fetch, asked } = sites({
      [nseUrl('2026-10-22')]: () => new Response('Access denied', { status: 403 }),
      // BSE answers a day with no file with its home page.
      [bseUrl('2026-10-22')]: () =>
        new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
      [bseUrl('2026-10-21')]: () => new Response(text('bse-bhavcopy.csv')),
    });
    const res = await get('exchange', { fetch, now: () => NOW });

    expect(res.headers.get('x-relay-source')).toBe('bse');
    expect(asked).toEqual([nseUrl('2026-10-22'), bseUrl('2026-10-22'), bseUrl('2026-10-21')]);
  });

  it('skips weekends, and gives up after a week', async () => {
    const { fetch, asked } = sites({});
    const res = await get('exchange', { fetch, now: () => NOW });

    expect(res.status).toBe(502);
    expect(await res.text()).toBe("NSE and BSE didn't send a closing-price file");
    expect(asked.filter((u) => u.includes('NSE'))).toEqual(
      ['2026-10-22', '2026-10-21', '2026-10-20', '2026-10-19', '2026-10-16'].map(nseUrl),
    );
  });

  it('counts days in India', () => {
    // 01:30 on Friday in India is still Thursday in UTC.
    expect(recentWeekdays(new Date('2026-10-22T20:00:00Z'), 2)).toEqual([
      '2026-10-23',
      '2026-10-22',
    ]);
  });

  it('relays every index in NSE’s and BSE’s newest daily files', async () => {
    const { fetch, asked } = sites({
      [NSE_INDICES]: () => new Response(indexFile('ind_close_all_22102026.csv')),
      [BSE_INDICES]: () => new Response(indexFile('allindices_22102026.csv')),
    });
    const res = await get('index-data', { fetch, now: () => NOW });

    expect(res.headers.get('x-relay-source')).toBe('index-data');
    const data = await res.json();

    expect(data.series).toHaveLength(29);
    expect(data.sources.map((s: { date: string }) => s.date)).toEqual(['2026-10-22', '2026-10-22']);
    expect(asked.sort()).toEqual([NSE_INDICES, BSE_INDICES]);
  });

  it('serves one exchange’s indices without caching them while the other is down', async () => {
    let bseUp = false;
    const cache = memoryCache();
    const { fetch } = sites({
      [NSE_INDICES]: () => new Response(indexFile('ind_close_all_22102026.csv')),
      [BSE_INDICES]: () =>
        bseUp
          ? new Response(indexFile('allindices_22102026.csv'))
          : new Response('busy', { status: 503 }),
    });
    const env = { fetch, now: () => NOW, cache };
    const partial = await (await get('index-data', env)).json();

    expect(partial.sources[1].failure).toBe('The site refused the request');
    expect(partial.series).toHaveLength(17);
    expect(cache.store.size).toBe(0);
    bseUp = true;
    expect((await (await get('index-data', env)).json()).series).toHaveLength(29);
    expect(cache.store.size).toBe(1);
  });

  it('says so when neither exchange sends an index file', async () => {
    const { fetch } = sites({});
    const res = await get('index-data', { fetch, now: () => NOW });

    expect(res.status).toBe(502);
    expect(await res.text()).toBe(
      'No NSE index file in the last week; No BSE index file in the last week',
    );
  });

  it('stops reading an index file that is far too large', async () => {
    const huge = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
    });
    const { fetch } = sites({
      [NSE_INDICES]: () => new Response(huge),
      [BSE_INDICES]: () => new Response(indexFile('allindices_22102026.csv')),
    });
    const data = await (await get('index-data', { fetch, now: () => NOW })).json();

    expect(data.sources[0].failure).toBe('The response is too large');
  });

  it('passes on AMFI’s newest cap list workbook with its address', async () => {
    const { fetch, asked } = sites({
      [AMFI_CAPS_PAGE]: () => new Response(CAPS_PAGE, { headers: { 'content-type': 'text/html' } }),
      [CAPS_URL]: () => new Response(CAPS_LIST),
    });
    const res = await get('amfi-caps', { fetch, now: () => NOW });

    expect(res.status).toBe(200);
    expect(res.headers.get('x-relay-source')).toBe('amfi-caps');
    expect(res.headers.get('x-source-url')).toBe(CAPS_URL);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(CAPS_LIST);
    expect(asked).toEqual([AMFI_CAPS_PAGE, CAPS_URL]);
  });

  it('says why when AMFI’s page has no cap list, and doesn’t keep that answer', async () => {
    const cache = memoryCache();
    const { fetch } = sites({ [AMFI_CAPS_PAGE]: () => new Response('<html></html>') });
    const res = await get('amfi-caps', { fetch, now: () => NOW, cache });

    expect(res.status).toBe(502);
    expect(await res.text()).toBe('AMFI’s page has no cap list');
    expect(cache.store.size).toBe(0);
  });

  it('fetches nothing else', async () => {
    const { fetch, asked } = sites({});

    expect((await get('google.com', { fetch, now: () => NOW })).status).toBe(404);
    const post = new Request(`${BASE}amfi`, { method: 'POST' });

    expect((await relay('amfi', post, { fetch, now: () => NOW })).status).toBe(405);
    expect(asked).toEqual([]);
  });

  it('keeps an answer for a few hours, but not a failure', async () => {
    const cache = memoryCache();
    let amfiUp = false;
    const { fetch, asked } = sites({
      [AMFI_URL]: () =>
        amfiUp ? new Response(text('NAVAll.txt')) : new Response('down', { status: 503 }),
    });
    const env = { fetch, now: () => NOW, cache };

    expect((await get('amfi', env)).status).toBe(502);
    expect(cache.store.size).toBe(0);
    amfiUp = true;
    expect((await get('amfi', env)).status).toBe(200);
    const again = await relay('amfi', new Request(`${BASE}amfi?x=1`), env);

    expect(await again.text()).toContain('Scheme Code');
    expect(asked).toEqual([AMFI_URL, AMFI_URL]);
  });
});

describe('the relay client', () => {
  const relayed = (body: BodyInit, source: string) => () =>
    new Response(body, { headers: { 'x-relay-source': source } });
  const fx = () => Response.json({ date: '2026-10-21', rates: { INR: 88.12 } });

  it('reads AMFI, NSE’s zip and the USD rate into prices', async () => {
    const { fetch } = sites({
      [`${BASE}amfi`]: relayed(text('NAVAll.txt'), 'amfi'),
      [`${BASE}exchange`]: relayed(fixture('nse-bhavcopy.csv.zip'), 'nse'),
      [FX_URL]: fx,
    });
    const latest = await new RelayClient(BASE).latest({ fetch });

    expect(latest.failed).toEqual([]);
    const price = (key: string) => latest.prices.find((p) => p.key === key);

    expect(price('amfi:147481')).toMatchObject({ date: '2026-10-21', close: 30.8127 });
    expect(price('isin:IN0020230184')).toMatchObject({ close: 15155.6, source: 'nse' });
    expect(price('nse:NIFTYBEES')?.close).toBe(259.57);
    expect(price('fx:USDINR')).toMatchObject({ date: '2026-10-21', close: 88.12 });
    expect(latest.schemes.find((s) => s.code === '147481')?.isinGrowth).toBe('INF879O01100');
  });

  it('reads BSE’s file, which isn’t zipped', async () => {
    const { fetch } = sites({ [`${BASE}exchange`]: relayed(text('bse-bhavcopy.csv'), 'bse') });
    const file = await new RelayClient(BASE).exchange({ fetch });

    expect(file.source).toBe('bse');
    expect(file.rows.length).toBeGreaterThan(0);
  });

  it('keeps what it could fetch when one part fails', async () => {
    const { fetch } = sites({
      [`${BASE}amfi`]: relayed(text('NAVAll.txt'), 'amfi'),
      [`${BASE}exchange`]: () =>
        new Response("NSE and BSE didn't send a closing-price file", { status: 502 }),
      [FX_URL]: fx,
    });
    const latest = await new RelayClient(BASE).latest({ fetch });

    expect(latest.failed).toEqual([
      { part: 'stocks', reason: "NSE and BSE didn't send a closing-price file" },
    ]);
    expect(latest.prices.some((p) => p.key === 'amfi:147481')).toBe(true);
  });

  it('checks the NSE lists before using them', async () => {
    const row = { symbol: 'ONE', isin: 'INE001', industry: 'IT', marketCap: 'large' };
    const nse = (rows: unknown[]) => () =>
      Response.json(
        { date: '2026-10-21', rows, stale: [] },
        { headers: { 'x-relay-source': 'nse-reference' } },
      );
    const good = sites({ [`${BASE}nse-reference`]: nse([row]) });

    expect((await new RelayClient(BASE).latest({ fetch: good.fetch })).nse?.rows).toEqual([row]);
    const bad = sites({ [`${BASE}nse-reference`]: nse([row, { ...row, isin: undefined }]) });

    expect((await new RelayClient(BASE).latest({ fetch: bad.fetch })).nse).toBeUndefined();
  });

  it('checks index data before using it', async () => {
    const answer = (data: unknown) => () =>
      Response.json(data, { headers: { 'x-relay-source': 'index-data' } });
    const data = {
      version: 1,
      date: '2026-10-22',
      sources: [{ provider: 'nse', url: NSE_INDICES, date: '2026-10-22' }],
      series: [
        {
          id: 'nse:nifty-50',
          provider: 'nse',
          name: 'Nifty 50',
          basis: 'price',
          currency: 'INR',
          date: '2026-10-22',
          close: 22687.65,
        },
      ],
      history: {},
    };
    const good = sites({ [`${BASE}index-data`]: answer(data) });

    expect(await new RelayClient(BASE).indices({ fetch: good.fetch })).toEqual(data);
    const bad = sites({
      [`${BASE}index-data`]: answer({ ...data, series: [{ ...data.series[0], close: -1 }] }),
    });

    await expect(new RelayClient(BASE).indices({ fetch: bad.fetch })).rejects.toThrow(
      'Unexpected index data',
    );
  });

  it('reads the cap list workbook it relays, and only from AMFI', async () => {
    const list = (url?: string) => () =>
      new Response(CAPS_LIST, {
        headers: { 'x-relay-source': 'amfi-caps', ...(url ? { 'x-source-url': url } : {}) },
      });
    const good = sites({ [`${BASE}amfi-caps`]: list(CAPS_URL) });
    const caps = await new RelayClient(BASE).caps({ fetch: good.fetch }, '2026-10-23');

    expect(caps).toMatchObject({ asOf: '2026-06-30', date: '2026-10-23', url: CAPS_URL });
    expect(caps.rows).toHaveLength(9);
    const unnamed = sites({ [`${BASE}amfi-caps`]: list() });

    await expect(
      new RelayClient(BASE).caps({ fetch: unnamed.fetch }, '2026-10-23'),
    ).rejects.toThrow('Unapproved cap list URL');
  });

  it('says so when the app is hosted without the relay', async () => {
    // Static hosts answer unknown paths with the app's page.
    const page = () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
    const { fetch } = sites({ [`${BASE}amfi`]: page, [`${BASE}exchange`]: page });
    const latest = await new RelayClient(BASE).latest({ fetch });

    expect(latest.failed.map((f) => f.reason)).toEqual([
      'this host has no price relay',
      'this host has no price relay',
      'Frankfurter: 404',
    ]);
  });
});
