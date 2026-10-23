// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import type { Instrument } from '../../../model/types.ts';
import { parseFundWorkbook } from '../fund-holdings/parse.ts';

import {
  type AmfiFile,
  type ExchangeFile,
  FEED_PATHS,
  type FxFile,
  historyGroup,
} from './format.ts';
import { FeedClient, feedSource } from './index.ts';

const amfi: AmfiFile = {
  date: '2026-10-21',
  rows: [
    [
      '147481',
      'INF879O01100',
      '',
      'Parag Parikh ELSS Tax Saver Fund Direct Plan Growth',
      'Equity',
      30.81,
      '2026-10-21',
    ],
  ],
};
const nse: ExchangeFile = {
  date: '2026-10-21',
  source: 'nse',
  rows: [['NIFTYBEES', 'EQ', 'INF204KB14I2', 259.57]],
};
const fx: FxFile = { date: '2026-10-21', USDINR: 94.47 };

function fakeFetch(files: Record<string, unknown>) {
  const requested: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname.replace(/^\/feed\//, '');

    requested.push(path);

    if (!(path in files)) {
      return new Response('missing', { status: 404 });
    }

    const json = Buffer.from(JSON.stringify(files[path]));

    return new Response(path.endsWith('.gz') ? gzipSync(json) : json);
  }) as typeof fetch;

  return { fn, requested };
}

const files = {
  [FEED_PATHS.manifest]: { format: 1, generated: 'x', files: {}, stale: [] },
  [FEED_PATHS.amfi]: amfi,
  [FEED_PATHS.exchange]: nse,
  [FEED_PATHS.fx]: fx,
  [FEED_PATHS.history(historyGroup('amfi:147481'))]: {
    'amfi:147481': [
      ['2026-10-20', 89.1],
      ['2026-10-21', 30.81],
    ],
    'amfi:999999': [['2026-10-21', 1]],
  },
};

const ppfas: Instrument = {
  id: 'ins_1',
  kind: 'mf',
  name: 'PPFAS',
  currency: 'INR',
  assetClass: 'equity',
  ids: { amfi: '147481', isin: 'INF879O01100' },
};

describe('feed client', () => {
  it('reads and validates the whole fund disclosure feed', async () => {
    const portfolios = await parseFundWorkbook(
      new Uint8Array(readFileSync(new URL('../fund-holdings/fixtures/ppfas.xls', import.meta.url))),
      {
        source: 'ppfas',
        url: 'https://amc.ppfas.com/downloads/portfolio-disclosure/2026/PPFAS_Monthly_Portfolio_Report_September_30_2026.xls',
        name: 'ppfas.xls',
      },
    );
    const data = { version: 1, date: '2026-10-23', portfolios, failures: [] };
    const { fn, requested } = fakeFetch({ [FEED_PATHS.fundHoldings]: data });

    expect(await new FeedClient('https://example.org/feed/').fundHoldings({ fetch: fn })).toEqual(
      data,
    );
    expect(requested).toEqual([FEED_PATHS.fundHoldings]);
    const invalid = fakeFetch({
      [FEED_PATHS.fundHoldings]: {
        ...data,
        portfolios: [{ ...portfolios[0], schemeIsins: [123] }],
      },
    });

    await expect(
      new FeedClient('https://example.org/feed/').fundHoldings({ fetch: invalid.fn }),
    ).rejects.toThrow('Invalid fund portfolio');
  });
  it('reads and checks the cap list, and fails for an older feed without it', async () => {
    const caps = {
      version: 1,
      date: '2026-10-22',
      asOf: '2026-06-30',
      url: 'https://portal.amfiindia.com/spages/AverageMarketCapitalization30Jun2026.xlsx',
      rows: [{ isin: 'INE002A01018', nse: 'RELIANCE', cap: 'large' }],
    };
    const feed = new FeedClient('https://example.org/feed/');

    expect(await feed.caps({ fetch: fakeFetch({ [FEED_PATHS.caps]: caps }).fn })).toEqual(caps);
    await expect(feed.caps({ fetch: fakeFetch({}).fn })).rejects.toThrow('404');
    const bad = fakeFetch({
      [FEED_PATHS.caps]: { ...caps, rows: [{ ...caps.rows[0], cap: 'micro' }] },
    });

    await expect(feed.caps({ fetch: bad.fn })).rejects.toThrow('Unexpected cap list data');
  });
  it('reads and checks index data, and fails for an older feed without it', async () => {
    const data = {
      version: 1,
      date: '2026-10-22',
      sources: [{ provider: 'bse', url: 'https://www.bseindia.com/x.csv', date: '2026-10-22' }],
      series: [
        {
          id: 'bse:sensex',
          provider: 'bse',
          name: 'BSE SENSEX',
          basis: 'price',
          currency: 'INR',
          date: '2026-10-22',
          close: 73249.39,
        },
      ],
      history: { 'bse:sensex': [['2026-10-22', 73249.39]] },
    };
    const feed = new FeedClient('https://example.org/feed/');
    const { fn, requested } = fakeFetch({ [FEED_PATHS.indices]: data });

    expect(await feed.indices({ fetch: fn })).toEqual(data);
    expect(requested).toEqual([FEED_PATHS.indices]);
    await expect(feed.indices({ fetch: fakeFetch({}).fn })).rejects.toThrow('404');
    const bad = fakeFetch({ [FEED_PATHS.indices]: { ...data, history: { 'bse:sensex': 1 } } });

    await expect(feed.indices({ fetch: bad.fn })).rejects.toThrow('Unexpected index data');
  });
  it('reads classification metadata when present while remaining compatible with older feeds', async () => {
    const reference = {
      date: '2026-10-21',
      rows: [{ symbol: 'ONE', isin: 'INE001', industry: 'IT', marketCap: 'large' }],
    };
    const { fn } = fakeFetch({
      ...files,
      [FEED_PATHS.manifest]: {
        ...files[FEED_PATHS.manifest],
        files: { [FEED_PATHS.reference]: { date: reference.date, sha256: 'x', size: 1 } },
      },
      [FEED_PATHS.reference]: reference,
    });

    expect((await new FeedClient('https://example.org/feed/').latest({ fetch: fn })).nse).toEqual(
      reference,
    );
  });
  it('reads whole latest files and the AMFI scheme list', async () => {
    const { fn } = fakeFetch(files);
    const latest = await new FeedClient('https://example.org/feed/').latest({ fetch: fn });

    expect(latest.prices.map((p) => p.key).sort()).toEqual([
      'amfi:147481',
      'fx:USDINR',
      'isin:INF204KB14I2',
      'nse:NIFTYBEES',
    ]);
    expect(latest.schemes).toEqual([
      {
        code: '147481',
        name: 'Parag Parikh ELSS Tax Saver Fund Direct Plan Growth',
        isinGrowth: 'INF879O01100',
        category: 'Equity',
      },
    ]);
  });

  it('fetches whole history groups and keeps only the keys asked for', async () => {
    const { fn, requested } = fakeFetch(files);
    const source = feedSource(new FeedClient('https://example.org/feed'));
    const prices = await source.history!([ppfas], '2026-10-21', '2026-10-31', { fetch: fn });

    expect(prices.map((p) => [p.key, p.date, p.close])).toEqual([
      ['amfi:147481', '2026-10-21', 30.81],
    ]);
    expect(requested).toContain(FEED_PATHS.history(historyGroup('amfi:147481')));
    expect(source.origins).toEqual(['https://example.org']);
  });

  it('gives latest prices for the holdings asked about', async () => {
    const { fn } = fakeFetch(files);
    const prices = await feedSource(new FeedClient('https://example.org/feed/')).latest([ppfas], {
      fetch: fn,
    });

    expect(prices.map((p) => p.key).sort()).toEqual(['amfi:147481', 'fx:USDINR']);
  });
});
