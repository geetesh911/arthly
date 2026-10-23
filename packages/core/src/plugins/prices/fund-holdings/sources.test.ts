// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  discoverFundFiles,
  fetchFundDisclosureIndex,
  fetchFundWorkbook,
  FUND_SOURCES,
  fundListings,
  isFundWorkbookUrl,
} from './sources.ts';

const ppfas =
  'https://amc.ppfas.com/downloads/portfolio-disclosure/2026/PPFAS_Monthly_Portfolio_Report_September_30_2026.xls';
const nippon =
  'https://mf.nipponindiaim.com/InvestorServices/FactsheetsDocuments/NIMF-MONTHLY-PORTFOLIO-30-Sep-26.xls';
const hdfc =
  'https://files.hdfcfund.com/s3fs-public/2026-10/Monthly%20HDFC%20NIFTY%2050%20ETF%20-%2030%20September%202026_0.xlsx?VersionId=test';
const zerodha =
  'https://assets.zerodhafundhouse.com/statutory-reports/portfolio-disclosures/ZEN50-%20Monthly%20Portfolio%20September%202026.xlsx';

describe('official fund disclosure sources', () => {
  it('discovers current whole-source files from HTML and escaped SSR URLs', () => {
    for (const [source, url] of Object.entries({ ppfas, nippon, hdfc, zerodha })) {
      const old = url.replaceAll('September', 'August').replaceAll('Sep-', 'Aug-');
      const future = url.replaceAll('2026', '2027').replaceAll('Sep-26', 'Sep-27');
      const html = JSON.stringify({ files: [url, old, future] })
        .replaceAll('&', '\\u0026')
        .replaceAll('"', '\\"');
      const found = discoverFundFiles(html, source as 'ppfas', '2026-10-23');
      expect(found.map((f) => f.url)).toEqual([url]);
    }
  });

  it('rejects arbitrary hosts, paths, credentials and file formats', () => {
    expect(isFundWorkbookUrl(ppfas)).toBe(true);
    for (const url of [
      'http://127.0.0.1/a.xlsx',
      'https://files.hdfcfund.com.evil.test/a.xlsx',
      'https://evil.test/a.xlsx',
      'https://amc.ppfas.com/admin.xlsx',
      'https://user:password@amc.ppfas.com/downloads/portfolio-disclosure/a.xls',
      'https://amc.ppfas.com:444/downloads/portfolio-disclosure/a.xls',
      'https://amc.ppfas.com/downloads/portfolio-disclosure/a.html',
    ])
      expect(isFundWorkbookUrl(url)).toBe(false);
  });

  it('accepts only each source’s monthly portfolio files and its own query string', () => {
    for (const url of [ppfas, `${ppfas}?07102026`, nippon, hdfc, hdfc.split('?')[0]!, zerodha])
      expect(isFundWorkbookUrl(url)).toBe(true);
    for (const url of [
      `${ppfas}?cb=1`,
      `${ppfas}?07102026&cb=1`,
      `${nippon}?v=1`,
      `${hdfc}&cb=1`,
      hdfc.replace('VersionId', 'cb'),
      `${zerodha}?1`,
      'https://amc.ppfas.com/downloads/portfolio-disclosure/2026/Factsheet.xls',
      'https://files.hdfcfund.com/s3fs-public/2026-10/Any%20file.xlsx',
      'https://assets.zerodhafundhouse.com/statutory-reports/portfolio-disclosures/Overlap%20Monthly%20Portfolio.xlsx',
      zerodha.replace('Monthly', 'Fortnightly'),
    ])
      expect(isFundWorkbookUrl(url)).toBe(false);
  });

  it('keeps working sources when another listing fails and never sends scheme selections', async () => {
    const asked: string[] = [];
    const index = await fetchFundDisclosureIndex(
      (async (input) => {
        const url = String(input);
        asked.push(url);
        return url === FUND_SOURCES.ppfas.listing
          ? new Response(`<a href="${ppfas}">Consolidated</a>`)
          : new Response('offline', { status: 503 });
      }) as typeof fetch,
      '2026-10-23',
    );
    expect(asked.sort()).toEqual(
      Object.values(FUND_SOURCES)
        .flatMap((s) => fundListings(s, '2026-10-23').map((r) => r.url))
        .sort(),
    );
    expect(index.files).toHaveLength(1);
    expect(index.failures).toHaveLength(Object.keys(FUND_SOURCES).length - 1);
  });

  it('validates redirects before fetching a workbook and rejects oversized content', async () => {
    const calls: string[] = [];
    const redirect = (async (input) => {
      calls.push(String(input));
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
    }) as typeof fetch;
    await expect(fetchFundWorkbook(redirect, ppfas)).rejects.toThrow();
    expect(calls).toEqual([ppfas]);
    await expect(
      fetchFundWorkbook(
        (async () =>
          new Response('x', {
            headers: { 'content-length': String(100 * 1024 * 1024) },
          })) as typeof fetch,
        ppfas,
      ),
    ).rejects.toThrow('large');
  });
});

describe('fund houses that list files with scripts', () => {
  it('finds links in JSON answers, zips and names with the month run together', () => {
    const quant = JSON.stringify({
      d: "<a href='/Admin/disclouser/quant_Small_Cap_Fund_30_Sep_2026.xlsx'>Small Cap</a>",
    }).replaceAll("'", '\\u0027');
    expect(discoverFundFiles(quant, 'quant', '2026-10-23').map((f) => f.url)).toEqual([
      'https://quantmutual.com/Admin/disclouser/quant_Small_Cap_Fund_30_Sep_2026.xlsx',
    ]);
    const dsp = [
      '30-september-2026/dsp-monthend-portfolio-as-on-30-september-2026.zip',
      '31-march-2026/monthend-portfolio-31march2026.zip',
    ]
      .map((p) => `<a href="/media/pages/mandatory-disclosures/portfolio-disclosures/${p}">x</a>`)
      .join('');
    expect(discoverFundFiles(dsp, 'dsp', '2026-10-23').map((f) => f.name)).toEqual([
      'dsp-monthend-portfolio-as-on-30-september-2026.zip',
    ]);
    const mirae = JSON.stringify({
      Data: ['malcf_sept2026', 'magef_aug2026', 'mascf-july2026'].map((n) => ({
        URL: `/docs/default-source/portfolios/${n}.xlsx`,
      })),
    });
    expect(discoverFundFiles(mirae, 'mirae', '2026-10-23').map((f) => f.name)).toEqual([
      'malcf_sept2026.xlsx',
    ]);
  });

  it('dates Invesco’s files from the month they are listed under', () => {
    const url = (name: string) =>
      `https://www.invescomutualfund.com/docs/default-source/completes-monthly-holding/${name}.xlsx?sfvrsn=5ba69ec2_0`;
    const text = JSON.stringify([
      {
        Name: 'PSU',
        AugUrl: url('midcap-fund0a1b'),
        SepUrl: url('largecap-fund'),
        OctUrl: '',
      },
    ]);
    const request = { url: `${FUND_SOURCES.invesco.listing}?year=2026&classification=equity` };
    const dates = FUND_SOURCES.invesco.dates!(text, request);
    expect([...dates.values()]).toEqual(['2026-08-31', '2026-09-30']);
    expect(discoverFundFiles(text, 'invesco', '2026-10-23', dates).map((f) => f.name)).toEqual([
      'largecap-fund.xlsx',
    ]);
  });

  it('accepts Tata’s files on the host its CMS redirects to', () => {
    const path =
      '/system/files/2026-10/Monthly%20Portfolio%20as%20on%2030th%20September%202026.xlsx';
    expect(isFundWorkbookUrl(`https://betacms.tatamutualfund.com${path}`)).toBe(true);
    expect(isFundWorkbookUrl(`https://www.tatamutualfund.com${path}`)).toBe(true);
    expect(isFundWorkbookUrl(`https://cms.example.test${path}`)).toBe(false);
  });

  it('posts what each page’s script posts, for the months before today', async () => {
    const asked: { url: string; method: string; body?: string; type: string | null }[] = [];
    await fetchFundDisclosureIndex(
      (async (input, init) => {
        asked.push({
          url: String(input),
          method: init?.method ?? 'GET',
          body: init?.body as string | undefined,
          type: new Headers(init?.headers).get('content-type'),
        });
        return new Response('offline', { status: 503 });
      }) as typeof fetch,
      '2027-02-10',
    );
    const sbi = asked.find((a) => a.url.includes('sbimf'));
    expect(sbi).toMatchObject({ method: 'POST', type: 'application/json; charset=utf-8' });
    expect(JSON.parse(sbi!.body!)).toMatchObject({ PSYear: '', PSFrequency: 'Monthly' });
    expect(
      asked.filter((a) => a.url.includes('quantmutual')).map((a) => JSON.parse(a.body!)),
    ).toMatchObject([
      { id: '1', tab: '2027' },
      { id: '12', tab: '2026' },
    ]);
    expect(asked.filter((a) => a.url.includes('canararobeco'))).toHaveLength(8);
    expect(asked.filter((a) => a.url.includes('invesco'))).toHaveLength(12);
    expect(asked.filter((a) => a.method === 'GET' && a.body)).toEqual([]);
  });

  it('does not follow a redirect from a posted listing', async () => {
    const index = await fetchFundDisclosureIndex(
      (async (input) =>
        String(input).includes('sbimf')
          ? new Response(null, { status: 302, headers: { location: '/error' } })
          : new Response('offline', { status: 503 })) as typeof fetch,
      '2026-10-23',
    );
    expect(index.failures.find((f) => f.source === 'sbi')?.message).toMatch(/redirect/);
  });
});
