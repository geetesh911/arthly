// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { normaliseFundName, parseFundWorkbook } from './parse.ts';
import type { FundDisclosureFile } from './types.ts';

const file = (source: FundDisclosureFile['source']): FundDisclosureFile => ({
  source,
  url: `https://example.test/${source}.xlsx`,
  name: `${source}.xlsx`,
});
const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name));

const workbook = (rows: unknown[][], name = 'Portfolio') => {
  const book = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);

  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
};

const header = [
  'Name of the Instrument',
  'ISIN',
  'Industry / Rating',
  'Quantity',
  'Market Value',
  '% to NAV',
];
const basicRows = () => [
  ['Example Dividend Yield Fund (An open-ended equity scheme)'],
  ['Monthly Portfolio Statement as on September 30, 2026'],
  header,
  ['Equity & Equity related'],
  ['Example Limited', 'INE123456789', 'Banks', 1, 99, '99%'],
  ['Net Current Assets', '', '', '', 1, '1%'],
  ['GRAND TOTAL', '', '', '', 100, '100%'],
];

describe('fund scheme names', () => {
  it('removes spaced scheme descriptions and exact segregated-portfolio count metadata', () => {
    expect(
      normaliseFundName(
        'Parag Parikh Arbitrage Fund ( An open ended scheme investing in arbitrage opportunities )',
      ),
    ).toBe('parag parikh arbitrage fund');
    expect(
      normaliseFundName(
        'HDFC Retirement Fund - Hybrid-Debt Plan ( An open ended retirement solution oriented scheme). (Formerly HDFC Retirement Savings Fund)',
      ),
    ).toBe('hdfc retirement fund hybrid debt plan');
    expect(
      normaliseFundName(
        'Nippon India Credit Risk Fund (Existing Number of Segregated Portfolios - 1) Direct Plan Growth',
      ),
    ).toBe('nippon india credit risk fund');
    expect(
      normaliseFundName(
        'Nippon India Conservative Hybrid Fund (Existing number of Segregated Portfolios - 2) Regular Plan IDCW',
      ),
    ).toBe('nippon india conservative hybrid fund');
    expect(
      normaliseFundName(
        'Nippon India Credit Risk Fund - Segregated Portfolio 2 - Direct Plan Growth',
      ),
    ).toBe('nippon india credit risk fund segregated portfolio 2');
    expect(normaliseFundName('Nippon India Credit Risk Fund (Segregated Portfolio 1)')).not.toBe(
      normaliseFundName('Nippon India Credit Risk Fund'),
    );
  });

  it('canonicalizes fund-of-fund descriptions and their optional FOF abbreviation', () => {
    expect(normaliseFundName('Nippon India Silver ETF Fund of Fund (FOF)')).toBe(
      normaliseFundName('Nippon India Silver ETF FOF Direct Plan Growth'),
    );
    expect(normaliseFundName('Example Fund of Funds (FOF)')).toBe(normaliseFundName('Example FOF'));
    expect(normaliseFundName('HDFC Silver ETF Fund of Fund')).toBe(
      normaliseFundName('HDFC Silver ETF FOF'),
    );
  });

  it('canonicalizes spacing at letter-number boundaries without merging index numbers', () => {
    expect(normaliseFundName('Example ETF Nifty50')).toBe(
      normaliseFundName('Example ETF Nifty 50'),
    );
    expect(normaliseFundName('Example Nifty500ETF')).toBe(
      normaliseFundName('Example Nifty 500 ETF'),
    );
    expect(normaliseFundName('Example ETF Nifty50')).not.toBe(
      normaliseFundName('Example ETF Nifty500'),
    );
  });

  it('matches options while retaining actual scheme names and index distinctions', () => {
    expect(normaliseFundName('Parag Parikh Flexi Cap Fund - Direct Plan - Growth')).toBe(
      'parag parikh flexi cap fund',
    );
    expect(normaliseFundName('Parag Parikh Flexi Cap Fund Regular Plan Monthly IDCW')).toBe(
      'parag parikh flexi cap fund',
    );
    expect(normaliseFundName('Example Dividend Yield Fund Direct Growth')).toBe(
      'example dividend yield fund',
    );
    expect(normaliseFundName('Example Growth Fund Regular Plan IDCW Payout')).toBe(
      'example growth fund',
    );
    expect(normaliseFundName('Example Nifty Next 50 Index Fund - Growth Option')).not.toBe(
      normaliseFundName('Example Nifty 50 Index Fund'),
    );
  });
});

describe('official AMC portfolio workbooks', () => {
  it('skips separate HDFC derivative disclosure worksheets before expanding their huge ranges', async () => {
    const portfolios = await parseFundWorkbook(fixture('hdfc-derivative.xlsx'), file('hdfc'));

    expect(portfolios).toHaveLength(1);
    expect(portfolios[0]).toMatchObject({ schemeName: 'HDFC Multi Cap Fund', derivatives: true });
    expect(portfolios[0]!.reportedWeight).toBeCloseTo(1, 1);
  });

  it('uses the disclosed market value for HDFC less-than-0.01% footnote marks', async () => {
    const [p] = await parseFundWorkbook(fixture('hdfc-small-weight.xlsx'), file('hdfc'));
    const treps = p!.constituents.find((c) => /TREPS/.test(c.name))!;

    expect(treps).toMatchObject({ kind: 'cash', assetClass: 'cash' });
    expect(treps.weight).toBeGreaterThan(0);
    expect(treps.weight).toBeLessThan(0.0001);
    expect(p!.warnings.some((w) => /less than|round/i.test(w))).toBe(true);
  });

  it('reads HDFC FMP titles without Fund or ETF in the name', async () => {
    const [p] = await parseFundWorkbook(fixture('hdfc-fmp.xlsx'), file('hdfc'));

    expect(p!.schemeName).toBe('HDFC FMP 2638D February 2023');
    expect(p!.constituents.some((c) => c.kind === 'debt')).toBe(true);
  });

  it.each(['zerodha-arbitrage.xlsx', 'zerodha-hybrid.xlsx'])(
    'validates and excludes unlabeled Zerodha section subtotals in %s',
    async (name) => {
      const [p] = await parseFundWorkbook(fixture(name), file('zerodha'));

      expect(p!.constituents.every((c) => c.name.length > 0)).toBe(true);
      expect(p!.reportedWeight).toBeCloseTo(1, 1);

      if (name === 'zerodha-arbitrage.xlsx') {
        expect(p!.schemeName).toBe('ZERODHA ARBITRAGE FUND');
        expect(normaliseFundName(p!.schemeName)).toBe(
          normaliseFundName('Zerodha Arbitrage Fund Direct Plan Growth'),
        );
        expect(p!.constituents.find((c) => c.isin === 'INF336L01CC8')).toMatchObject({
          kind: 'fund',
          weight: 0.1288,
        });
      } else {
        expect(p!.constituents.find((c) => c.isin === 'IN0020260025')).toMatchObject({
          kind: 'debt',
          weight: 0.2983,
        });
      }
    },
  );

  it('recognizes a foreign ETF after an InvIT section in Nippon multi asset', async () => {
    const portfolios = await parseFundWorkbook(fixture('nippon.xls'), file('nippon'));
    const p = portfolios.find((p) => /Multi Asset Allocation/i.test(p.schemeName))!;

    expect(p.constituents.find((c) => c.isin === 'US4642863926')).toMatchObject({
      name: 'iShares MSCI World ETF',
      kind: 'fund',
      weight: 0.0452,
    });
  });

  it('parses all PPFAS sheets including foreign stock, REITs, INE debt and signed cash', async () => {
    const portfolios = await parseFundWorkbook(fixture('ppfas.xls'), file('ppfas'));

    expect(portfolios).toHaveLength(7);
    const flexi = portfolios.find((p) => /Flexi Cap/i.test(p.schemeName))!;

    expect(flexi.id).toBe('ppfas:parag parikh flexi cap fund');
    expect(flexi.asOf).toBe('2026-09-30');
    expect(flexi.sourceUrl).toBe(file('ppfas').url);
    expect(flexi.derivatives).toBe(true);
    expect(flexi.constituents.find((c) => c.isin === 'US02079K3059')?.kind).toBe('stock');
    expect(flexi.constituents.find((c) => c.isin === 'INE041025011')?.kind).toBe('other');
    expect(flexi.constituents.find((c) => c.isin === 'INE476A16F78')?.kind).toBe('debt');
    const liability = flexi.constituents.find((c) => /Net Receivables/i.test(c.name))!;

    expect(liability.kind).toBe('cash');
    expect(liability.weight).toBeCloseTo(-30629.29 / 14507049.75, 8);
    expect(flexi.warnings.some((w) => /format|market value/i.test(w))).toBe(true);

    for (const p of portfolios) {
      expect(p.reportedWeight).toBeCloseTo(1, 1);
      expect(p.constituents.some((c) => /^(sub\s*total|total|grand total)$/i.test(c.name))).toBe(
        false,
      );
      expect(p.constituents.filter((c) => c.kind !== 'cash').every((c) => c.weight >= 0)).toBe(
        true,
      );
    }
  });

  it('recognizes OOXML with .xls extension and skips Nippon index/derivative notionals', async () => {
    const portfolios = await parseFundWorkbook(fixture('nippon.xls'), file('nippon'));

    expect(portfolios).toHaveLength(6);
    const growth = portfolios.find((p) => /Growth Mid Cap/i.test(p.schemeName))!;

    expect(growth.asOf).toBe('2026-09-30');
    expect(growth.constituents.find((c) => c.isin === 'INE745G01043')?.weight).toBeCloseTo(
      0.0322,
      6,
    );
    const bond = portfolios.find((p) => /Corporate Bond/i.test(p.schemeName))!;

    expect(bond.derivatives).toBe(true);
    expect(bond.constituents.some((c) => /swaps|futures/i.test(c.name))).toBe(false);
    expect(
      bond.constituents.filter((c) => c.isin?.startsWith('INE')).every((c) => c.kind === 'debt'),
    ).toBe(true);
    expect(
      portfolios
        .find((p) => /Gold BeES/i.test(p.schemeName))
        ?.constituents.find((c) => /995/.test(c.name)),
    ).toMatchObject({ kind: 'commodity', assetClass: 'gold' });
    expect(
      portfolios
        .find((p) => /^Nippon India Silver ETF$/i.test(p.schemeName))
        ?.constituents.find((c) => /999/.test(c.name)),
    ).toMatchObject({ kind: 'commodity', assetClass: 'silver' });
    expect(
      portfolios
        .find((p) => /Gold Savings/i.test(p.schemeName))
        ?.constituents.find((c) => c.isin === 'INF204KB17I5'),
    ).toMatchObject({ kind: 'fund', assetClass: 'gold' });

    for (const p of portfolios) {
      expect(Math.abs(p.reportedWeight - 1)).toBeLessThanOrEqual(0.02);
    }
  });

  it('reads Zerodha title/month date and preserves cash liabilities without inflating stocks', async () => {
    const p = (await parseFundWorkbook(fixture('zerodha.xlsx'), file('zerodha')))[0]!;

    expect(p.schemeName).toBe('ZERODHA NIFTY 50 ETF');
    expect(p.asOf).toBe('2026-09-30');
    expect(p.constituents.filter((c) => c.kind === 'stock')).toHaveLength(50);
    expect(p.constituents.find((c) => /Net Receivable/i.test(c.name))?.weight).toBeCloseTo(
      -0.0328,
      6,
    );
    expect(p.constituents.find((c) => /Clearing Corporation/i.test(c.name))).toMatchObject({
      kind: 'cash',
      weight: 0.0332,
    });
    expect(p.constituents.find((c) => c.isin === 'INE040A01034')?.weight).toBeCloseTo(0.1037, 6);
  });

  it('reads HDFC percentage-point cells including small weights, and stops at grand total', async () => {
    const p = (await parseFundWorkbook(fixture('hdfc.xlsx'), file('hdfc')))[0]!;

    expect(p.schemeName).toBe('HDFC NIFTY 50 ETF');
    expect(p.asOf).toBe('2026-09-30');
    expect(p.constituents.filter((c) => c.kind === 'stock')).toHaveLength(50);
    expect(p.constituents.find((c) => c.isin === 'INE040A01034')?.weight).toBeCloseTo(0.1038, 6);
    expect(p.constituents.find((c) => /TREPS/i.test(c.name))).toMatchObject({
      kind: 'cash',
      weight: 0.0002,
    });
    expect(p.constituents.find((c) => /Net Current/i.test(c.name))).toMatchObject({
      kind: 'cash',
      weight: -0.0002,
    });
    expect(p.reportedWeight).toBeCloseTo(1, 2);
  });
});

describe('portfolio validation', () => {
  it('rejects unlabeled numeric rows that do not match the preceding section totals', async () => {
    const rows = basicRows();

    rows.splice(5, 0, ['', '', '', '', 50, '50%']);
    await expect(parseFundWorkbook(workbook(rows), file('zerodha'))).rejects.toThrow(
      /missing holding name/i,
    );
  });

  it('requires the explicit less-than footnote before accepting a symbolic weight', async () => {
    const rows = basicRows();

    rows[4]![5] = '@';
    await expect(parseFundWorkbook(workbook(rows), file('hdfc'))).rejects.toThrow(
      /invalid weight/i,
    );
  });

  it('keeps foreign ordinary stock distinct from ETF units under the same overseas heading', async () => {
    const rows = basicRows();

    rows.splice(
      3,
      3,
      ['InvITs'],
      ['Listed Foreign Securities/Overseas ETFs'],
      ['Example Foreign Corporation', 'US1234567890', '', 1, 99, '99%'],
      ['Net Current Assets', '', '', '', 1, '1%'],
    );
    const p = (await parseFundWorkbook(workbook(rows), file('nippon')))[0]!;

    expect(p.constituents[0]).toMatchObject({ kind: 'stock', assetClass: 'equity' });
  });

  it('classifies corporate bond repo as cash while retaining the published money-market weights', async () => {
    // Same heading and instruments as the official Nippon ON September 2026 sheet.
    const rows = basicRows();

    rows.splice(
      3,
      3,
      ['Money Market Instruments'],
      ['Corporate Bond Repo'],
      ['5.26% Corporate Bond Repo (MD 01-10-2026)', '', '', '', 4.64, '4.64%'],
      ['5.50% Corporate Bond Repo (MD 01-10-2026)', '', '', '', 1.45, '1.45%'],
      ['Reverse Repo', '', '', '', 93.91, '93.91%'],
    );
    const p = (await parseFundWorkbook(workbook(rows), file('nippon')))[0]!;

    expect(p.constituents.slice(0, 2)).toMatchObject([
      { kind: 'cash', assetClass: 'cash', weight: 0.0464 },
      { kind: 'cash', assetClass: 'cash', weight: expect.closeTo(0.0145, 8) },
    ]);
    expect(p.reportedWeight).toBeCloseTo(1, 6);
  });

  it('reads fixed maturity plan titles and strips close-ended scheme descriptions', async () => {
    const rows = basicRows();

    rows[0] = ['Nippon India Fixed Maturity Plan - XLI - Series 8 (A Close Ended Income Scheme)'];
    const p = (await parseFundWorkbook(workbook(rows), file('nippon')))[0]!;

    expect(p.schemeName).toBe('Nippon India Fixed Maturity Plan - XLI - Series 8');
  });

  it('parses a complete table and ignores subtotals and trailing derivatives', async () => {
    const rows = basicRows();

    rows.splice(5, 0, ['Sub Total', '', '', '', 99, '99%']);
    rows.push(['Derivatives'], header, ['Example Futures', '', '', 1, 500, '500%']);
    const p = (await parseFundWorkbook(workbook(rows), file('ppfas')))[0]!;

    expect(p.constituents).toHaveLength(2);
    expect(p.reportedWeight).toBe(1);
    expect(p.derivatives).toBe(true);
  });

  it.each([
    [
      'missing headings',
      (r: unknown[][]) => {
        r[2] = ['Something else'];
      },
      /heading|table/i,
    ],
    [
      'missing date',
      (r: unknown[][]) => {
        r[1] = ['Monthly Portfolio Statement'];
      },
      /date/i,
    ],
    [
      'incomplete portfolio',
      (r: unknown[][]) => {
        r[4]![5] = '30%';
        r[4]![4] = 30;
      },
      /incomplete|weight|net assets/i,
    ],
    [
      'missing grand total',
      (r: unknown[][]) => {
        r.pop();
      },
      /total|incomplete/i,
    ],
    [
      'non-numeric weight',
      (r: unknown[][]) => {
        r[4]![5] = 'not available';
      },
      /weight/i,
    ],
    [
      'negative stock',
      (r: unknown[][]) => {
        r[4]![5] = '-99%';
        r[4]![4] = -99;
      },
      /negative|weight/i,
    ],
    [
      'excessive weight',
      (r: unknown[][]) => {
        r[4]![5] = '500%';
      },
      /weight/i,
    ],
    [
      'invalid calendar date',
      (r: unknown[][]) => {
        r[1] = ['as on February 30, 2026'];
      },
      /date/i,
    ],
  ])('rejects %s', async (_description, change, error) => {
    const rows = basicRows();

    change(rows);
    await expect(parseFundWorkbook(workbook(rows), file('ppfas'))).rejects.toThrow(error);
  });

  it('rejects oversized advertised row ranges and reads only the first columns of wide ones', async () => {
    const write = (ref: string) => {
      const book = XLSX.utils.book_new();
      const sheet = XLSX.utils.aoa_to_sheet(basicRows());

      sheet['!ref'] = ref;
      XLSX.utils.book_append_sheet(book, sheet, 'Portfolio');

      return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
    };

    await expect(parseFundWorkbook(write('A1:F20000'), file('ppfas'))).rejects.toThrow(
      /range|limit|large/i,
    );
    // SBI and Mirae Asset declare 256 columns.
    const [wide] = await parseFundWorkbook(write('A1:IV7'), file('ppfas'));

    expect(wide!.constituents).toHaveLength(2);
  });
});

describe('other AMCs’ layouts', () => {
  const book = (sheets: [string, unknown[][]][]) => {
    const b = XLSX.utils.book_new();

    for (const [name, rows] of sheets) {
      XLSX.utils.book_append_sheet(b, XLSX.utils.aoa_to_sheet(rows), name);
    }

    return XLSX.write(b, { type: 'buffer', bookType: 'xlsx' });
  };

  const table = (...holdings: unknown[][]) => [
    ['Example Flexi Cap Fund'],
    ['Monthly Portfolio Statement as on September 30, 2026'],
    header,
    ['Equity & Equity related'],
    ...holdings,
    ['GRAND TOTAL', '', '', '', 100, '100%'],
  ];
  const stock = (weight: number, isin = 'INE123456789') => [
    'Example Limited',
    isin,
    'Banks',
    1,
    weight,
    `${weight}%`,
  ];

  it('adds back Quant’s futures offset in net current assets as cash', async () => {
    const rows = table(
      stock(60),
      ['Derivatives'],
      ['Index / Stock Futures'],
      ['Other Limited', 'INE223456789', 'Banks', 1, 30, '30%'],
      ['Net Current Assets', '', '', '', -30, '-30%'],
      ['TREPS', '', '', '', 40, '40%'],
    );
    const [p] = await parseFundWorkbook(workbook(rows), file('quant'));

    expect(p!.reportedWeight).toBeCloseTo(1, 6);
    expect(p!.constituents.filter((c) => c.kind === 'stock')).toHaveLength(1);
    expect(p!.constituents.at(-1)).toMatchObject({ kind: 'cash', weight: 0.3 });
    expect(p!.warnings.join()).toMatch(/Futures of 30.00%/);
  });

  it('leaves out a row repeated in the report only when that makes it add up', async () => {
    const treps = ['TREPS', '', '', '', 40, '40%'];
    const [p] = await parseFundWorkbook(workbook(table(stock(60), treps, treps)), file('quant'));

    expect(p!.constituents).toHaveLength(2);
    expect(p!.warnings.join()).toMatch(/repeated/);
    const twice = await parseFundWorkbook(
      workbook(table(stock(30), stock(30), treps)),
      file('quant'),
    );

    expect(twice[0]!.constituents).toHaveLength(3);
  });

  it('skips short legs and futures listed among holdings', async () => {
    const rows = table(
      stock(99),
      ['Example Limited Oct26', '', 'Stock Futures', -1, -10, '-10%'],
      ['Example Limited^', 'INE123456789', 'Banks', -1, -5, '-5%'],
      ['Net Receivables/Payables', '', '', '', 1, '1%'],
    );
    const [p] = await parseFundWorkbook(workbook(rows), file('dsp'));

    expect(p!.constituents.map((c) => c.weight)).toEqual([0.99, 0.01]);
  });

  it('reads tiny-weight marks that a footnote defines', async () => {
    const rows = table(
      stock(99),
      ['Small Limited', 'INE323456789', 'Banks', 1, 0.004, '#'],
      ['Odd Limited', 'INE423456789', 'Banks', 1, '', '*'],
      ['Net Current Assets', '', '', '', 0.996, '0.996%'],
    );

    rows.push(['# -> Less Than 0.005%'], ['* Less than 0.01%']);
    const [p] = await parseFundWorkbook(workbook(rows), file('sbi'));

    expect(p!.constituents.map((c) => c.weight)).toEqual([0.99, 0.00004, 0, 0.00996]);
  });

  it('reads SBI’s split title and date cells and its % to AUM column', async () => {
    const rows = [
      ['SCHEME NAME :', 'SBI Example Fund'],
      ['PORTFOLIO STATEMENT AS ON :', 'September 30, 2026'],
      [
        'Name of the Instrument / Issuer',
        'ISIN',
        'Rating / Industry^',
        'Quantity',
        'Market value (Rs. in Lakhs)',
        '% to AUM',
      ],
      ['Equity Shares'],
      stock(100),
      ['GRAND TOTAL (AUM)', '', '', '', 100, '100%'],
    ];
    const [p] = await parseFundWorkbook(workbook(rows), file('sbi'));

    expect(p).toMatchObject({ schemeName: 'SBI Example Fund', asOf: '2026-09-30' });
  });

  it('reads Tata’s figures date, MKT VAL column, named totals and swaps', async () => {
    const rows = [
      ['Example Fund'],
      ['Portfolio as on 30-09-26'],
      [
        'NAME OF THE INSTRUMENT',
        'INDUSTRY',
        'ISIN CODE',
        'QUANTITY',
        'MKT VAL(Rs. Lacs)',
        '% to NAV',
      ],
      ['EQUITY & EQUITY RELATED'],
      ['EXAMPLE LTD', 'Banks', 'INE123456789', 1, 79, '79.00'],
      ['EQUITY & EQUITY RELATED TOTAL', '', '', '', 79, '79.00'],
      ['IRS'],
      ['IRS - SW1', '', 'IRSSWAP1', 1, 20, '20.00'],
      ['IRS TOTAL', '', '', '', 20, '20.00'],
      ['NON-CONVERTIBLE DEBENTURES/BONDS TOTAL', '', '', '', 0, '0.00'],
      ['(I) TREPS', '', '', '', 20, '20.00'],
      ['PORTFOLIO TOTAL', '', '', '', 99, '99.00'],
      ['CASH / NET CURRENT ASSET', '', '', '', 1, '1.00'],
      ['NET ASSETS', '', '', '', 100, '100.00'],
    ];
    const [p] = await parseFundWorkbook(workbook(rows), file('tata'));

    expect(p!.asOf).toBe('2026-09-30');
    expect(p!.constituents.map((c) => [c.kind, c.weight])).toEqual([
      ['stock', 0.79],
      ['cash', 0.2],
      ['cash', 0.01],
    ]);
    expect(p!.derivatives).toBe(true);
  });

  it('takes the industry column over a separate rating column', async () => {
    const rows = table(['Example Limited', 'INE123456789', 'N.A.', 'Banks', 1, 100, '100%']);

    rows[2] = [
      'Name of the Instrument',
      'ISIN',
      'Rating',
      'Industry',
      'Quantity',
      'Market Value',
      '% to NAV',
    ];
    rows.at(-1)!.splice(4, 0, '');
    const [p] = await parseFundWorkbook(workbook(rows), file('quant'));

    expect(p!.constituents[0]!.industry).toBe('Banks');
  });

  it('skips sheets without holdings and, when asked, reports a scheme it can’t read', async () => {
    const bytes = book([
      ['Risk-o-meter', [['Scheme Risk-o-meter', 'Benchmark Risk-o-meter']]],
      ['Good', table(stock(100))],
      ['Bad', table(stock(50))],
    ]);

    await expect(parseFundWorkbook(bytes, file('tata'))).rejects.toThrow(/Bad: incomplete/);
    const skipped: string[] = [];
    const portfolios = await parseFundWorkbook(bytes, file('tata'), (e) => skipped.push(e.message));

    expect(portfolios).toHaveLength(1);
    expect(skipped).toEqual([expect.stringMatching(/^Bad: incomplete portfolio weight/)]);
  });

  it('reads each workbook in DSP’s zip', async () => {
    const zip = XLSX.CFB.utils.cfb_new();

    XLSX.CFB.utils.cfb_add(zip, 'equity.xlsx', workbook(table(stock(100))));
    XLSX.CFB.utils.cfb_add(zip, 'readme.txt', Buffer.from('notes'));
    const bytes = XLSX.CFB.write(zip, { fileType: 'zip', type: 'buffer' }) as Buffer;
    const portfolios = await parseFundWorkbook(new Uint8Array(bytes), {
      source: 'dsp',
      url: 'https://www.dspim.com/media/x/dsp-monthend-portfolio.zip',
      name: 'dsp-monthend-portfolio.zip',
    });

    expect(portfolios.map((p) => p.schemeName)).toEqual(['Example Flexi Cap Fund']);
  });

  it('reads Edelweiss’s “portfolio statement of … as on …” titles', async () => {
    const titled = (title: string) => [
      [`PORTFOLIO STATEMENT OF ${title} AS ON SEPTEMBER 30, 2026`],
      ['(An open ended equity scheme predominantly investing in mid cap stocks)'],
      [],
      ...table(stock(100)).slice(2),
    ];
    const bytes = book([
      [
        'Index',
        [
          ['Fund Id', 'Fund Desc'],
          ['EESMCF', 'Example Mid Cap Fund'],
        ],
      ],
      ['EESMCF', titled('EXAMPLE MID CAP FUND')],
      ['EDBE30', titled('EXAMPLE BOND ETF – APRIL 2030')],
    ]);
    const portfolios = await parseFundWorkbook(bytes, file('ppfas'));

    expect(portfolios.map((p) => [p.schemeName, p.asOf])).toEqual([
      ['EXAMPLE MID CAP FUND', '2026-09-30'],
      ['EXAMPLE BOND ETF – APRIL 2030', '2026-09-30'],
    ]);
  });

  it('drops “formerly known as” from scheme names', () => {
    expect(
      normaliseFundName('EXAMPLE ELSS - TAX SAVER FUND (Formerly Known As EXAMPLE TAX SAVER)'),
    ).toBe(normaliseFundName('Example ELSS Tax Saver Fund Direct Growth'));
  });
});
