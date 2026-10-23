// SPDX-License-Identifier: AGPL-3.0-only
// Reads the public price feed. Latest prices always come as whole files, and history as whole
// groups of about 75 instruments, so the host never learns which single instrument you hold.
import { gunzip } from '../../../crypto/chunk.ts';
import { priceKeys, type Price } from '../../../engine/prices.ts';
import type { RateTables } from '../../../engine/rates.ts';
import type { AmfiScheme } from '../../../import/types.ts';
import type { Instrument } from '../../../model/types.ts';
import { utf8 } from '../../../util/bytes.ts';
import type { PriceContext, PriceSource } from '../types.ts';
import { validateNseReference, type NseReferenceFile } from '../reference.ts';
import { validateFundHoldings } from '../fund-holdings/collect.ts';
import type { FundHoldingsFile } from '../fund-holdings/types.ts';
import { validateIndexData } from '../indices/data.ts';
import type { IndexDataFile } from '../indices/types.ts';
import { validateAmfiCaps, type CapFile } from '../caps/caps.ts';
import {
  FEED_PATHS,
  historyGroup,
  type AmfiFile,
  type ExchangeFile,
  type FxFile,
  type HistoryGroup,
  type Manifest,
} from './format.ts';

export interface FeedLatest {
  manifest: Manifest;
  prices: Price[];
  schemes: AmfiScheme[];
  nse?: NseReferenceFile | undefined;
}

/** The prices in the latest files, and AMFI's scheme list for matching fund names. */
export function latestPrices(files: {
  amfi?: AmfiFile | undefined;
  exchange?: ExchangeFile | undefined;
  fx?: FxFile | undefined;
}): { prices: Price[]; schemes: AmfiScheme[] } {
  const { amfi, exchange, fx } = files;
  const prices: Price[] = [];
  const schemes: AmfiScheme[] = [];
  for (const [code, isinGrowth, isinReinvest, name, category, nav, date] of amfi?.rows ?? []) {
    prices.push({ key: `amfi:${code}`, date, close: nav, currency: 'INR', source: 'amfi' });
    schemes.push({
      code,
      name,
      ...(isinGrowth ? { isinGrowth } : {}),
      ...(isinReinvest ? { isinReinvest } : {}),
      ...(category ? { category } : {}),
    });
  }
  if (exchange)
    for (const [symbol, , isin, close] of exchange.rows) {
      const { date, source } = exchange;
      const base = { date, close, currency: 'INR' as const, source };
      if (isin) prices.push({ ...base, key: `isin:${isin}` });
      prices.push({ ...base, key: `${source}:${symbol}` });
    }
  if (fx)
    prices.push({
      key: 'fx:USDINR',
      date: fx.date,
      close: fx.USDINR,
      currency: 'INR',
      source: 'ecb',
    });
  return { prices, schemes };
}

async function getBytes(ctx: PriceContext, url: string): Promise<Uint8Array<ArrayBuffer>> {
  const res = await ctx.fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function getJson<T>(ctx: PriceContext, url: string): Promise<T> {
  let bytes = await getBytes(ctx, url);
  // GitHub Pages serves .gz as a file, not as an encoding; browsers may still have unpacked it.
  if (url.endsWith('.gz') && bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = await gunzip(bytes);
  return JSON.parse(utf8.decode(bytes)) as T;
}

export class FeedClient {
  constructor(readonly baseUrl: string) {}

  private url(path: string): string {
    return new URL(path, this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`).toString();
  }

  get origin(): string {
    return new URL(this.baseUrl).origin;
  }

  async manifest(ctx: PriceContext): Promise<Manifest> {
    return getJson<Manifest>(ctx, this.url(FEED_PATHS.manifest));
  }

  /** Every latest price in the feed, plus AMFI's scheme list for matching fund names. */
  async latest(ctx: PriceContext): Promise<FeedLatest> {
    const [manifest, amfi, exchange, fx] = await Promise.all([
      this.manifest(ctx),
      getJson<AmfiFile>(ctx, this.url(FEED_PATHS.amfi)),
      getJson<ExchangeFile>(ctx, this.url(FEED_PATHS.exchange)),
      getJson<FxFile>(ctx, this.url(FEED_PATHS.fx)),
    ]);
    const nse = manifest.files[FEED_PATHS.reference]
      ? await getJson<unknown>(ctx, this.url(FEED_PATHS.reference))
          .then(validateNseReference)
          .catch(() => undefined)
      : undefined;
    return { manifest, ...latestPrices({ amfi, exchange, fx }), nse };
  }

  async rates(ctx: PriceContext): Promise<RateTables> {
    const [ppf, epf] = await Promise.all([
      getJson<RateTables['ppf']>(ctx, this.url(FEED_PATHS.ppfRates)),
      getJson<RateTables['epf']>(ctx, this.url(FEED_PATHS.epfRates)),
    ]);
    return { ppf, epf };
  }

  async fundHoldings(ctx: PriceContext): Promise<FundHoldingsFile> {
    return validateFundHoldings(await getJson<unknown>(ctx, this.url(FEED_PATHS.fundHoldings)));
  }

  /** Every index level and its history; an older feed without the file fails with a 404. */
  async indices(ctx: PriceContext): Promise<IndexDataFile> {
    return validateIndexData(await getJson<unknown>(ctx, this.url(FEED_PATHS.indices)));
  }

  /** AMFI's stock categorisation; an older feed without the file fails with a 404. */
  async caps(ctx: PriceContext): Promise<CapFile> {
    return validateAmfiCaps(await getJson<unknown>(ctx, this.url(FEED_PATHS.caps)));
  }

  /** Past prices for these keys, fetched as whole history groups. */
  async history(keys: readonly string[], ctx: PriceContext): Promise<Price[]> {
    const wanted = new Set(keys);
    const groups = [...new Set(keys.map(historyGroup))];
    const prices: Price[] = [];
    for (const group of groups) {
      const data = await getJson<HistoryGroup>(ctx, this.url(FEED_PATHS.history(group))).catch(
        () => ({}) as HistoryGroup,
      );
      for (const [key, points] of Object.entries(data)) {
        if (!wanted.has(key)) continue;
        for (const [date, close] of points)
          prices.push({ key, date, close, currency: 'INR', source: 'feed' });
      }
    }
    return prices;
  }
}

/** The feed as a price source for holdings. */
export function feedSource(client: FeedClient): PriceSource {
  return {
    id: 'feed',
    label: 'Public price feed (AMFI, NSE, BSE, ECB)',
    origins: [client.origin],
    covers: (i) => i.currency === 'INR' && priceKeys(i).length > 0,
    async latest(list, ctx) {
      const keys = new Set(list.flatMap(priceKeys));
      keys.add('fx:USDINR');
      return (await client.latest(ctx)).prices.filter((p) => keys.has(p.key));
    },
    async history(list: Instrument[], from, to, ctx) {
      const keys = [...list.flatMap(priceKeys), 'fx:USDINR'];
      return (await client.history(keys, ctx)).filter((p) => p.date >= from && p.date <= to);
    },
  };
}
