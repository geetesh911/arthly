// SPDX-License-Identifier: AGPL-3.0-only
// Builds the public price feed: run daily by GitHub Actions, published to GitHub Pages.
//   OUT_DIR    where the site is written (default dist)
//   CACHE_DIR  history groups carried between runs (default .cache)
//   FEED_URL   the published site, used when the cache is empty or a source fails
import { DEFAULT_RATES } from '@pv/core/engine/rates.ts';
import { type CapFile, fetchAmfiCaps, parseAmfiCaps } from '@pv/core/plugins/prices/caps/caps.ts';
import {
  type AmfiFile,
  type ExchangeFile,
  FEED_PATHS,
  type FxFile,
  type HistoryGroup,
  type Manifest,
} from '@pv/core/plugins/prices/feed/format.ts';
import { parseAmfi, parseBhavcopy } from '@pv/core/plugins/prices/feed/parse.ts';
import { collectFundHoldings } from '@pv/core/plugins/prices/fund-holdings/collect.ts';
import {
  fetchFundDisclosureIndex,
  fetchFundWorkbook,
} from '@pv/core/plugins/prices/fund-holdings/sources.ts';
import type { FundHoldingsFile } from '@pv/core/plugins/prices/fund-holdings/types.ts';
import {
  backfillIndexHistory,
  fetchIndexData,
  mergeIndexData,
  validateIndexData,
} from '@pv/core/plugins/prices/indices/data.ts';
import type { IndexDataFile } from '@pv/core/plugins/prices/indices/types.ts';
import { fetchNseReference, type NseReferenceFile } from '@pv/core/plugins/prices/reference.ts';
import { makeDate, weekdaysBack } from '@pv/core/util/dates.ts';
import { capped } from '@pv/core/util/http.ts';
import { unzipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { appendPrices, capGroups } from './history.ts';

const OUT = process.env.OUT_DIR ?? 'dist';
const CACHE = process.env.CACHE_DIR ?? '.cache';
const PREVIOUS = process.env.FEED_URL;
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; arthly price feed)' };

function istToday(): string {
  const now = new Date(Date.now() + 5.5 * 3600_000);

  return makeDate(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
}

async function get(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60_000) });

  if (!res.ok) {
    throw new Error(`${url}: ${res.status}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

async function previous<T>(path: string): Promise<T | undefined> {
  if (!PREVIOUS) {
    return undefined;
  }

  try {
    const bytes = await get(new URL(path, PREVIOUS).toString());

    return JSON.parse((path.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8')) as T;
  } catch {
    return undefined;
  }
}

/** One exchange's daily index file, or nothing for a day without one. */
async function indexFile(url: string): Promise<string | undefined> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60_000) });

  // BSE answers a day without a file with an HTML page rather than a 404.
  if (res.status === 404 || res.headers.get('content-type')?.startsWith('text/html')) {
    await res.body?.cancel();

    return undefined;
  }

  if (!res.ok) {
    throw new Error(`${url}: ${res.status}`);
  }

  return capped(res, 2 * 1024 * 1024).text();
}

async function exchange(today: string): Promise<ExchangeFile> {
  for (const day of weekdaysBack(today, 5)) {
    const compact = day.replaceAll('-', '');

    try {
      const zip = await get(
        `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${compact}_F_0000.csv.zip`,
      );
      const [csv] = Object.values(unzipSync(new Uint8Array(zip)));

      if (csv) {
        return { ...parseBhavcopy(Buffer.from(csv).toString('utf8')), source: 'nse' };
      }
    } catch (error) {
      console.warn(`NSE ${day}: ${(error as Error).message}`);
    }

    try {
      const csv = await get(
        `https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_${compact}_F_0000.CSV`,
      );

      return { ...parseBhavcopy(csv.toString('utf8')), source: 'bse' };
    } catch (error) {
      console.warn(`BSE ${day}: ${(error as Error).message}`);
    }
  }

  throw new Error('No bhavcopy from NSE or BSE in the last 5 trading days');
}

async function fx(): Promise<FxFile> {
  const body = JSON.parse(
    (await get('https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR')).toString('utf8'),
  );
  const rate = Number(body?.rates?.INR);

  if (!(rate > 0) || typeof body.date !== 'string') {
    throw new Error('Unexpected FX response');
  }

  return { date: body.date, USDINR: rate };
}

async function loadGroups(): Promise<Map<string, HistoryGroup>> {
  const groups = new Map<string, HistoryGroup>();
  const dir = join(CACHE, 'history');

  if (existsSync(dir) && readdirSync(dir).length > 0) {
    for (const name of readdirSync(dir)) {
      groups.set(name.replace('.json', ''), JSON.parse(readFileSync(join(dir, name), 'utf8')));
    }

    return groups;
  }

  // No cache: rebuild from the published site.
  for (let n = 0; n < 256; n++) {
    const group = n.toString(16).padStart(2, '0');
    const data = await previous<HistoryGroup>(FEED_PATHS.history(group));

    if (data) {
      groups.set(group, data);
    }
  }

  return groups;
}

async function main(): Promise<void> {
  const today = istToday();
  const stale: string[] = [];
  const files = new Map<string, { bytes: Buffer; date: string }>();

  const put = (path: string, data: unknown, date: string) => {
    const json = Buffer.from(JSON.stringify(data));

    files.set(path, { bytes: path.endsWith('.gz') ? gzipSync(json, { level: 9 }) : json, date });
  };

  async function source<T extends { date: string }>(
    path: string,
    fetcher: () => Promise<T>,
  ): Promise<T | undefined> {
    try {
      const data = await fetcher();

      put(path, data, data.date);

      return data;
    } catch (error) {
      console.warn(`${path}: ${(error as Error).message}; keeping the previous file`);
      const old = await previous<T>(path);

      if (old) {
        put(path, old, old.date);
        stale.push(path);
      }

      return undefined;
    }
  }

  const amfi = await source<AmfiFile>(FEED_PATHS.amfi, async () =>
    parseAmfi((await get('https://portal.amfiindia.com/spages/NAVAll.txt')).toString('utf8')),
  );
  const bhav = await source<ExchangeFile>(FEED_PATHS.exchange, () => exchange(today));
  const rate = await source<FxFile>(FEED_PATHS.fx, fx);

  await source<NseReferenceFile>(FEED_PATHS.reference, async () => {
    const data = await fetchNseReference(
      async (url) => (await get(url)).toString('utf8'),
      today,
      await previous<NseReferenceFile>(FEED_PATHS.reference),
    );

    if (data.stale?.length) {
      stale.push(FEED_PATHS.reference);
    }

    return data;
  });
  put(FEED_PATHS.ppfRates, DEFAULT_RATES.ppf, today);
  await source<FundHoldingsFile>(FEED_PATHS.fundHoldings, async () => {
    const index = await fetchFundDisclosureIndex(fetch, today);
    const data = await collectFundHoldings(
      index,
      async (file) =>
        new Uint8Array(await (await fetchFundWorkbook(fetch, file.url)).arrayBuffer()),
      await previous<FundHoldingsFile>(FEED_PATHS.fundHoldings),
    );

    if (!data.portfolios.length) {
      throw new Error('No fund portfolio disclosures could be loaded');
    }

    if (data.failures.length) {
      stale.push(FEED_PATHS.fundHoldings);
    }

    return data;
  });
  put(FEED_PATHS.epfRates, DEFAULT_RATES.epf, today);
  await source<IndexDataFile>(FEED_PATHS.indices, async () => {
    let saved: IndexDataFile | undefined;

    try {
      saved = validateIndexData(await previous<unknown>(FEED_PATHS.indices));
    } catch {
      // No earlier file yet, or one this version can't read: start the history afresh.
    }

    const latest = mergeIndexData(await fetchIndexData(indexFile, today), saved);
    // Each run fills up to 100 missing days per exchange, so a year of history takes a few days.
    const data = await backfillIndexHistory(latest, indexFile, today);

    if (data.sources.some((s) => s.failure)) {
      stale.push(FEED_PATHS.indices);
    }

    return data;
  });
  await source<CapFile>(FEED_PATHS.caps, async () => {
    const { url, response } = await fetchAmfiCaps(fetch, today);

    return parseAmfiCaps(new Uint8Array(await response.arrayBuffer()), url, today);
  });

  const groups = await loadGroups();

  appendPrices(groups, [
    ...(amfi?.rows.map(([code, , , , , nav, date]) => ({
      key: `amfi:${code}`,
      date,
      close: nav,
    })) ?? []),
    ...(bhav?.rows
      .filter(([, , isin]) => isin)
      .map(([, , isin, close]) => ({ key: `isin:${isin}`, date: bhav.date, close })) ?? []),
    ...(rate ? [{ key: 'fx:USDINR', date: rate.date, close: rate.USDINR }] : []),
  ]);
  capGroups(groups, today);

  for (const [name, group] of groups) {
    put(FEED_PATHS.history(name), group, today);
    mkdirSync(join(CACHE, 'history'), { recursive: true });
    writeFileSync(join(CACHE, 'history', `${name}.json`), JSON.stringify(group));
  }

  const manifest: Manifest = { format: 1, generated: new Date().toISOString(), files: {}, stale };

  for (const [path, { bytes, date }] of files) {
    manifest.files[path] = {
      date,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
    };
    mkdirSync(dirname(join(OUT, path)), { recursive: true });
    writeFileSync(join(OUT, path), bytes);
  }

  writeFileSync(join(OUT, FEED_PATHS.manifest), JSON.stringify(manifest, null, 2));
  writeFileSync(join(OUT, '.nojekyll'), '');
  console.log(`Wrote ${files.size} files; stale: ${stale.join(', ') || 'none'}`);

  if (!amfi && !bhav && !rate) {
    process.exitCode = 1;
  }
}

await main();
