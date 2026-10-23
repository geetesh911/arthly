// SPDX-License-Identifier: AGPL-3.0-only
// Fetches the latest prices through the app's own relay (server.ts): AMFI's NAVs and stock
// categorisation, an exchange's closing prices, NSE's index lists and every NSE and BSE index
// level, as whole files, and every listed fund portfolio workbook. The USD→INR rate comes straight
// from Frankfurter, which lets web pages read it. Each source can fail on its own; the others
// still count.
import type { Price } from '../../../engine/prices.ts';
import type { AmfiScheme } from '../../../import/types.ts';
import { unzip } from '../../../import/zip.ts';
import { utf8 } from '../../../util/bytes.ts';
import { capped } from '../../../util/http.ts';
import { type CapFile, MAX_CAPS_BYTES, parseAmfiCaps } from '../caps/caps.ts';
import type { AmfiFile, ExchangeFile, FxFile } from '../feed/format.ts';
import { latestPrices } from '../feed/index.ts';
import { parseAmfi, parseBhavcopy } from '../feed/parse.ts';
import { collectFundHoldings } from '../fund-holdings/collect.ts';
import { MAX_FUND_FILE_BYTES } from '../fund-holdings/sources.ts';
import type { FundDisclosureIndex, FundHoldingsFile } from '../fund-holdings/types.ts';
import { validateIndexData } from '../indices/data.ts';
import type { IndexDataFile } from '../indices/types.ts';
import { type NseReferenceFile, validateNseReference } from '../reference.ts';
import type { PriceContext } from '../types.ts';

export const FX_URL = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR';

export type RelayPart = 'funds' | 'stocks' | 'fx';

export interface RelayLatest {
  prices: Price[];
  schemes: AmfiScheme[];
  nse?: NseReferenceFile | undefined;
  /** The parts that couldn't be fetched, with why. */
  failed: { part: RelayPart; reason: string }[];
}

export async function fetchFx(ctx: PriceContext): Promise<FxFile> {
  const res = await ctx.fetch(FX_URL, { cache: 'no-cache' });

  if (!res.ok) {
    throw new Error(`Frankfurter: ${res.status}`);
  }

  const body = (await res.json()) as { date?: unknown; rates?: { INR?: unknown } };
  const rate = Number(body.rates?.INR);

  if (!(rate > 0) || typeof body.date !== 'string') {
    throw new Error('Unexpected FX response');
  }

  return { date: body.date, USDINR: rate };
}

export class RelayClient {
  /** `baseUrl` is where the relay answers, such as https://example.pages.dev/api/prices/. */
  constructor(readonly baseUrl: string) {}

  private async get(ctx: PriceContext, source: string): Promise<Response> {
    const res = await ctx.fetch(new URL(source, this.baseUrl), { cache: 'no-cache' });

    // A host without the relay answers with a 404 or the app's own page.
    if (!res.ok) {
      throw new Error(await res.text().catch(() => `${res.status}`));
    }

    if (!res.headers.get('x-relay-source')) {
      throw new Error('this host has no price relay');
    }

    return res;
  }

  async amfi(ctx: PriceContext): Promise<AmfiFile> {
    return parseAmfi(await (await this.get(ctx, 'amfi')).text());
  }

  async fundHoldings(
    ctx: PriceContext,
    previous?: FundHoldingsFile,
    force = false,
  ): Promise<FundHoldingsFile> {
    const index = (await (await this.get(ctx, 'fund-disclosures')).json()) as FundDisclosureIndex;

    return collectFundHoldings(
      index,
      async (file) => {
        const response = await this.get(ctx, `fund-workbook?url=${encodeURIComponent(file.url)}`);

        if (Number(response.headers.get('content-length')) > MAX_FUND_FILE_BYTES) {
          throw new Error('Fund workbook is too large');
        }

        const reader = response.body?.getReader();

        if (!reader) {
          throw new Error('Empty fund workbook');
        }

        const chunks: Uint8Array[] = [];
        let size = 0;

        try {
          for (;;) {
            const next = await reader.read();

            if (next.done) {
              break;
            }

            size += next.value.byteLength;

            if (size > MAX_FUND_FILE_BYTES) {
              throw new Error('Fund workbook is too large');
            }

            chunks.push(next.value);
          }
        } catch (error) {
          await reader.cancel().catch(() => {});
          throw error;
        }

        const bytes = new Uint8Array(size);
        let offset = 0;

        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }

        return bytes;
      },
      previous,
      force,
    );
  }

  /** AMFI's newest stock categorisation, read here from its workbook; `date` is today. */
  async caps(ctx: PriceContext, date: string): Promise<CapFile> {
    const res = await this.get(ctx, 'amfi-caps');
    const url = res.headers.get('x-source-url') ?? '';
    const bytes = await capped(res, MAX_CAPS_BYTES, 'AMFI’s cap list is too large').arrayBuffer();

    return parseAmfiCaps(new Uint8Array(bytes), url, date);
  }

  /** Every index level in NSE's and BSE's newest daily files. */
  async indices(ctx: PriceContext): Promise<IndexDataFile> {
    return validateIndexData(await (await this.get(ctx, 'index-data')).json());
  }

  async exchange(ctx: PriceContext): Promise<ExchangeFile> {
    const res = await this.get(ctx, 'exchange');
    const source = res.headers.get('x-relay-source') === 'bse' ? 'bse' : 'nse';
    let bytes = new Uint8Array(await res.arrayBuffer());

    // NSE's file comes zipped; BSE's doesn't.
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      const [csv] = await unzip(bytes);

      if (!csv) {
        throw new Error('The exchange file was empty');
      }

      bytes = csv.bytes;
    }

    return { ...parseBhavcopy(utf8.decode(bytes)), source };
  }

  async latest(ctx: PriceContext): Promise<RelayLatest> {
    const [amfi, exchange, fx, nse] = await Promise.allSettled([
      this.amfi(ctx),
      this.exchange(ctx),
      fetchFx(ctx),
      this.get(ctx, 'nse-reference').then(async (res) => validateNseReference(await res.json())),
    ]);
    const parts: [RelayPart, PromiseSettledResult<unknown>][] = [
      ['funds', amfi],
      ['stocks', exchange],
      ['fx', fx],
    ];
    const failed = parts.flatMap(([part, r]) =>
      r.status === 'rejected' ? [{ part, reason: (r.reason as Error).message }] : [],
    );
    const value = <T>(r: PromiseSettledResult<T>) =>
      r.status === 'fulfilled' ? r.value : undefined;

    return {
      ...latestPrices({ amfi: value(amfi), exchange: value(exchange), fx: value(fx) }),
      nse: value(nse),
      failed,
    };
  }
}
